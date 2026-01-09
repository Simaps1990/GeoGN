import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionModel } from '../models/mission.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { MissionJoinRequestModel } from '../models/missionJoinRequest.js';
import { UserModel } from '../models/user.js';
import { ContactModel } from '../models/contact.js';

const MEMBER_COLOR_PALETTE = [
  '#3b82f6',
  '#22c55e',
  '#f97316',
  '#ef4444',
  '#a855f7',
  '#14b8a6',
  '#eab308',
  '#64748b',
  '#ec4899',
  '#000000',
  '#ffffff',
];

function pickColor(used: Set<string>) {
  const available = MEMBER_COLOR_PALETTE.filter((c) => !used.has(c));
  const source = available.length ? available : MEMBER_COLOR_PALETTE;
  return source[Math.floor(Math.random() * source.length)] ?? '#3b82f6';
}

async function pickMissionMemberColor(missionId: mongoose.Types.ObjectId) {
  const existing = await MissionMemberModel.find({ missionId, removedAt: null }).select({ color: 1 }).lean();
  const used = new Set(existing.map((m) => String((m as any).color ?? '').trim()).filter(Boolean));
  return pickColor(used);
}

function normalizeRole(role: any) {
  if (role === 'admin' || role === 'member' || role === 'viewer') return role;
  return null;
}

async function ensureContact(ownerUserId: mongoose.Types.ObjectId, contactUserId: mongoose.Types.ObjectId) {
  try {
    await ContactModel.create({ ownerUserId, contactUserId, createdAt: new Date() });
  } catch (err: any) {
    if (err?.code === 11000) return;
    throw err;
  }
}

function asObjectId(v: any): mongoose.Types.ObjectId | null {
  if (!v) return null;
  if (v instanceof mongoose.Types.ObjectId) return v;
  const s = typeof v === 'string' ? v : v?.toString?.();
  if (typeof s === 'string' && mongoose.Types.ObjectId.isValid(s)) return new mongoose.Types.ObjectId(s);
  return null;
}

export async function joinRequestsRoutes(app: FastifyInstance) {
  app.get<{ Params: { missionId: string } }>('/missions/:missionId/members', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { missionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
    }

    const membership = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
    if (!membership) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    const members = await MissionMemberModel.find({ missionId, removedAt: null })
      .select({ userId: 1, role: 1, color: 1, isActive: 1, joinedAt: 1 })
      .lean();

    const userIds = members.map((m) => m.userId);
    const users = await UserModel.find({ _id: { $in: userIds } }).select({ displayName: 1, appUserId: 1 }).lean();
    const userById = new Map(users.map((u) => [u._id.toString(), u] as const));

    return reply.send(
      members.map((m) => {
        const u = userById.get(m.userId.toString());
        return {
          user: u ? { id: u._id.toString(), appUserId: u.appUserId, displayName: u.displayName } : null,
          role: m.role,
          color: m.color,
          isActive: m.isActive,
          joinedAt: m.joinedAt ?? null,
        };
      })
    );
  });

  app.post<{ Params: { missionId: string }; Body: { appUserId: string; role?: 'admin' | 'member' | 'viewer' } }>(
    '/missions/:missionId/members',
    async (
      req: FastifyRequest<{ Params: { missionId: string }; Body: { appUserId: string; role?: 'admin' | 'member' | 'viewer' } }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) {
        return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      }

      const membership = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
      if (!membership || membership.role !== 'admin') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const appUserId = String((req.body as any)?.appUserId ?? '').trim();
      if (!appUserId) {
        return reply.code(400).send({ error: 'INVALID_APP_USER_ID' });
      }

      const desiredRole = normalizeRole((req.body as any)?.role ?? 'member') ?? null;
      if (!desiredRole) {
        return reply.code(400).send({ error: 'INVALID_ROLE' });
      }

      const user = await UserModel.findOne({ appUserId }).lean();
      if (!user) {
        return reply.code(404).send({ error: 'USER_NOT_FOUND' });
      }

      const now = new Date();
      const existingMember = await MissionMemberModel.findOne({ missionId, userId: user._id }).lean();
      if (existingMember && (existingMember as any).removedAt === null) {
        return reply.code(409).send({ error: 'ALREADY_MEMBER' });
      }

      const existingColor = existingMember?.color ? String((existingMember as any).color).trim() : '';
      const memberColor = existingColor || (await pickMissionMemberColor(new mongoose.Types.ObjectId(missionId)));

      await MissionMemberModel.updateOne(
        { missionId: new mongoose.Types.ObjectId(missionId), userId: user._id },
        {
          $setOnInsert: {
            missionId: new mongoose.Types.ObjectId(missionId),
            userId: user._id,
            role: desiredRole,
            color: memberColor,
          },
          $set: {
            removedAt: null,
            joinedAt: now,
            isActive: true,
            role: desiredRole,
            color: memberColor,
          },
        },
        { upsert: true }
      );

      app.io?.to(`mission:${missionId}`).emit('member:updated', {
        missionId,
        member: { userId: user._id.toString(), role: desiredRole, color: memberColor },
      });

      return reply.code(201).send({ ok: true });
    }
  );

  // User requests to join a mission by ID
  app.post<{ Params: { missionId: string } }>('/missions/:missionId/join-requests', async (req: FastifyRequest<{ Params: { missionId: string } }>, reply: FastifyReply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { missionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
    }

    const mission = await MissionModel.findById(missionId).lean();
    if (!mission) {
      return reply.code(404).send({ error: 'MISSION_NOT_FOUND' });
    }

    const alreadyMember = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
    if (alreadyMember) {
      return reply.code(409).send({ error: 'ALREADY_MEMBER' });
    }

    const existing = await MissionJoinRequestModel.findOne({ missionId, requestedBy: req.userId }).lean();
    if (existing) {
      if (existing.status === 'pending') {
        return reply.code(409).send({ error: 'ALREADY_REQUESTED' });
      }
      if (existing.status === 'accepted') {
        // If the join request is marked accepted but the member isn't actually in the mission
        // (e.g. a previous accept failed mid-way), allow re-request by resetting to pending.
        const stillMember = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
        if (stillMember) {
          return reply.code(409).send({ error: 'ALREADY_ACCEPTED' });
        }

        await MissionJoinRequestModel.updateOne(
          { _id: existing._id },
          { $set: { status: 'pending', createdAt: new Date(), handledBy: null, handledAt: null } }
        );

        return reply.code(201).send({ ok: true });
      }

      await MissionJoinRequestModel.updateOne(
        { _id: existing._id },
        { $set: { status: 'pending', createdAt: new Date(), handledBy: null, handledAt: null } }
      );

      return reply.code(201).send({ ok: true });
    }

    await MissionJoinRequestModel.create({
      missionId: new mongoose.Types.ObjectId(missionId),
      requestedBy: new mongoose.Types.ObjectId(req.userId),
      status: 'pending',
      createdAt: new Date(),
      handledBy: null,
      handledAt: null,
    });

    return reply.code(201).send({ ok: true });
  });

  // Admin lists pending join requests
  app.get<{ Params: { missionId: string } }>('/missions/:missionId/join-requests', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { missionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(missionId)) {
      return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
    }

    const membership = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
    if (!membership || membership.role !== 'admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    // Robust listing: sometimes a join request may be marked accepted while the member wasn't
    // actually created (previous accept crashed mid-way). In that case, "accepted" should be
    // treated as "pending" again.
    const reqsRaw = await MissionJoinRequestModel.find({ missionId, status: { $in: ['pending', 'accepted'] } })
      .sort({ createdAt: -1 })
      .lean();

    const repairs: mongoose.Types.ObjectId[] = [];
    for (const r of reqsRaw) {
      if ((r as any).status !== 'accepted') continue;
      const stillMember = await MissionMemberModel.findOne({ missionId, userId: (r as any).requestedBy, removedAt: null }).lean();
      if (!stillMember) repairs.push((r as any)._id);
    }

    if (repairs.length) {
      await MissionJoinRequestModel.updateMany(
        { _id: { $in: repairs } },
        { $set: { status: 'pending', handledBy: null, handledAt: null } }
      );
    }

    const reqs = repairs.length
      ? await MissionJoinRequestModel.find({ missionId, status: 'pending' }).sort({ createdAt: -1 }).lean()
      : reqsRaw.filter((r) => (r as any).status === 'pending');

    const userIds = reqs.map((r) => (r as any).requestedBy);
    const users = await UserModel.find({ _id: { $in: userIds } }).select({ displayName: 1, appUserId: 1 }).lean();
    const userById = new Map(users.map((u) => [u._id.toString(), u] as const));

    return reply.send(
      reqs.map((r) => {
        const u = userById.get(r.requestedBy.toString());
        return {
          id: r._id.toString(),
          status: r.status,
          createdAt: r.createdAt,
          requestedBy: u ? { id: u._id.toString(), appUserId: u.appUserId, displayName: u.displayName } : null,
        };
      })
    );
  });

  app.post<{ Params: { missionId: string; requestId: string }; Body: { role?: 'admin' | 'member' | 'viewer' } }>(
    '/missions/:missionId/join-requests/:requestId/accept',
    async (
      req: FastifyRequest<{ Params: { missionId: string; requestId: string }; Body: { role?: 'admin' | 'member' | 'viewer' } }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);

        const { missionId, requestId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(requestId)) {
          return reply.code(400).send({ error: 'INVALID_ID' });
        }

        if (!mongoose.Types.ObjectId.isValid(req.userId)) {
          return reply.code(401).send({ error: 'UNAUTHORIZED' });
        }

        const missionObjectId = new mongoose.Types.ObjectId(missionId);
        const requestObjectId = new mongoose.Types.ObjectId(requestId);
        const adminUserObjectId = new mongoose.Types.ObjectId(req.userId);

        const membership = await MissionMemberModel.findOne({ missionId: missionObjectId, userId: adminUserObjectId, removedAt: null }).lean();
        if (!membership || membership.role !== 'admin') {
          return reply.code(403).send({ error: 'FORBIDDEN' });
        }

        const joinReq = await MissionJoinRequestModel.findOne({ _id: requestObjectId, missionId: missionObjectId }).lean();
        if (!joinReq) {
          return reply.code(404).send({ error: 'NOT_FOUND' });
        }

        if (joinReq.status !== 'pending' && joinReq.status !== 'accepted') {
          return reply.code(409).send({ error: 'NOT_PENDING' });
        }

        const desiredRole = normalizeRole((req.body as any)?.role ?? 'member') ?? null;
        if (!desiredRole) {
          return reply.code(400).send({ error: 'INVALID_ROLE' });
        }

        const now = new Date();

        const joinMissionId = asObjectId((joinReq as any).missionId);
        const joinRequestedBy = asObjectId((joinReq as any).requestedBy);
        if (!joinMissionId || !joinRequestedBy) {
          return reply.code(500).send({ error: 'JOIN_REQUEST_DATA_INVALID' });
        }

        const existingMember = await MissionMemberModel.findOne({ missionId: joinMissionId, userId: joinRequestedBy }).lean();
        const existingColor = existingMember?.color ? String(existingMember.color).trim() : '';
        const memberColor = existingColor || (await pickMissionMemberColor(joinMissionId));

        await MissionMemberModel.updateOne(
          { missionId: joinMissionId, userId: joinRequestedBy },
          {
            $setOnInsert: {
              missionId: joinMissionId,
              userId: joinRequestedBy,
              role: desiredRole,
              color: memberColor,
            },
            $set: {
              removedAt: null,
              joinedAt: now,
              isActive: true,
              role: desiredRole,
              color: memberColor,
            },
          },
          { upsert: true }
        );

        if (joinReq.status === 'pending') {
          await MissionJoinRequestModel.updateOne(
            { _id: joinReq._id },
            { $set: { status: 'accepted', handledBy: adminUserObjectId, handledAt: now } }
          );
        }

        app.io?.to(`mission:${missionId}`).emit('member:updated', {
          missionId,
          member: { userId: joinRequestedBy.toString(), role: desiredRole, color: memberColor },
        });

        // Add to global contacts in both directions (admin <-> requester)
        try {
          await Promise.all([ensureContact(adminUserObjectId, joinRequestedBy), ensureContact(joinRequestedBy, adminUserObjectId)]);
        } catch (e: any) {
          console.error('[join-requests.accept] contact sync failed', e);
        }

        return reply.send({ ok: true });
      } catch (e: any) {
        try {
          (req as any)?.log?.error?.(e);
        } catch {
          // ignore
        }
        console.error('[join-requests.accept] failed', e);
        if (e?.name === 'CastError') {
          return reply.code(500).send({ error: 'CAST_ERROR' });
        }
        if (e?.code === 11000) {
          return reply.code(500).send({ error: 'DUPLICATE_KEY' });
        }
        return reply.code(500).send({ error: 'ACCEPT_JOIN_REQUEST_FAILED' });
      }
    }
  );

  app.patch<{ Params: { missionId: string; memberUserId: string }; Body: { role?: 'admin' | 'member' | 'viewer'; color?: string } }>(
    '/missions/:missionId/members/:memberUserId',
    async (
      req: FastifyRequest<{ Params: { missionId: string; memberUserId: string }; Body: { role?: 'admin' | 'member' | 'viewer'; color?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, memberUserId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(memberUserId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const membership = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
      if (!membership || membership.role !== 'admin') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const update: any = {};
      if (typeof (req.body as any)?.color === 'string') {
        const c = (req.body as any).color.trim();
        if (c) update.color = c;
      }

      if (typeof (req.body as any)?.role !== 'undefined') {
        const r = normalizeRole((req.body as any).role);
        if (!r) {
          return reply.code(400).send({ error: 'INVALID_ROLE' });
        }
        update.role = r;
      }

      if (!Object.keys(update).length) {
        return reply.code(400).send({ error: 'NO_CHANGES' });
      }

      const updated = await MissionMemberModel.findOneAndUpdate(
        { missionId, userId: new mongoose.Types.ObjectId(memberUserId), removedAt: null },
        { $set: update },
        { new: true }
      ).lean();

      if (!updated) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      app.io?.to(`mission:${missionId}`).emit('member:updated', {
        missionId,
        member: { userId: memberUserId, role: (updated as any).role, color: (updated as any).color },
      });

      return reply.send({ ok: true });
    }
  );

  app.delete<{ Params: { missionId: string; memberUserId: string } }>(
    '/missions/:missionId/members/:memberUserId',
    async (req: FastifyRequest<{ Params: { missionId: string; memberUserId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, memberUserId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(memberUserId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const membership = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
      if (!membership || membership.role !== 'admin') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      if (String(req.userId) === String(memberUserId)) {
        return reply.code(400).send({ error: 'CANNOT_REMOVE_SELF' });
      }

      const now = new Date();
      const updated = await MissionMemberModel.findOneAndUpdate(
        { missionId, userId: new mongoose.Types.ObjectId(memberUserId), removedAt: null },
        { $set: { removedAt: now, isActive: false } },
        { new: true }
      ).lean();

      if (!updated) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      app.io?.to(`mission:${missionId}`).emit('member:updated', {
        missionId,
        member: { userId: memberUserId, role: (updated as any).role, color: (updated as any).color },
      });

      app.io?.to(`mission:${missionId}`).emit('position:clear', { missionId, userId: memberUserId });

      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { missionId: string; requestId: string } }>(
    '/missions/:missionId/join-requests/:requestId/decline',
    async (req: FastifyRequest<{ Params: { missionId: string; requestId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, requestId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(requestId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const membership = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
      if (!membership || membership.role !== 'admin') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const joinReq = await MissionJoinRequestModel.findOne({ _id: requestId, missionId }).lean();
      if (!joinReq) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      if (joinReq.status !== 'pending') {
        return reply.code(409).send({ error: 'NOT_PENDING' });
      }

      const now = new Date();
      await MissionJoinRequestModel.updateOne(
        { _id: joinReq._id },
        { $set: { status: 'declined', handledBy: new mongoose.Types.ObjectId(req.userId), handledAt: now } }
      );

      return reply.send({ ok: true });
    }
  );
}

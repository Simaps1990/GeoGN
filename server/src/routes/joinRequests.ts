import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionModel } from '../models/mission.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { MissionJoinRequestModel } from '../models/missionJoinRequest.js';
import { UserModel } from '../models/user.js';
import { ContactModel } from '../models/contact.js';

function randomColor() {
  const palette = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#14b8a6', '#eab308'];
  return palette[Math.floor(Math.random() * palette.length)] ?? '#3b82f6';
}

async function ensureContact(ownerUserId: mongoose.Types.ObjectId, contactUserId: mongoose.Types.ObjectId) {
  try {
    await ContactModel.create({ ownerUserId, contactUserId, createdAt: new Date() });
  } catch (err: any) {
    if (err?.code === 11000) return;
    throw err;
  }
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
        return reply.code(409).send({ error: 'ALREADY_ACCEPTED' });
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

    const reqs = await MissionJoinRequestModel.find({ missionId, status: 'pending' }).sort({ createdAt: -1 }).lean();
    const userIds = reqs.map((r) => r.requestedBy);
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

  app.post<{ Params: { missionId: string; requestId: string } }>(
    '/missions/:missionId/join-requests/:requestId/accept',
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
        { $set: { status: 'accepted', handledBy: new mongoose.Types.ObjectId(req.userId), handledAt: now } }
      );

      await MissionMemberModel.updateOne(
        { missionId: joinReq.missionId, userId: joinReq.requestedBy },
        {
          $setOnInsert: {
            missionId: joinReq.missionId,
            userId: joinReq.requestedBy,
            role: 'member',
            color: randomColor(),
          },
          $set: {
            removedAt: null,
            joinedAt: now,
            isActive: true,
          },
        },
        { upsert: true }
      );

      // Add to global contacts in both directions (admin <-> requester)
      await Promise.all([
        ensureContact(new mongoose.Types.ObjectId(req.userId), joinReq.requestedBy),
        ensureContact(joinReq.requestedBy, new mongoose.Types.ObjectId(req.userId)),
      ]);

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

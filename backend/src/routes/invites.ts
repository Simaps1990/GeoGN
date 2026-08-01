import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionInviteModel } from '../models/missionInvite.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { MissionModel } from '../models/mission.js';
import { UserModel } from '../models/user.js';
import { isAllowedMemberColor, pickMissionMemberColor, ensureContact } from './joinRequests.js';

type SendInviteBody = {
  invitedAppUserId: string;
  expiresInHours?: number;
};

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

export async function invitesRoutes(app: FastifyInstance) {
  app.get('/invites', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const invites = await MissionInviteModel.find({ invitedUserId: req.userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();

    const missionIds = invites.map((i) => i.missionId);
    const inviterIds = invites.map((i) => i.invitedBy);

    const [missions, inviters] = await Promise.all([
      MissionModel.find({ _id: { $in: missionIds } }).select({ title: 1, status: 1 }).lean(),
      UserModel.find({ _id: { $in: inviterIds } }).select({ displayName: 1, appUserId: 1 }).lean(),
    ]);

    const missionById = new Map(missions.map((m) => [m._id.toString(), m] as const));
    const inviterById = new Map(inviters.map((u) => [u._id.toString(), u] as const));

    return reply.send(
      invites.map((i) => {
        const m = missionById.get(i.missionId.toString());
        const u = inviterById.get(i.invitedBy.toString());
        return {
          id: i._id.toString(),
          token: i.token,
          status: i.status,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          mission: m ? { id: m._id.toString(), title: m.title, status: m.status } : null,
          invitedBy: u ? { id: u._id.toString(), appUserId: u.appUserId, displayName: u.displayName } : null,
        };
      })
    );
  });

  app.post<{ Params: { missionId: string }; Body: SendInviteBody }>(
    '/missions/:missionId/invites',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: SendInviteBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) {
        return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      }

      const inviterMembership = await MissionMemberModel.findOne({ missionId, userId: req.userId, removedAt: null }).lean();
      if (!inviterMembership || inviterMembership.role !== 'admin') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const invitedUser = await UserModel.findOne({ appUserId: req.body.invitedAppUserId }).lean();
      if (!invitedUser) {
        return reply.code(404).send({ error: 'USER_NOT_FOUND' });
      }

      const alreadyMember = await MissionMemberModel.findOne({ missionId, userId: invitedUser._id, removedAt: null }).lean();
      if (alreadyMember) {
        return reply.code(409).send({ error: 'ALREADY_MEMBER' });
      }

      const expiresInHours = typeof req.body.expiresInHours === 'number' ? req.body.expiresInHours : 24 * 7;
      const expiresAt = new Date(Date.now() + Math.max(1, expiresInHours) * 3600 * 1000);

      const invite = await MissionInviteModel.create({
        missionId: new mongoose.Types.ObjectId(missionId),
        invitedBy: new mongoose.Types.ObjectId(req.userId),
        invitedUserId: invitedUser._id,
        status: 'pending',
        token: randomToken(),
        createdAt: new Date(),
        expiresAt,
      });

      return reply.code(201).send({
        id: invite._id.toString(),
        token: invite.token,
        status: invite.status,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt,
        invitedUser: { id: invitedUser._id.toString(), appUserId: invitedUser.appUserId, displayName: invitedUser.displayName },
      });
    }
  );

  app.post<{ Params: { token: string } }>('/invites/:token/accept', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { token } = req.params;
    const invite = await MissionInviteModel.findOne({ token }).lean();
    if (!invite) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    if (invite.invitedUserId.toString() !== req.userId) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    if (invite.status !== 'pending') {
      return reply.code(409).send({ error: 'NOT_PENDING' });
    }

    if (invite.expiresAt.getTime() < Date.now()) {
      return reply.code(410).send({ error: 'EXPIRED' });
    }

    const now = new Date();
    await MissionInviteModel.updateOne({ _id: invite._id }, { $set: { status: 'accepted' } });

    const existingMember = await MissionMemberModel.findOne({
      missionId: invite.missionId,
      userId: invite.invitedUserId,
    }).lean();

    // Already an active member (invite went stale while they joined some other
    // way): a stale invite must never touch their role/color, nor use this
    // upsert to bypass the last-admin safeguard the role-change route enforces.
    if (existingMember && existingMember.removedAt == null) {
      return reply.send({ ok: true });
    }

    // Le rôle et la couleur sont toujours forcés via $set (pas $setOnInsert) :
    // si l'upsert matche un MissionMember soft-deleted laissé par un retrait
    // précédent, on ne veut surtout pas hériter de son ancien rôle (ex: admin).
    // Une invitation ne redonne jamais mieux que le rôle par défaut d'un membre.
    const existingColor = existingMember?.color ? String((existingMember as any).color).trim() : '';
    const memberColor =
      existingColor && isAllowedMemberColor(existingColor)
        ? existingColor
        : await pickMissionMemberColor(invite.missionId);

    await MissionMemberModel.updateOne(
      { missionId: invite.missionId, userId: invite.invitedUserId },
      {
        $setOnInsert: {
          missionId: invite.missionId,
          userId: invite.invitedUserId,
        },
        $set: {
          removedAt: null,
          joinedAt: now,
          isActive: true,
          role: 'member',
          color: memberColor,
        },
      },
      { upsert: true }
    );

    app.io?.to(`mission:${invite.missionId}`).emit('member:updated', {
      missionId: invite.missionId.toString(),
      member: { userId: invite.invitedUserId.toString(), role: 'member', color: memberColor },
    });

    // Ajoute le contact dans les deux sens (inviteur <-> invité), comme dans
    // le flux d'acceptation d'une demande de join (join-requests.ts).
    try {
      await Promise.all([
        ensureContact(invite.invitedBy, invite.invitedUserId),
        ensureContact(invite.invitedUserId, invite.invitedBy),
      ]);
    } catch (e: any) {
      req.log.error('[invites.accept] contact sync failed', e);
    }

    return reply.send({ ok: true });
  });

  app.post<{ Params: { token: string } }>('/invites/:token/decline', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { token } = req.params;
    const invite = await MissionInviteModel.findOne({ token }).lean();
    if (!invite) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    if (invite.invitedUserId.toString() !== req.userId) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    if (invite.status !== 'pending') {
      return reply.code(409).send({ error: 'NOT_PENDING' });
    }

    await MissionInviteModel.updateOne({ _id: invite._id }, { $set: { status: 'declined' } });
    return reply.send({ ok: true });
  });
}

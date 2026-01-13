import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionModel } from '../models/mission.js';
import { MissionMemberModel } from '../models/missionMember.js';

type CreateMissionBody = {
  title: string;
};

type UpdateMissionBody = {
  status?: 'draft' | 'active' | 'closed';
  traceRetentionSeconds?: number;
  title?: string;
};

const MEMBER_COLOR_PALETTE = [
  '#ef4444',
  '#f97316',
  '#fde047',
  '#4ade80',
  '#596643',
  '#60a5fa',
  '#1e3a8a',
  '#a855f7',
  '#ec4899',
  '#6b3f35',
  '#a19579',
  '#000000',
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

export async function missionsRoutes(app: FastifyInstance) {
  app.get('/missions', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const memberships = await MissionMemberModel.find({ userId: req.userId, removedAt: null })
      .select({ missionId: 1, role: 1, color: 1, isActive: 1, joinedAt: 1 })
      .lean();

    const missionIds = memberships.map((m) => m.missionId);
    const missions = await MissionModel.find({ _id: { $in: missionIds } }).sort({ updatedAt: -1 }).lean();

    const membershipByMission = new Map(memberships.map((m) => [m.missionId.toString(), m] as const));

    return reply.send(
      missions.map((m) => {
        const mem = membershipByMission.get(m._id.toString());
        return {
          id: m._id.toString(),
          title: m.title,
          status: m.status,
          mapStyle: m.mapStyle,
          traceRetentionSeconds: m.traceRetentionSeconds,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          membership: mem
            ? {
                role: mem.role,
                color: mem.color,
                isActive: mem.isActive,
                joinedAt: mem.joinedAt ?? null,
              }
            : null,
        };
      })
    );
  });

  app.post<{ Body: CreateMissionBody }>('/missions', async (req: FastifyRequest<{ Body: CreateMissionBody }>, reply: FastifyReply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { title } = req.body;
    if (!title?.trim()) {
      return reply.code(400).send({ error: 'TITLE_REQUIRED' });
    }

    const now = new Date();
    const mission = await MissionModel.create({
      title: title.trim(),
      createdBy: new mongoose.Types.ObjectId(req.userId),
      status: 'draft',
      mapStyle: 'streets',
      traceRetentionSeconds: 3600,
      createdAt: now,
      updatedAt: now,
    });

    const memberColor = await pickMissionMemberColor(mission._id);

    await MissionMemberModel.create({
      missionId: mission._id,
      userId: new mongoose.Types.ObjectId(req.userId),
      role: 'admin',
      color: memberColor,
      joinedAt: now,
      removedAt: null,
      isActive: true,
    });

    return reply.code(201).send({
      id: mission._id.toString(),
      title: mission.title,
      status: mission.status,
      mapStyle: mission.mapStyle,
      traceRetentionSeconds: mission.traceRetentionSeconds,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
    });
  });

  app.get<{ Params: { id: string } }>('/missions/:id', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.code(400).send({ error: 'INVALID_ID' });
    }

    const membership = await MissionMemberModel.findOne({ missionId: id, userId: req.userId, removedAt: null }).lean();
    if (!membership) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    const mission = await MissionModel.findById(id).lean();
    if (!mission) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    return reply.send({
      id: mission._id.toString(),
      title: mission.title,
      status: mission.status,
      mapStyle: mission.mapStyle,
      traceRetentionSeconds: mission.traceRetentionSeconds,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
      membership: {
        role: membership.role,
        color: membership.color,
        isActive: membership.isActive,
        joinedAt: membership.joinedAt ?? null,
      },
    });
  });

  app.patch<{ Params: { id: string }; Body: UpdateMissionBody }>('/missions/:id', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.code(400).send({ error: 'INVALID_ID' });
    }

    const membership = await MissionMemberModel.findOne({ missionId: id, userId: req.userId, removedAt: null }).lean();
    if (!membership || membership.role !== 'admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    const update: any = { updatedAt: new Date() };
    if (req.body.status) update.status = req.body.status;
    if (typeof req.body.traceRetentionSeconds === 'number') {
      const v = Math.floor(req.body.traceRetentionSeconds);
      if (v > 0) {
        update.traceRetentionSeconds = v;
      }
    }
    if (typeof req.body.title === 'string') {
      const t = req.body.title.trim();
      if (t) update.title = t;
    }

    const mission = await MissionModel.findOneAndUpdate({ _id: id }, { $set: update }, { new: true }).lean();
    if (!mission) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    try {
      (app as any).io?.to(`mission:${id}`)?.emit('mission:updated', {
        missionId: id,
        traceRetentionSeconds: mission.traceRetentionSeconds,
        title: mission.title,
        updatedAt: mission.updatedAt,
      });
    } catch {
      // ignore
    }

    return reply.send({
      id: mission._id.toString(),
      title: mission.title,
      status: mission.status,
      mapStyle: mission.mapStyle,
      traceRetentionSeconds: mission.traceRetentionSeconds,
      createdAt: mission.createdAt,
      updatedAt: mission.updatedAt,
    });
  });

  app.delete<{ Params: { id: string } }>('/missions/:id', async (req, reply) => {
    try {
      requireAuth(req);
    } catch (e: any) {
      return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return reply.code(400).send({ error: 'INVALID_ID' });
    }

    const membership = await MissionMemberModel.findOne({ missionId: id, userId: req.userId, removedAt: null }).lean();
    if (!membership || membership.role !== 'admin') {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }

    await MissionMemberModel.deleteMany({ missionId: id });
    await MissionModel.deleteOne({ _id: id });

    return reply.send({ ok: true });
  });
}

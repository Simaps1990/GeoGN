import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { verifyAccessToken } from './auth/jwt.js';
import { MissionMemberModel } from './models/missionMember.js';
import { MissionModel } from './models/mission.js';
import { PositionModel } from './models/position.js';
import { TraceModel } from './models/trace.js';

type AuthedSocket = {
  data: {
    userId: string;
    missionId?: string;
  };
};

type PositionUpdatePayload = {
  lng: number;
  lat: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  t?: number;
};

type PositionBulkPayload = {
  points: PositionUpdatePayload[];
};

async function emitMissionSnapshot(socket: any, missionId: string) {
  if (!mongoose.Types.ObjectId.isValid(missionId)) return;

  const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
  const retentionSeconds = mission?.traceRetentionSeconds ?? 3600;
  const now = Date.now();
  const cutoff = new Date(now - Math.max(0, retentionSeconds) * 1000);

  const [positionsAgg, traces] = await Promise.all([
    PositionModel.aggregate([
      { $match: { missionId: new mongoose.Types.ObjectId(missionId), createdAt: { $gte: cutoff } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$userId',
          lng: { $first: { $arrayElemAt: ['$loc.coordinates', 0] } },
          lat: { $first: { $arrayElemAt: ['$loc.coordinates', 1] } },
          t: { $first: '$createdAt' },
        },
      },
    ]),
    TraceModel.find({ missionId: new mongoose.Types.ObjectId(missionId), createdAt: { $gte: cutoff } })
      .select({ userId: 1, loc: 1, createdAt: 1 })
      .sort({ userId: 1, createdAt: 1 })
      .limit(Math.max(5000, retentionSeconds * 10))
      .lean(),
  ]);

  const positions: Record<string, { lng: number; lat: number; t: number }> = {};
  for (const p of positionsAgg as any[]) {
    const uid = String(p?._id ?? '');
    if (!uid) continue;
    if (typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
    const tMs = p.t instanceof Date ? p.t.getTime() : now;
    positions[uid] = { lng: p.lng, lat: p.lat, t: tMs };
  }

  const tracesByUser: Record<string, { lng: number; lat: number; t: number }[]> = {};
  for (const tr of traces as any[]) {
    const uid = String(tr?.userId ?? '');
    if (!uid) continue;
    const coords = tr?.loc?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = coords[0];
    const lat = coords[1];
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    const tMs = tr.createdAt instanceof Date ? tr.createdAt.getTime() : now;
    (tracesByUser[uid] ??= []).push({ lng, lat, t: tMs });
  }

  socket.emit('mission:snapshot', {
    missionId,
    retentionSeconds,
    positions,
    traces: tracesByUser,
  });
}

async function requireMissionMember(userId: string, missionId: string) {
  if (!mongoose.Types.ObjectId.isValid(missionId)) return false;
  const mem = await MissionMemberModel.findOne({ missionId, userId, removedAt: null }).lean();
  return Boolean(mem);
}

export function setupSocket(app: FastifyInstance) {
  const io = new Server(app.server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const authHeader = socket.handshake.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
    const token = tokenFromHeader ?? (socket.handshake.auth as any)?.token ?? (socket.handshake.query as any)?.token;

    if (!token || typeof token !== 'string') {
      return next(new Error('UNAUTHORIZED'));
    }

    try {
      const payload = verifyAccessToken(token);
      (socket as any).data = { ...(socket as any).data, userId: payload.sub };
      return next();
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket as any as AuthedSocket).data.userId;

    socket.on('mission:join', async (payload: { missionId: string }, ack?: (res: any) => void) => {
      try {
        const missionId = payload?.missionId;
        if (!missionId) {
          ack?.({ ok: false, error: 'MISSION_ID_REQUIRED' });
          return;
        }

        const ok = await requireMissionMember(userId, missionId);
        if (!ok) {
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const prevMissionId = (socket as any as AuthedSocket).data.missionId;
        if (prevMissionId) {
          socket.leave(`mission:${prevMissionId}`);
        }

        (socket as any as AuthedSocket).data.missionId = missionId;
        socket.join(`mission:${missionId}`);

        ack?.({ ok: true });
        socket.emit('mission:joined', { missionId });

        // Envoyer un snapshot pour que les clients qui reviennent sur la carte
        // voient immédiatement les positions + traces récentes.
        await emitMissionSnapshot(socket, missionId);
      } catch {
        ack?.({ ok: false, error: 'JOIN_FAILED' });
      }
    });

    socket.on('mission:leave', async (_payload: any, ack?: (res: any) => void) => {
      const missionId = (socket as any as AuthedSocket).data.missionId;
      if (missionId) {
        socket.leave(`mission:${missionId}`);
      }
      (socket as any as AuthedSocket).data.missionId = undefined;
      ack?.({ ok: true });
    });

    socket.on('position:clear', async (_payload: any, ack?: (res: any) => void) => {
      try {
        const missionId = (socket as any as AuthedSocket).data.missionId;
        if (!missionId) {
          ack?.({ ok: false, error: 'NOT_IN_MISSION' });
          return;
        }

        const ok = await requireMissionMember(userId, missionId);
        if (!ok) {
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        io.to(`mission:${missionId}`).emit('position:clear', { missionId, userId });
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'POSITION_CLEAR_FAILED' });
      }
    });

    socket.on('position:update', async (payload: PositionUpdatePayload, ack?: (res: any) => void) => {
      try {
        const missionId = (socket as any as AuthedSocket).data.missionId;
        if (!missionId) {
          ack?.({ ok: false, error: 'NOT_IN_MISSION' });
          return;
        }

        if (typeof payload?.lng !== 'number' || typeof payload?.lat !== 'number') {
          ack?.({ ok: false, error: 'INVALID_POSITION' });
          return;
        }

        const ok = await requireMissionMember(userId, missionId);
        if (!ok) {
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const t = typeof payload.t === 'number' ? new Date(payload.t) : new Date();

        await PositionModel.create({
          missionId: new mongoose.Types.ObjectId(missionId),
          userId: new mongoose.Types.ObjectId(userId),
          loc: { type: 'Point', coordinates: [payload.lng, payload.lat] },
          speed: payload.speed,
          heading: payload.heading,
          accuracy: payload.accuracy,
          createdAt: t,
        });

        const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
        const retentionSeconds = mission?.traceRetentionSeconds ?? 3600;
        const expiresAt = new Date(t.getTime() + Math.max(0, retentionSeconds) * 1000);

        const member = await MissionMemberModel.findOne({ missionId, userId, removedAt: null }).select({ color: 1 }).lean();
        const color = (member?.color && typeof member.color === 'string' ? member.color.trim() : '') || '#3b82f6';

        await TraceModel.create({
          missionId: new mongoose.Types.ObjectId(missionId),
          userId: new mongoose.Types.ObjectId(userId),
          color,
          loc: { type: 'Point', coordinates: [payload.lng, payload.lat] },
          createdAt: t,
          expiresAt,
        });

        const msg = {
          missionId,
          userId,
          lng: payload.lng,
          lat: payload.lat,
          speed: payload.speed ?? null,
          heading: payload.heading ?? null,
          accuracy: payload.accuracy ?? null,
          t: t.getTime(),
        };

        io.to(`mission:${missionId}`).emit('position:update', msg);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'POSITION_UPDATE_FAILED' });
      }
    });

    socket.on('position:bulk', async (payload: PositionBulkPayload, ack?: (res: any) => void) => {
      try {
        const missionId = (socket as any as AuthedSocket).data.missionId;
        if (!missionId) {
          ack?.({ ok: false, error: 'NOT_IN_MISSION' });
          return;
        }

        const ok = await requireMissionMember(userId, missionId);
        if (!ok) {
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const points = Array.isArray(payload?.points) ? payload.points : [];
        if (points.length === 0) {
          ack?.({ ok: true, inserted: 0 });
          return;
        }

        // Hard safety cap to avoid abuse / OOM.
        const capped = points.slice(0, 5000);

        const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
        const retentionSeconds = mission?.traceRetentionSeconds ?? 3600;
        const nowMs = Date.now();
        const cutoffMs = nowMs - Math.max(0, retentionSeconds) * 1000;

        const member = await MissionMemberModel.findOne({ missionId, userId, removedAt: null }).select({ color: 1 }).lean();
        const color = (member?.color && typeof member.color === 'string' ? member.color.trim() : '') || '#3b82f6';

        const positionDocs: any[] = [];
        const traceDocs: any[] = [];
        const broadcastPoints: any[] = [];

        for (const p of capped) {
          if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
          const tMs = typeof p.t === 'number' && Number.isFinite(p.t) ? p.t : nowMs;
          if (tMs < cutoffMs) continue;
          // guard against far future points
          if (tMs > nowMs + 60_000) continue;

          const t = new Date(tMs);
          const expiresAt = new Date(tMs + Math.max(0, retentionSeconds) * 1000);

          positionDocs.push({
            missionId: new mongoose.Types.ObjectId(missionId),
            userId: new mongoose.Types.ObjectId(userId),
            loc: { type: 'Point', coordinates: [p.lng, p.lat] },
            speed: p.speed,
            heading: p.heading,
            accuracy: p.accuracy,
            createdAt: t,
          });

          traceDocs.push({
            missionId: new mongoose.Types.ObjectId(missionId),
            userId: new mongoose.Types.ObjectId(userId),
            color,
            loc: { type: 'Point', coordinates: [p.lng, p.lat] },
            createdAt: t,
            expiresAt,
          });

          broadcastPoints.push({
            lng: p.lng,
            lat: p.lat,
            speed: p.speed ?? null,
            heading: p.heading ?? null,
            accuracy: p.accuracy ?? null,
            t: tMs,
          });
        }

        if (positionDocs.length === 0) {
          ack?.({ ok: true, inserted: 0 });
          return;
        }

        // Persist best-effort; ordered:false keeps inserting even if a doc fails.
        await Promise.all([
          PositionModel.insertMany(positionDocs, { ordered: false }),
          TraceModel.insertMany(traceDocs, { ordered: false }),
        ]);

        io.to(`mission:${missionId}`).emit('position:bulk', {
          missionId,
          userId,
          points: broadcastPoints,
        });

        ack?.({ ok: true, inserted: positionDocs.length });
      } catch {
        ack?.({ ok: false, error: 'POSITION_BULK_FAILED' });
      }
    });
  });

  app.decorate('io', io);
  return io;
}

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
  }
}

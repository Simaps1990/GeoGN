import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import { verifyAccessToken } from './auth/jwt.js';
import { MissionMemberModel } from './models/missionMember.js';
import { MissionModel } from './models/mission.js';
import { PositionModel } from './models/position.js';
import { TraceModel } from './models/trace.js';
import { PositionCurrentModel } from './models/positionCurrent.js';

type AuthedSocket = {
  data: {
    userId: string;
    missionId?: string;
    requestedRetentionSeconds?: number;
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

const TRACE_THROTTLE_MS = 2000;

const DEFAULT_SNAPSHOT_RETENTION_SECONDS = 1800;

const lastTraceTsByUserMission = new Map<string, number>();

async function emitMissionSnapshot(socket: any, missionId: string, requestedRetentionSeconds?: number) {
  if (!mongoose.Types.ObjectId.isValid(missionId)) return;

  const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
  const missionRetentionSeconds = mission?.traceRetentionSeconds ?? 3600;
  const requested =
    typeof requestedRetentionSeconds === 'number' && Number.isFinite(requestedRetentionSeconds)
      ? requestedRetentionSeconds
      : DEFAULT_SNAPSHOT_RETENTION_SECONDS;
  const retentionSeconds = Math.max(0, Math.min(missionRetentionSeconds, requested));
  const now = Date.now();
  const cutoff = new Date(now - Math.max(0, retentionSeconds) * 1000);
  const cutoffMs = cutoff.getTime();

  const [currentPositions, traces] = await Promise.all([
    PositionCurrentModel.find({ missionId: new mongoose.Types.ObjectId(missionId) })
      .select({ userId: 1, loc: 1, timestamp: 1 })
      .lean(),
    TraceModel.find({ missionId: new mongoose.Types.ObjectId(missionId), createdAt: { $gte: cutoff } })
      .select({ userId: 1, loc: 1, createdAt: 1 })
      .sort({ userId: 1, createdAt: 1 })
      .limit(Math.max(5000, retentionSeconds * 10))
      .lean(),
  ]);

  const positions: Record<string, { lng: number; lat: number; t: number }> = {};
  for (const p of currentPositions as any[]) {
    const uid = String(p?.userId ?? '');
    if (!uid) continue;
    const coords = p?.loc?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = coords[0];
    const lat = coords[1];
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    const tMs = p.timestamp instanceof Date ? p.timestamp.getTime() : now;
    if (tMs < cutoffMs) continue;
    positions[uid] = { lng, lat, t: tMs };
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

    socket.on(
      'mission:join',
      async (payload: { missionId: string; retentionSeconds?: number }, ack?: (res: any) => void) => {
        try {
          const missionId = payload?.missionId;
          if (!missionId) {
            ack?.({ ok: false, error: 'MISSION_ID_REQUIRED' });
            return;
          }

          if (!mongoose.Types.ObjectId.isValid(userId)) {
            ack?.({ ok: false, error: 'INVALID_USER_ID' });
            return;
          }

          const ok = await requireMissionMember(userId, missionId);
          if (!ok) {
            ack?.({ ok: false, error: 'FORBIDDEN' });
            return;
          }

          const requested =
            typeof payload?.retentionSeconds === 'number' && Number.isFinite(payload.retentionSeconds)
              ? payload.retentionSeconds
              : DEFAULT_SNAPSHOT_RETENTION_SECONDS;

          const prevMissionId = (socket as any as AuthedSocket).data.missionId;
          if (prevMissionId) {
            socket.leave(`mission:${prevMissionId}`);
          }

          (socket as any as AuthedSocket).data.missionId = missionId;
          (socket as any as AuthedSocket).data.requestedRetentionSeconds = requested;
          socket.join(`mission:${missionId}`);

          ack?.({ ok: true });
          socket.emit('mission:joined', { missionId });

          // Envoyer un snapshot pour que les clients qui reviennent sur la carte
          // voient immédiatement les positions + traces récentes.
          await emitMissionSnapshot(socket, missionId, requested);
        } catch {
          ack?.({ ok: false, error: 'JOIN_FAILED' });
        }
      }
    );

    socket.on('mission:leave', async (_payload: any, ack?: (res: any) => void) => {
      const missionId = (socket as any as AuthedSocket).data.missionId;
      if (missionId) {
        socket.leave(`mission:${missionId}`);
        const key = `${missionId}:${userId}`;
        lastTraceTsByUserMission.delete(key);
      }
      (socket as any as AuthedSocket).data.missionId = undefined;
      ack?.({ ok: true });
    });

    socket.on('mission:snapshot:request', async (payload: { missionId?: string }, ack?: (res: any) => void) => {
      try {
        const missionId = payload?.missionId ?? (socket as any as AuthedSocket).data.missionId;
        if (!missionId) {
          ack?.({ ok: false, error: 'MISSION_ID_REQUIRED' });
          return;
        }

        const ok = await requireMissionMember(userId, missionId);
        if (!ok) {
          ack?.({ ok: false, error: 'FORBIDDEN' });
          return;
        }

        const requestedRetentionSeconds = (socket as any as AuthedSocket).data.requestedRetentionSeconds;
        await emitMissionSnapshot(socket, missionId, requestedRetentionSeconds);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'SNAPSHOT_FAILED' });
      }
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

        const nowMs = Date.now();
        const tMs = typeof payload.t === 'number' ? payload.t : nowMs;
        const t = new Date(tMs);

        await PositionCurrentModel.updateOne(
          { missionId: new mongoose.Types.ObjectId(missionId), userId: new mongoose.Types.ObjectId(userId) },
          {
            $set: {
              loc: { type: 'Point', coordinates: [payload.lng, payload.lat] },
              speed: payload.speed,
              heading: payload.heading,
              accuracy: payload.accuracy,
              timestamp: t,
            },
          },
          { upsert: true }
        );

        const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
        const retentionSeconds = mission?.traceRetentionSeconds ?? 3600;
        const expiresAt = new Date(t.getTime() + Math.max(0, retentionSeconds) * 1000);

        const key = `${missionId}:${userId}`;
        const lastTs = lastTraceTsByUserMission.get(key) ?? 0;
        const diff = tMs - lastTs;

        if (diff >= TRACE_THROTTLE_MS) {
          const member = await MissionMemberModel.findOne({ missionId, userId, removedAt: null })
            .select({ color: 1 })
            .lean();
          const color = (member?.color && typeof member.color === 'string' ? member.color.trim() : '') || '#3b82f6';

          await TraceModel.create({
            missionId: new mongoose.Types.ObjectId(missionId),
            userId: new mongoose.Types.ObjectId(userId),
            color,
            loc: { type: 'Point', coordinates: [payload.lng, payload.lat] },
            createdAt: t,
            expiresAt,
          });

          lastTraceTsByUserMission.set(key, tMs);
        }

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

        if (points.length > 200) {
          ack?.({ ok: false, error: 'BULK_TOO_LARGE', max: 200 });
          return;
        }

        const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
        const retentionSeconds = mission?.traceRetentionSeconds ?? 3600;
        const nowMs = Date.now();
        const cutoffMs = nowMs - Math.max(0, retentionSeconds) * 1000;

        const member = await MissionMemberModel.findOne({ missionId, userId, removedAt: null })
          .select({ color: 1 })
          .lean();
        const color = (member?.color && typeof member.color === 'string' ? member.color.trim() : '') || '#3b82f6';

        const pointsSorted = [...points].sort((a, b) => {
          const ta = typeof a.t === 'number' && Number.isFinite(a.t) ? a.t : nowMs;
          const tb = typeof b.t === 'number' && Number.isFinite(b.t) ? b.t : nowMs;
          return ta - tb;
        });

        const traceDocs: any[] = [];
        const broadcastPoints: any[] = [];

        const key = `${missionId}:${userId}`;
        const lastGlobalTs = lastTraceTsByUserMission.get(key) ?? 0;
        let lastTsInBulk = lastGlobalTs;

        for (const p of pointsSorted) {
          if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
          const tMs = typeof p.t === 'number' && Number.isFinite(p.t) ? p.t : nowMs;
          if (tMs < cutoffMs) continue;
          if (tMs > nowMs + 60_000) continue;

          let shouldThrottleWithGlobal = tMs >= lastGlobalTs;

          const baseTs = shouldThrottleWithGlobal ? lastGlobalTs : lastTsInBulk;
          const diff = tMs - baseTs;
          if (diff >= TRACE_THROTTLE_MS) {
            const t = new Date(tMs);
            const expiresAt = new Date(tMs + Math.max(0, retentionSeconds) * 1000);

            traceDocs.push({
              missionId: new mongoose.Types.ObjectId(missionId),
              userId: new mongoose.Types.ObjectId(userId),
              color,
              loc: { type: 'Point', coordinates: [p.lng, p.lat] },
              createdAt: t,
              expiresAt,
            });

            lastTsInBulk = tMs;
          }

          broadcastPoints.push({
            lng: p.lng,
            lat: p.lat,
            speed: p.speed ?? null,
            heading: p.heading ?? null,
            accuracy: p.accuracy ?? null,
            t: typeof p.t === 'number' && Number.isFinite(p.t) ? p.t : nowMs,
          });
        }

        // Met à jour la position courante avec le point le plus récent (dernier après tri).
        const latest = pointsSorted[pointsSorted.length - 1];
        if (latest && typeof latest.lng === 'number' && typeof latest.lat === 'number') {
          const latestTs =
            typeof latest.t === 'number' && Number.isFinite(latest.t) ? latest.t : Date.now();
          const latestDate = new Date(latestTs);

          await PositionCurrentModel.updateOne(
            { missionId: new mongoose.Types.ObjectId(missionId), userId: new mongoose.Types.ObjectId(userId) },
            {
              $set: {
                loc: { type: 'Point', coordinates: [latest.lng, latest.lat] },
                speed: latest.speed,
                heading: latest.heading,
                accuracy: latest.accuracy,
                timestamp: latestDate,
              },
            },
            { upsert: true }
          );
        }

        if (traceDocs.length > 0) {
          await TraceModel.insertMany(traceDocs, { ordered: false });
          const maxInsertedTs = traceDocs.reduce((acc, doc: any) => {
            const t = doc.createdAt instanceof Date ? doc.createdAt.getTime() : nowMs;
            return t > acc ? t : acc;
          }, lastGlobalTs);
          if (maxInsertedTs > lastGlobalTs) {
            lastTraceTsByUserMission.set(key, maxInsertedTs);
          }
        }

        if (broadcastPoints.length > 0) {
          io.to(`mission:${missionId}`).emit('position:bulk', {
            missionId,
            userId,
            points: broadcastPoints,
          });
        }

        ack?.({ ok: true, inserted: traceDocs.length });
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

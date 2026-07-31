import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import * as parser from 'socket.io-msgpack-parser';
import mongoose from 'mongoose';
import { verifyAccessToken } from './auth/jwt.js';
import { isAllowedOrigin } from './corsOrigins.js';
import { MissionMemberModel } from './models/missionMember.js';
import { MissionModel } from './models/mission.js';
import { PositionModel } from './models/position.js';
import { TraceModel } from './models/trace.js';
import { PositionCurrentModel } from './models/positionCurrent.js';
import { selectTraceInserts, type BufferedPosition } from './positionBatch.js';

type AuthedSocket = {
  data: {
    userId: string;
    missionId?: string;
    requestedRetentionSeconds?: number;
    cached?: {
      memberColor: string;
      retentionSeconds: number;
      checkedAt: number;
    };
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

const BATCH_TICK_MS = 1500;
const positionBuffers = new Map<string, Map<string, BufferedPosition>>();
const missionTickTimers = new Map<string, NodeJS.Timeout>();

// Per-mission chain of in-flight flushPositionBatch calls. Ticks fire on a
// setInterval that does NOT wait for the previous tick's async callback to
// finish, so without this a slow bulkWrite on tick N could still be running
// when tick N+1's (faster) write completes and advances
// lastTraceTsByUserMission past tick N's point, silently dropping tick N's
// trace vertex and letting a stale PositionCurrent write land last. Chaining
// each call onto the previous one for the same mission forces the Mongo
// writes to run strictly in tick order, even though the emit (above/before
// this) already went out immediately.
const flushChains = new Map<string, Promise<void>>();

function queueFlush(missionId: string, points: BufferedPosition[]): Promise<void> {
  const prev = flushChains.get(missionId) ?? Promise.resolve();
  const next = prev.then(() => flushPositionBatch(missionId, points));
  // Store a variant that never rejects so one failed write doesn't break
  // the chain for subsequent ticks; the caller still gets the real
  // rejection via the returned `next` promise for its own try/catch.
  flushChains.set(missionId, next.catch(() => {}));
  return next;
}

async function flushPositionBatch(missionId: string, points: BufferedPosition[]) {
  const missionObjectId = new mongoose.Types.ObjectId(missionId);

  if (points.length > 0) {
    const positionOps = points.map((p) => ({
      updateOne: {
        filter: { missionId: missionObjectId, userId: new mongoose.Types.ObjectId(p.userId) },
        update: {
          $set: {
            loc: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
            speed: p.speed,
            heading: p.heading,
            accuracy: p.accuracy,
            timestamp: new Date(p.t),
          },
        },
        upsert: true,
      },
    }));
    await PositionCurrentModel.bulkWrite(positionOps, { ordered: false });
  }

  const traceInserts = selectTraceInserts(points, missionId, lastTraceTsByUserMission, TRACE_THROTTLE_MS);
  if (traceInserts.length > 0) {
    await TraceModel.insertMany(
      traceInserts.map((ins) => ({
        missionId: new mongoose.Types.ObjectId(ins.missionId),
        userId: new mongoose.Types.ObjectId(ins.userId),
        color: ins.color,
        loc: { type: 'Point', coordinates: [ins.lng, ins.lat] },
        createdAt: new Date(ins.createdAt),
        expiresAt: new Date(ins.expiresAt),
      })),
      { ordered: false }
    );
  }
}

function ensureMissionTick(io: Server, missionId: string) {
  if (missionTickTimers.has(missionId)) return;
  // Note: buffered positions live only in memory between ticks. If the server
  // process crashes (or is killed) between ticks, whatever is sitting in the
  // buffer for this mission (up to BATCH_TICK_MS / 1.5s worth of points) is
  // lost and never reaches PositionCurrentModel or becomes a Trace doc. This
  // is accepted for now — there is no persistent/durable queue backing this
  // buffer — since the next position:update from the client will repopulate
  // it moments later.
  const timer = setInterval(() => {
    void (async () => {
      const room = io.sockets.adapter.rooms.get(`mission:${missionId}`);
      if (!room || room.size === 0) {
        // Room is empty (last member left/disconnected). Drain the buffer
        // and tear down the timer/map entries synchronously, BEFORE
        // awaiting the final flush below. If a client rejoins and emits
        // position:update while the flush is still in flight, we want
        // ensureMissionTick to see no timer registered and create a
        // completely fresh buffer/timer, rather than writing into (and
        // then losing) state this branch is about to discard anyway.
        const pendingBuffer = positionBuffers.get(missionId);
        const pendingPoints = pendingBuffer && pendingBuffer.size > 0 ? Array.from(pendingBuffer.values()) : [];

        clearInterval(timer);
        missionTickTimers.delete(missionId);
        positionBuffers.delete(missionId);

        // Flush any pending buffer so the final position before drop-off
        // isn't silently discarded — no one is left to receive a
        // position:batch emit, so we just persist it.
        if (pendingPoints.length > 0) {
          try {
            await queueFlush(missionId, pendingPoints);
          } catch (e) {
            console.error('[socket] position:batch final flush failed:', e);
          }
        }
        return;
      }

      const buffer = positionBuffers.get(missionId);
      if (!buffer || buffer.size === 0) return;

      const points = Array.from(buffer.values());
      buffer.clear();

      // Emit before the Mongo write so tick order is preserved for clients
      // regardless of how long flushPositionBatch takes: setInterval doesn't
      // serialize its async callbacks, so if we awaited the DB write first, a
      // slow tick N could finish (and emit) after a faster tick N+1, making
      // member markers jump backward on the client.
      io.to(`mission:${missionId}`).emit('position:batch', {
        missionId,
        points: points.map((p) => ({
          userId: p.userId,
          lng: p.lng,
          lat: p.lat,
          speed: p.speed,
          heading: p.heading,
          accuracy: p.accuracy,
          t: p.t,
        })),
      });

      try {
        await queueFlush(missionId, points);
      } catch (e) {
        console.error('[socket] position:batch flush failed:', e);
      }
    })();
  }, BATCH_TICK_MS);
  missionTickTimers.set(missionId, timer);
}

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
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // requêtes server-to-server / curl
        cb(null, isAllowedOrigin(origin));
      },
      credentials: true,
    },
    parser,
  });

  io.use((socket, next) => {
    const authHeader = socket.handshake.headers.authorization;
    const tokenFromHeader = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;
    const token = tokenFromHeader ?? (socket.handshake.auth as any)?.token;

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

    // Join user-specific room for direct notifications
    if (mongoose.Types.ObjectId.isValid(userId)) {
      socket.join(`user:${userId}`);
    }

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

          // Populate cache with member color and mission retention seconds
          const member = await MissionMemberModel.findOne({ missionId, userId, removedAt: null }).select({ color: 1 }).lean();
          const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
          
          (socket as any as AuthedSocket).data.cached = {
            memberColor: (member?.color && String(member.color).trim()) || '#3b82f6',
            retentionSeconds: mission?.traceRetentionSeconds ?? 3600,
            checkedAt: Date.now(),
          };

          ack?.({ ok: true });
          socket.emit('mission:joined', { missionId });

          // Envoyer un snapshot pour que les clients qui reviennent sur la carte
          // voient immédiatement les positions + traces récentes.
          await emitMissionSnapshot(socket, missionId, requested);
        } catch (e) {
          console.error('[socket] mission:join failed:', e);
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
      } catch (e) {
        console.error('[socket] mission:snapshot:request failed:', e);
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
      } catch (e) {
        console.error('[socket] position:clear failed:', e);
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

        // Validate latitude and longitude bounds
        if (!Number.isFinite(payload.lng) || !Number.isFinite(payload.lat) ||
            payload.lat < -90 || payload.lat > 90 ||
            payload.lng < -180 || payload.lng > 180) {
          ack?.({ ok: false, error: 'INVALID_POSITION' });
          return;
        }

        // Use cache if available and recent (< 5 seconds)
        // TODO: invalidation explicite sur retrait membre via event mission:member:invalidate
        const cached = (socket as any as AuthedSocket).data.cached;
        let memberColor: string;
        let retentionSeconds: number;

        if (cached && Date.now() - cached.checkedAt < 5_000) {
          memberColor = cached.memberColor;
          retentionSeconds = cached.retentionSeconds;
        } else {
          // Cache expired or missing, fetch from DB
          const ok = await requireMissionMember(userId, missionId);
          if (!ok) {
            // Clear cache and reject
            (socket as any as AuthedSocket).data.cached = undefined;
            ack?.({ ok: false, error: 'FORBIDDEN' });
            return;
          }

          const member = await MissionMemberModel.findOne({ missionId, userId, removedAt: null })
            .select({ color: 1 })
            .lean();
          memberColor = (member?.color && typeof member.color === 'string' ? member.color.trim() : '') || '#3b82f6';

          const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
          retentionSeconds = mission?.traceRetentionSeconds ?? 3600;

          // Update cache
          (socket as any as AuthedSocket).data.cached = {
            memberColor,
            retentionSeconds,
            checkedAt: Date.now(),
          };
        }

        const nowMs = Date.now();
        const tMs = typeof payload.t === 'number' ? payload.t : nowMs;

        let buffer = positionBuffers.get(missionId);
        if (!buffer) {
          buffer = new Map();
          positionBuffers.set(missionId, buffer);
        }
        buffer.set(userId, {
          userId,
          lng: payload.lng,
          lat: payload.lat,
          speed: payload.speed ?? null,
          heading: payload.heading ?? null,
          accuracy: payload.accuracy ?? null,
          t: tMs,
          color: memberColor,
          retentionSeconds,
        });
        ensureMissionTick(io, missionId);

        ack?.({ ok: true });
      } catch (e) {
        console.error('[socket] position:update failed:', e);
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

        // Use cache if available and recent (< 5 seconds)
        // TODO: invalidation explicite sur retrait membre via event mission:member:invalidate
        const cached = (socket as any as AuthedSocket).data.cached;
        let memberColor: string;
        let retentionSeconds: number;

        if (cached && Date.now() - cached.checkedAt < 5_000) {
          memberColor = cached.memberColor;
          retentionSeconds = cached.retentionSeconds;
        } else {
          // Cache expired or missing, fetch from DB
          const ok = await requireMissionMember(userId, missionId);
          if (!ok) {
            // Clear cache and reject
            (socket as any as AuthedSocket).data.cached = undefined;
            ack?.({ ok: false, error: 'FORBIDDEN' });
            return;
          }

          const member = await MissionMemberModel.findOne({ missionId, userId, removedAt: null })
            .select({ color: 1 })
            .lean();
          memberColor = (member?.color && typeof member.color === 'string' ? member.color.trim() : '') || '#3b82f6';

          const mission = await MissionModel.findById(missionId).select({ traceRetentionSeconds: 1 }).lean();
          retentionSeconds = mission?.traceRetentionSeconds ?? 3600;

          // Update cache
          (socket as any as AuthedSocket).data.cached = {
            memberColor,
            retentionSeconds,
            checkedAt: Date.now(),
          };
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

        const nowMs = Date.now();
        const cutoffMs = nowMs - Math.max(0, retentionSeconds) * 1000;

        // Validate all points
        for (const p of points) {
          if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') {
            ack?.({ ok: false, error: 'INVALID_POSITION' });
            return;
          }
          if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat) ||
              p.lat < -90 || p.lat > 90 ||
              p.lng < -180 || p.lng > 180) {
            ack?.({ ok: false, error: 'INVALID_POSITION' });
            return;
          }
        }

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

        // Pas de throttle pour les bulks : ces points viennent typiquement d'une période
        // offline et doivent être restitués fidèlement (1Hz au lieu de 0.5Hz).
        // Le hardcap 200 points/bulk reste en vigueur (cf. ligne ~412).
        for (const p of pointsSorted) {
          if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
          const tMs = typeof p.t === 'number' && Number.isFinite(p.t) ? p.t : nowMs;
          if (tMs < cutoffMs) continue;
          if (tMs > nowMs + 60_000) continue;

          const t = new Date(tMs);
          const expiresAt = new Date(tMs + Math.max(0, retentionSeconds) * 1000);

          traceDocs.push({
            missionId: new mongoose.Types.ObjectId(missionId),
            userId: new mongoose.Types.ObjectId(userId),
            color: memberColor,
            loc: { type: 'Point', coordinates: [p.lng, p.lat] },
            createdAt: t,
            expiresAt,
          });

          if (tMs > lastTsInBulk) {
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
      } catch (e) {
        console.error('[socket] position:bulk failed:', e);
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

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
        const expiresAt = new Date(t.getTime() + Math.max(60, retentionSeconds) * 1000);

        await TraceModel.create({
          missionId: new mongoose.Types.ObjectId(missionId),
          userId: new mongoose.Types.ObjectId(userId),
          color: '#3b82f6',
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
          t: t.toISOString(),
        };

        io.to(`mission:${missionId}`).emit('position:update', msg);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: 'POSITION_UPDATE_FAILED' });
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

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { BaptismModel, type BaptismDoc, type BaptismIcon, type BaptismDisplayMode } from '../models/baptism.js';

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function validateLngLatPoint(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false;
  const { lng, lat } = p as { lng?: unknown; lat?: unknown };
  return isFiniteNumber(lng) && isFiniteNumber(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

export function validateDisplayMode(m: unknown): m is BaptismDisplayMode {
  return m === 'colors' || m === 'tion' || m === 'both';
}

export function validateIcon(i: unknown): i is BaptismIcon {
  return i === 'person' || i === 'car' || i === 'house';
}

export function validateAxis(a: unknown): string | null {
  if (!a || typeof a !== 'object') return 'INVALID_AXIS';
  const axis = a as Record<string, unknown>;
  if (typeof axis.axisId !== 'string' || axis.axisId.length < 1 || axis.axisId.length > 32) return 'INVALID_AXIS_ID';
  if (typeof axis.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(axis.color)) return 'INVALID_AXIS_COLOR';
  if (axis.name !== null && (typeof axis.name !== 'string' || axis.name.length > 40)) return 'INVALID_AXIS_NAME';
  if (
    !Array.isArray(axis.suggestions) ||
    axis.suggestions.length > 5 ||
    !axis.suggestions.every((s) => typeof s === 'string' && s.length <= 40)
  )
    return 'INVALID_AXIS_SUGGESTIONS';
  const geom = axis.geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) return 'INVALID_AXIS_GEOMETRY';
  const coords = geom.coordinates as unknown[];
  if (coords.length < 2 || coords.length > 500) return 'INVALID_AXIS_GEOMETRY';
  for (const pos of coords) {
    if (!Array.isArray(pos) || pos.length < 2) return 'INVALID_AXIS_GEOMETRY';
    const [lng, lat] = pos as unknown[];
    if (!isFiniteNumber(lng) || !isFiniteNumber(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90)
      return 'INVALID_AXIS_GEOMETRY';
  }
  if (!isFiniteNumber(axis.bearing) || axis.bearing < 0 || axis.bearing >= 360) return 'INVALID_AXIS_BEARING';
  return null;
}

export function validateAxes(list: unknown): { error: string } | null {
  if (!Array.isArray(list) || list.length === 0) return { error: 'AXES_REQUIRED' };
  if (list.length > 20) return { error: 'TOO_MANY_AXES' };
  const ids = new Set<string>();
  for (const a of list) {
    const err = validateAxis(a);
    if (err) return { error: err };
    const id = (a as { axisId: string }).axisId;
    if (ids.has(id)) return { error: 'DUPLICATE_AXIS_ID' };
    ids.add(id);
  }
  return null;
}

async function getMembership(userId: string, missionId: string) {
  return MissionMemberModel.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    missionId: new mongoose.Types.ObjectId(missionId),
  }).lean();
}

function toDto(b: BaptismDoc) {
  return {
    id: b._id.toString(),
    missionId: b.missionId.toString(),
    icon: b.icon,
    point: b.point,
    displayMode: b.displayMode,
    axes: b.axes.map((a) => ({
      axisId: a.axisId,
      color: a.color,
      name: a.name ?? null,
      suggestions: a.suggestions ?? [],
      geometry: a.geometry,
      bearing: a.bearing,
    })),
    createdBy: b.createdBy.toString(),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function emitUpdated(app: FastifyInstance, missionId: string, dto: ReturnType<typeof toDto>) {
  app.io?.to(`mission:${missionId}`).emit('baptism:updated', {
    missionId,
    baptism: { ...dto, createdAt: dto.createdAt.toISOString(), updatedAt: dto.updatedAt.toISOString() },
  });
}

type PutBody = {
  icon: BaptismIcon;
  point: { lng: number; lat: number };
  displayMode: BaptismDisplayMode;
  axes: BaptismDoc['axes'];
};

type PatchBody = {
  displayMode?: BaptismDisplayMode;
  axisId?: string;
  name?: string | null;
  color?: string;
  remove?: boolean;
};

export async function baptismsRoutes(app: FastifyInstance) {
  app.get<{ Params: { missionId: string } }>(
    '/missions/:missionId/baptism',
    async (req: FastifyRequest<{ Params: { missionId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem) return reply.code(403).send({ error: 'FORBIDDEN' });
      const b = await BaptismModel.findOne({ missionId }).lean();
      if (!b) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.send(toDto(b as BaptismDoc));
    }
  );

  app.put<{ Params: { missionId: string }; Body: PutBody }>(
    '/missions/:missionId/baptism',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: PutBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });

      const body = req.body as PutBody;
      if (!validateIcon(body?.icon)) return reply.code(400).send({ error: 'INVALID_ICON' });
      if (!validateLngLatPoint(body?.point)) return reply.code(400).send({ error: 'INVALID_POINT' });
      if (!validateDisplayMode(body?.displayMode)) return reply.code(400).send({ error: 'INVALID_DISPLAY_MODE' });
      const axesErr = validateAxes(body?.axes);
      if (axesErr) return reply.code(400).send(axesErr);

      const now = new Date();
      const b = await BaptismModel.findOneAndUpdate(
        { missionId: new mongoose.Types.ObjectId(missionId) },
        {
          $set: {
            icon: body.icon,
            point: { lng: body.point.lng, lat: body.point.lat },
            displayMode: body.displayMode,
            axes: body.axes.map((a) => ({
              axisId: a.axisId,
              color: a.color,
              name: typeof a.name === 'string' ? a.name.trim().toUpperCase() : null,
              suggestions: (a.suggestions ?? []).map((s) => s.trim().toUpperCase()),
              geometry: a.geometry,
              bearing: a.bearing,
            })),
            updatedAt: now,
          },
          $setOnInsert: {
            createdBy: new mongoose.Types.ObjectId(req.userId),
            createdAt: now,
          },
        },
        { upsert: true, new: true }
      ).lean();

      const dto = toDto(b as BaptismDoc);
      emitUpdated(app, missionId, dto);
      return reply.code(200).send(dto);
    }
  );

  app.patch<{ Params: { missionId: string }; Body: PatchBody }>(
    '/missions/:missionId/baptism',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: PatchBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });

      const b = await BaptismModel.findOne({ missionId });
      if (!b) return reply.code(404).send({ error: 'NOT_FOUND' });

      const body = req.body as PatchBody;
      if (body.displayMode !== undefined) {
        if (!validateDisplayMode(body.displayMode)) return reply.code(400).send({ error: 'INVALID_DISPLAY_MODE' });
        b.displayMode = body.displayMode;
      }
      if (body.axisId !== undefined) {
        const axis = b.axes.find((a) => a.axisId === body.axisId);
        if (!axis) return reply.code(404).send({ error: 'AXIS_NOT_FOUND' });
        if (body.remove === true) {
          b.axes = b.axes.filter((a) => a.axisId !== body.axisId);
        } else {
          if (body.name !== undefined) {
            if (body.name !== null && (typeof body.name !== 'string' || body.name.length > 40))
              return reply.code(400).send({ error: 'INVALID_AXIS_NAME' });
            axis.name = typeof body.name === 'string' ? body.name.trim().toUpperCase() : null;
          }
          if (body.color !== undefined) {
            if (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.color))
              return reply.code(400).send({ error: 'INVALID_AXIS_COLOR' });
            axis.color = body.color;
          }
        }
      }
      b.updatedAt = new Date();
      await b.save();

      const dto = toDto(b.toObject() as BaptismDoc);
      emitUpdated(app, missionId, dto);
      return reply.send(dto);
    }
  );

  app.delete<{ Params: { missionId: string } }>(
    '/missions/:missionId/baptism',
    async (req: FastifyRequest<{ Params: { missionId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });
      await BaptismModel.deleteOne({ missionId });
      app.io?.to(`mission:${missionId}`).emit('baptism:deleted', { missionId });
      return reply.send({ ok: true });
    }
  );
}

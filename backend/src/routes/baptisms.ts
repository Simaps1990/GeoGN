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

// Nom affiché en pastille sous l'icône sur la carte. null/undefined -> pas de nom ;
// une chaîne au-delà de 40 caractères (après trim) est rejetée ; une chaîne vide
// (après trim) est normalisée à null plutôt que stockée comme chaîne vide.
export function validatePointName(n: unknown): { value: string | null } | { error: string } {
  if (n === null || n === undefined) return { value: null };
  if (typeof n !== 'string') return { error: 'INVALID_POINT_NAME' };
  const trimmed = n.trim();
  if (trimmed.length > 40) return { error: 'INVALID_POINT_NAME' };
  return { value: trimmed ? trimmed.toUpperCase() : null };
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
    removedAt: null,
  }).lean();
}

function toDto(b: BaptismDoc) {
  return {
    id: b._id.toString(),
    missionId: b.missionId.toString(),
    icon: b.icon,
    point: { lng: b.point.lng, lat: b.point.lat },
    pointName: b.pointName ?? null,
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

type CreateBody = {
  icon: BaptismIcon;
  point: { lng: number; lat: number };
  pointName?: string | null;
  displayMode: BaptismDisplayMode;
  axes: BaptismDoc['axes'];
};

type PatchBody = {
  displayMode?: BaptismDisplayMode;
  pointName?: string | null;
  axisId?: string;
  name?: string | null;
  color?: string;
  remove?: boolean;
};

const MAX_BAPTISMS_PER_MISSION = 10;

export async function baptismsRoutes(app: FastifyInstance) {
  // Migration : les bases existantes portent encore l'ancien index unique sur missionId
  // (une génération de schéma plus tôt), qui ferait échouer le 2e insert d'une mission
  // avec E11000 une fois le modèle passé en multi. Mongoose 8 diffe le flag unique et
  // reconverge de lui-même via syncIndexes — pas besoin de dropIndex à chaque boot (ça
  // redroppait/reconstruisait l'unique index de la collection à chaque redémarrage).
  // Best effort, non bloquant : pas de crash si la resynchro échoue.
  void BaptismModel.syncIndexes().catch(() => {});

  app.get<{ Params: { missionId: string } }>(
    '/missions/:missionId/baptisms',
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
      const list = await BaptismModel.find({ missionId }).lean();
      return reply.send(list.map((b) => toDto(b as BaptismDoc)));
    }
  );

  app.post<{ Params: { missionId: string }; Body: CreateBody }>(
    '/missions/:missionId/baptisms',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: CreateBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });

      const body = req.body as CreateBody;
      if (!validateIcon(body?.icon)) return reply.code(400).send({ error: 'INVALID_ICON' });
      if (!validateLngLatPoint(body?.point)) return reply.code(400).send({ error: 'INVALID_POINT' });
      const pointNameResult = validatePointName(body?.pointName);
      if ('error' in pointNameResult) return reply.code(400).send(pointNameResult);
      if (!validateDisplayMode(body?.displayMode)) return reply.code(400).send({ error: 'INVALID_DISPLAY_MODE' });
      const axesErr = validateAxes(body?.axes);
      if (axesErr) return reply.code(400).send(axesErr);

      const existingCount = await BaptismModel.countDocuments({ missionId });
      if (existingCount >= MAX_BAPTISMS_PER_MISSION) return reply.code(400).send({ error: 'MAX_BAPTISMS' });

      const now = new Date();
      const b = await BaptismModel.create({
        missionId: new mongoose.Types.ObjectId(missionId),
        icon: body.icon,
        point: { lng: body.point.lng, lat: body.point.lat },
        pointName: pointNameResult.value,
        displayMode: body.displayMode,
        axes: body.axes.map((a) => ({
          axisId: a.axisId,
          color: a.color,
          name: typeof a.name === 'string' ? a.name.trim().toUpperCase() : null,
          suggestions: (a.suggestions ?? []).map((s) => s.trim().toUpperCase()),
          geometry: a.geometry,
          bearing: a.bearing,
        })),
        createdBy: new mongoose.Types.ObjectId(req.userId),
        createdAt: now,
        updatedAt: now,
      });

      const dto = toDto(b.toObject() as BaptismDoc);
      emitUpdated(app, missionId, dto);
      return reply.code(201).send(dto);
    }
  );

  app.patch<{ Params: { missionId: string; baptismId: string }; Body: PatchBody }>(
    '/missions/:missionId/baptisms/:baptismId',
    async (
      req: FastifyRequest<{ Params: { missionId: string; baptismId: string }; Body: PatchBody }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId, baptismId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(baptismId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });

      const b = await BaptismModel.findOne({ _id: baptismId, missionId });
      if (!b) return reply.code(404).send({ error: 'NOT_FOUND' });

      const body = req.body as PatchBody;
      if (body.displayMode !== undefined) {
        if (!validateDisplayMode(body.displayMode)) return reply.code(400).send({ error: 'INVALID_DISPLAY_MODE' });
        b.displayMode = body.displayMode;
      }
      if (body.pointName !== undefined) {
        const pointNameResult = validatePointName(body.pointName);
        if ('error' in pointNameResult) return reply.code(400).send(pointNameResult);
        b.pointName = pointNameResult.value;
      }
      if (body.axisId !== undefined) {
        const axis = b.axes.find((a) => a.axisId === body.axisId);
        if (!axis) return reply.code(404).send({ error: 'AXIS_NOT_FOUND' });
        if (body.remove === true) {
          if (b.axes.length === 1) return reply.code(400).send({ error: 'MIN_AXES' });
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

  app.delete<{ Params: { missionId: string; baptismId: string } }>(
    '/missions/:missionId/baptisms/:baptismId',
    async (req: FastifyRequest<{ Params: { missionId: string; baptismId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId, baptismId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(baptismId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });
      const result = await BaptismModel.deleteOne({ _id: baptismId, missionId });
      if (result.deletedCount === 0) return reply.code(404).send({ error: 'NOT_FOUND' });
      app.io?.to(`mission:${missionId}`).emit('baptism:deleted', { missionId, baptismId });
      return reply.send({ ok: true });
    }
  );
}

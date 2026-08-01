import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionMemberModel, type MissionMemberDoc } from '../models/missionMember.js';
import { ZoneModel, type ZoneType } from '../models/zone.js';
import { UserModel } from '../models/user.js';

type GeoJSONPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

type ZoneGrid = {
  rows: number;
  cols: number;
  orientation?: 'vertical' | 'diag45';
};

type CreateZoneBody =
  | {
      type: 'circle';
      title: string;
      comment?: string;
      color: string;
      circle: { center: { lng: number; lat: number }; radiusMeters: number };
      sectors?: { sectorId: string; color: string; geometry: GeoJSONPolygon }[];
      grid?: ZoneGrid;
    }
  | {
      type: 'polygon';
      title: string;
      comment?: string;
      color: string;
      polygon: GeoJSONPolygon;
      sectors?: { sectorId: string; color: string; geometry: GeoJSONPolygon }[];
      grid?: ZoneGrid;
    };

type UpdateZoneBody = Partial<CreateZoneBody>;

type GeometryValidationError = { error: 'INVALID_POLYGON_RING' | 'INVALID_COORDINATES' | 'INVALID_CIRCLE_RADIUS' };

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function isValidLngLat(lng: unknown, lat: unknown): boolean {
  return isFiniteNumber(lng) && isFiniteNumber(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

// GeoJSON ring: >=4 positions (3 distinct + repeated closing point), first === last.
export function isValidRingShape(ring: unknown): ring is number[][] {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  if (!ring.every((pos) => Array.isArray(pos) && pos.length >= 2)) return false;
  const first = ring[0] as number[];
  const last = ring[ring.length - 1] as number[];
  return first[0] === last[0] && first[1] === last[1];
}

export function validatePolygon(polygon: unknown): GeometryValidationError | null {
  const coordinates = polygon && typeof polygon === 'object' ? (polygon as any).coordinates : undefined;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return { error: 'INVALID_POLYGON_RING' };
  for (const ring of coordinates) {
    if (!isValidRingShape(ring)) return { error: 'INVALID_POLYGON_RING' };
    for (const pos of ring as number[][]) {
      if (!isValidLngLat(pos[0], pos[1])) return { error: 'INVALID_COORDINATES' };
    }
  }
  return null;
}

export function validateCircle(circle: unknown): GeometryValidationError | null {
  const c = circle && typeof circle === 'object' ? (circle as any) : undefined;
  const center = c?.center && typeof c.center === 'object' ? c.center : undefined;
  if (!center || !isValidLngLat(center.lng, center.lat)) return { error: 'INVALID_COORDINATES' };
  if (!isFiniteNumber(c.radiusMeters) || c.radiusMeters <= 0) return { error: 'INVALID_CIRCLE_RADIUS' };
  return null;
}

// Label format is "<col letter><row number>", e.g. "C3" (col 'C' = index 2, row 3 = index 2).
// Matches the encoder in frontend/src/components/MapLibreMap.tsx
// (`${String.fromCharCode('A'.charCodeAt(0) + col)}${row + 1}`) and the decoder already used
// below for POST /zones/:zoneId/assignments.
export function isGridCellIdWithinGrid(gridCellId: string, rows: number, cols: number): boolean {
  const m = gridCellId.match(/^([A-Z])(\d+)$/);
  if (!m) return false;
  const col = m[1].charCodeAt(0) - 65;
  const row = parseInt(m[2], 10) - 1;
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

async function getMembership(userId: string, missionId: string) {
  return MissionMemberModel.findOne({ missionId, userId, removedAt: null }).lean();
}

async function getActiveAdminMembership(
  missionId: string | mongoose.Types.ObjectId,
  userId: string
): Promise<MissionMemberDoc | null> {
  if (!mongoose.Types.ObjectId.isValid(missionId.toString())) return null;
  const m = await MissionMemberModel.findOne({
    missionId,
    userId,
    removedAt: null,
  }).lean();
  if (!m || m.role !== 'admin') return null;
  return m;
}

export async function zonesRoutes(app: FastifyInstance) {
  app.get<{ Params: { missionId: string } }>(
    '/missions/:missionId/zones',
    async (req: FastifyRequest<{ Params: { missionId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) {
        return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      }

      const mem = await getMembership(req.userId, missionId);
      if (!mem) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const zones = await ZoneModel.find({ missionId }).sort({ updatedAt: -1 }).lean();
      return reply.send(
        zones.map((z) => ({
          id: z._id.toString(),
          title: z.title,
          comment: (z as any).comment ?? '',
          color: z.color,
          type: z.type,
          circle: z.circle ?? null,
          polygon: z.polygon ?? null,
          grid: z.grid ?? null,
          sectors:
            z.sectors?.map((s) => ({
              sectorId: s.sectorId.toString(),
              color: s.color,
              geometry: s.geometry,
            })) ?? null,
          createdBy: z.createdBy.toString(),
          createdAt: z.createdAt,
          updatedAt: z.updatedAt,
          assignments: (z.assignments ?? []).map((a: any) => ({
            userId: a.userId.toString(),
            assignedAt: a.assignedAt,
            assignedByUserId: a.assignedByUserId?.toString() ?? null,
            gridCellId: a.gridCellId ?? null,
          })),
        }))
      );
    }
  );

  app.post<{ Params: { missionId: string }; Body: CreateZoneBody }>(
    '/missions/:missionId/zones',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: CreateZoneBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) {
        return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      }

      const mem = await getMembership(req.userId, missionId);
      // Allow any mission member (admin or member) to create zones
      if (!mem) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }
      if ((mem as any).role === 'viewer') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const body = req.body as any;
      const type = body?.type as ZoneType;
      if (!type) return reply.code(400).send({ error: 'TYPE_REQUIRED' });
      if (!body?.title?.trim()) return reply.code(400).send({ error: 'TITLE_REQUIRED' });
      if (!body?.color?.trim()) return reply.code(400).send({ error: 'COLOR_REQUIRED' });

      if (type === 'circle') {
        const err = validateCircle(body.circle);
        if (err) return reply.code(400).send(err);
      } else if (type === 'polygon') {
        const err = validatePolygon(body.polygon);
        if (err) return reply.code(400).send(err);
      }

      const now = new Date();
      const zone = await ZoneModel.create({
        missionId: new mongoose.Types.ObjectId(missionId),
        title: body.title.trim(),
        comment: typeof body.comment === 'string' ? body.comment.trim() : '',
        color: body.color.trim(),
        type,
        circle: type === 'circle' ? body.circle : undefined,
        polygon: type === 'polygon' ? body.polygon : undefined,
        grid: body.grid ? { rows: body.grid.rows, cols: body.grid.cols, orientation: body.grid.orientation } : undefined,
        sectors:
          Array.isArray(body.sectors)
            ? body.sectors.map((s: any) => ({
                sectorId: new mongoose.Types.ObjectId(s.sectorId),
                color: s.color,
                geometry: s.geometry,
              }))
            : undefined,
        createdBy: new mongoose.Types.ObjectId(req.userId),
        createdAt: now,
        updatedAt: now,
      });

      const dto = {
        id: zone._id.toString(),
        title: zone.title,
        comment: (zone as any).comment ?? '',
        color: zone.color,
        type: zone.type,
        circle: zone.circle ?? null,
        polygon: zone.polygon ?? null,
        grid: (zone as any).grid ?? null,
        sectors:
          zone.sectors?.map((s) => ({
            sectorId: s.sectorId.toString(),
            color: s.color,
            geometry: s.geometry,
          })) ?? null,
        createdBy: zone.createdBy.toString(),
        createdAt: zone.createdAt,
        updatedAt: zone.updatedAt,
      };

      // Inclure le surnom du créateur directement dans l'événement socket.
      let createdByDisplayName: string | undefined;
      try {
        const user = await UserModel.findById(req.userId).select({ displayName: 1, appUserId: 1 }).lean();
        if (user) {
          const dn = typeof (user as any).displayName === 'string' ? (user as any).displayName.trim() : '';
          const appId = typeof (user as any).appUserId === 'string' ? (user as any).appUserId.trim() : '';
          createdByDisplayName = dn || appId || undefined;
        }
      } catch {
        // non bloquant
      }

      app.io?.to(`mission:${missionId}`).emit('zone:created', {
        missionId,
        zone: { ...dto, createdAt: dto.createdAt.toISOString(), updatedAt: dto.updatedAt.toISOString() },
        createdByDisplayName,
      });

      return reply.code(201).send(dto);
    }
  );

  app.patch<{ Params: { missionId: string; zoneId: string }; Body: UpdateZoneBody }>(
    '/missions/:missionId/zones/:zoneId',
    async (req: FastifyRequest<{ Params: { missionId: string; zoneId: string }; Body: UpdateZoneBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, zoneId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(zoneId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const existingZone = await ZoneModel.findOne({ _id: zoneId, missionId })
        .select({ grid: 1, assignments: 1 })
        .lean();
      if (!existingZone) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const body = req.body as any;
      const update: any = { updatedAt: new Date() };

      if (body.type) update.type = body.type;
      if (typeof body.title === 'string') update.title = body.title.trim();
      if (typeof body.comment === 'string') update.comment = body.comment.trim();
      if (typeof body.color === 'string') update.color = body.color.trim();
      if (body.circle) {
        const err = validateCircle(body.circle);
        if (err) return reply.code(400).send(err);
        update.circle = body.circle;
      }
      if (body.polygon) {
        const err = validatePolygon(body.polygon);
        if (err) return reply.code(400).send(err);
        update.polygon = body.polygon;
      }
      if (Array.isArray(body.sectors)) {
        update.sectors = body.sectors.map((s: any) => ({
          sectorId: new mongoose.Types.ObjectId(s.sectorId),
          color: s.color,
          geometry: s.geometry,
        }));
      }

      const unset: any = {};
      if (body.grid === null) unset.grid = 1;
      if (body.grid && typeof body.grid.rows === 'number' && typeof body.grid.cols === 'number') {
        update.grid = { rows: body.grid.rows, cols: body.grid.cols, orientation: body.grid.orientation };
      }

      // Si la grille change de dimensions/orientation (ou est supprimée), les gridCellId
      // existants ("C3", ...) ont été calculés pour l'ancienne grille. Un simple contrôle de
      // bornes (isGridCellIdWithinGrid) ne suffit pas à décider quoi garder : "C3" peut rester
      // structurellement valide dans la nouvelle grille (ex. 12x12 -> 10x10) tout en désignant
      // un endroit différent sur le terrain -> le garder serait une assignation silencieusement
      // fausse, plus dangereuse qu'une case orpheline (12x12 -> 4x4). On ne tente donc aucun
      // remapping : dès que les dimensions/orientation changent réellement, tout gridCellId
      // existant est effacé sans condition (l'assignation redevient une assignation "zone
      // entière", format déjà accepté ailleurs dans ce fichier pour une assignation sans case).
      const currentGrid = (existingZone as any).grid as ZoneGrid | undefined;
      const newGrid: ZoneGrid | null = unset.grid ? null : (update.grid as ZoneGrid | undefined) ?? null;
      const gridIsChanging =
        currentGrid !== undefined &&
        (unset.grid ||
          (update.grid &&
            (currentGrid.rows !== newGrid!.rows ||
              currentGrid.cols !== newGrid!.cols ||
              (currentGrid.orientation ?? undefined) !== (newGrid!.orientation ?? undefined))));

      let assignmentsChanged = false;
      if (gridIsChanging) {
        const existingAssignments = (existingZone.assignments ?? []) as any[];
        let clearedCount = 0;
        const sanitized = existingAssignments.map((a) => {
          if (!a.gridCellId) return a;
          clearedCount++;
          return { userId: a.userId, assignedAt: a.assignedAt, assignedByUserId: a.assignedByUserId };
        });
        if (clearedCount > 0) {
          update.assignments = sanitized;
          assignmentsChanged = true;
        }
      }

      const updateDoc: any = { $set: update };
      if (Object.keys(unset).length) updateDoc.$unset = unset;

      const zone = await ZoneModel.findOneAndUpdate({ _id: zoneId, missionId }, updateDoc, { new: true }).lean();
      if (!zone) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const dto = {
        id: zone._id.toString(),
        title: zone.title,
        comment: (zone as any).comment ?? '',
        color: zone.color,
        type: zone.type,
        circle: zone.circle ?? null,
        polygon: zone.polygon ?? null,
        grid: (zone as any).grid ?? null,
        sectors:
          zone.sectors?.map((s) => ({
            sectorId: s.sectorId.toString(),
            color: s.color,
            geometry: s.geometry,
          })) ?? null,
        createdBy: zone.createdBy.toString(),
        createdAt: zone.createdAt,
        updatedAt: zone.updatedAt,
      };

      app.io?.to(`mission:${missionId}`).emit('zone:updated', {
        missionId,
        zone: { ...dto, createdAt: dto.createdAt.toISOString(), updatedAt: dto.updatedAt.toISOString() },
      });

      // zone:updated ne transporte pas assignments : si le changement de grille a invalidé
      // des gridCellId, on émet aussi l'événement dédié déjà utilisé par les routes
      // d'assignation ci-dessous pour que les clients connectés se mettent à jour.
      if (assignmentsChanged) {
        const assignmentsDto = (zone.assignments ?? []).map((a: any) => ({
          userId: a.userId.toString(),
          assignedAt: a.assignedAt.toISOString(),
          assignedByUserId: a.assignedByUserId.toString(),
          gridCellId: a.gridCellId ?? null,
        }));
        app.io?.to(`mission:${missionId}`).emit('zone:assignments:changed', {
          missionId,
          zoneId: zone._id.toString(),
          assignments: assignmentsDto,
        });
      }

      return reply.send(dto);
    }
  );

  app.delete<{ Params: { missionId: string; zoneId: string } }>(
    '/missions/:missionId/zones/:zoneId',
    async (req: FastifyRequest<{ Params: { missionId: string; zoneId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, zoneId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(zoneId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const mem = await getMembership(req.userId, missionId);
      // Autoriser les admins et les utilisateurs (member) à supprimer des zones.
      // Seuls les visualisateurs (viewer) sont bloqués.
      if (!mem || (mem as any).role === 'viewer') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const res = await ZoneModel.deleteOne({ _id: zoneId, missionId });
      if (res.deletedCount === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      app.io?.to(`mission:${missionId}`).emit('zone:deleted', { missionId, zoneId });

      return reply.send({ ok: true });
    }
  );

  app.post<{ Params: { zoneId: string }; Body: { userIds: string[]; gridCellId?: string } }>(
    '/zones/:zoneId/assignments',
    async (req: FastifyRequest<{ Params: { zoneId: string }; Body: { userIds: string[]; gridCellId?: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { zoneId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(zoneId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const body = req.body as any;
      const userIds = body?.userIds;
      const gridCellId = body?.gridCellId;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        return reply.code(400).send({ error: 'INVALID_BODY' });
      }
      if (userIds.length > 50) {
        return reply.code(400).send({ error: 'TOO_MANY_USERS' });
      }
      for (const uid of userIds) {
        if (!mongoose.Types.ObjectId.isValid(uid)) {
          return reply.code(400).send({ error: 'INVALID_ID' });
        }
      }

      const zone = await ZoneModel.findById(zoneId).lean();
      if (!zone) {
        return reply.code(404).send({ error: 'ZONE_NOT_FOUND' });
      }

      const adminMembership = await getActiveAdminMembership(zone.missionId, req.userId);
      if (!adminMembership) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const validMemberships = await MissionMemberModel.find({
        missionId: zone.missionId,
        userId: { $in: userIds },
        removedAt: null,
      }).select({ userId: 1 }).lean();
      const validUserIds = new Set(validMemberships.map((m) => m.userId.toString()));
      const filteredUserIds = userIds.filter((uid) => validUserIds.has(uid));

      if (filteredUserIds.length === 0) {
        return reply.code(400).send({ error: 'NO_VALID_MEMBERS' });
      }

      // Validation gridCellId
      if (gridCellId !== undefined) {
        if (typeof gridCellId !== 'string' || !/^[A-Z]\d+$/.test(gridCellId)) {
          return reply.code(400).send({ error: 'INVALID_GRID_CELL_ID' });
        }
        if (!zone.grid?.rows || !zone.grid?.cols) {
          return reply.code(400).send({ error: 'ZONE_HAS_NO_GRID' });
        }
        // Les grilles diag45 utilisent une géométrie/numérotation différente du décodage
        // axis-aligned utilisé côté rendu → une assignation par carré pointerait au mauvais endroit.
        if ((zone.grid as any)?.orientation === 'diag45') {
          return reply.code(400).send({ error: 'GRID_ORIENTATION_NOT_ASSIGNABLE' });
        }
        const m = gridCellId.match(/^([A-Z])(\d+)$/)!;
        const col = m[1].charCodeAt(0) - 65;
        const row = parseInt(m[2], 10) - 1;
        if (col < 0 || col >= zone.grid.cols || row < 0 || row >= zone.grid.rows) {
          return reply.code(400).send({ error: 'GRID_CELL_OUT_OF_BOUNDS' });
        }
      }

      // Pour chaque user, push atomique conditionné à l'absence du couple (userId, gridCellId)
      const newlyAssignedUserIds: string[] = [];
      for (const uid of filteredUserIds) {
        const matchClause = gridCellId
          ? { userId: new mongoose.Types.ObjectId(uid), gridCellId }
          : { userId: new mongoose.Types.ObjectId(uid), gridCellId: { $exists: false } };
        const res = await ZoneModel.updateOne(
          { _id: zoneId, assignments: { $not: { $elemMatch: matchClause } } },
          { $push: { assignments: { userId: new mongoose.Types.ObjectId(uid), assignedAt: new Date(),
            assignedByUserId: new mongoose.Types.ObjectId(req.userId), ...(gridCellId ? { gridCellId } : {}) } } }
        );
        if (res.modifiedCount === 1) newlyAssignedUserIds.push(uid);
      }

      const updated = await ZoneModel.findById(zoneId).lean();

      const assigner = await UserModel.findById(req.userId).select({ displayName: 1 }).lean();

      // Notify newly assigned users
      for (const uid of newlyAssignedUserIds) {
        app.io?.to(`user:${uid}`).emit('zone:assigned:you', {
          missionId: zone.missionId.toString(),
          zoneId: zone._id.toString(),
          zoneName: zone.title,
          assignedByUserName: assigner?.displayName ?? null,
        });
      }

      const assignmentsDto = (updated!.assignments ?? []).map((a: any) => ({
        userId: a.userId.toString(),
        assignedAt: a.assignedAt.toISOString(),
        assignedByUserId: a.assignedByUserId.toString(),
        gridCellId: a.gridCellId ?? null,
      }));

      app.io?.to(`mission:${zone.missionId}`).emit('zone:assignments:changed', {
        missionId: zone.missionId.toString(),
        zoneId: zone._id.toString(),
        assignments: assignmentsDto,
      });

      return reply.send({
        ok: true,
        assignments: assignmentsDto,
        newlyAssignedCount: newlyAssignedUserIds.length,
      });
    }
  );

  app.delete<{ Params: { zoneId: string; userId: string }; Querystring: { gridCellId?: string } }>(
    '/zones/:zoneId/assignments/:userId',
    async (req: FastifyRequest<{ Params: { zoneId: string; userId: string }; Querystring: { gridCellId?: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { zoneId, userId } = req.params;
      const { gridCellId } = req.query;
      if (!mongoose.Types.ObjectId.isValid(zoneId) || !mongoose.Types.ObjectId.isValid(userId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const zone = await ZoneModel.findById(zoneId).lean();
      if (!zone) {
        return reply.code(404).send({ error: 'ZONE_NOT_FOUND' });
      }

      const adminMembership = await getActiveAdminMembership(zone.missionId, req.userId);
      if (!adminMembership) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      if (!zone.grid && gridCellId) {
        return reply.code(400).send({ error: 'ZONE_HAS_NO_GRID' });
      }

      const pullRes = await ZoneModel.updateOne(
        { _id: zoneId },
        { $pull: { assignments: { userId: new mongoose.Types.ObjectId(userId), ...(gridCellId ? { gridCellId } : { gridCellId: { $exists: false } }) } } }
      );

      const updated = await ZoneModel.findById(zoneId).lean();

      const assignmentsDto = (updated!.assignments ?? []).map((a: any) => ({
        userId: a.userId.toString(),
        assignedAt: a.assignedAt.toISOString(),
        assignedByUserId: a.assignedByUserId.toString(),
        gridCellId: a.gridCellId ?? null,
      }));

      app.io?.to(`mission:${zone.missionId}`).emit('zone:assignments:changed', {
        missionId: zone.missionId.toString(),
        zoneId: zone._id.toString(),
        assignments: assignmentsDto,
      });

      return reply.send({ ok: true, removedCount: pullRes.modifiedCount, assignments: assignmentsDto });
    }
  );
}

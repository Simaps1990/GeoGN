import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { ZoneModel, type ZoneType } from '../models/zone.js';

type GeoJSONPolygon = {
  type: 'Polygon';
  coordinates: number[][][];
};

type CreateZoneBody =
  | {
      type: 'circle';
      title: string;
      color: string;
      circle: { center: { lng: number; lat: number }; radiusMeters: number };
      sectors?: { sectorId: string; color: string; geometry: GeoJSONPolygon }[];
    }
  | {
      type: 'polygon';
      title: string;
      color: string;
      polygon: GeoJSONPolygon;
      sectors?: { sectorId: string; color: string; geometry: GeoJSONPolygon }[];
    };

type UpdateZoneBody = Partial<CreateZoneBody>;

async function getMembership(userId: string, missionId: string) {
  return MissionMemberModel.findOne({ missionId, userId, removedAt: null }).lean();
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
          color: z.color,
          type: z.type,
          circle: z.circle ?? null,
          polygon: z.polygon ?? null,
          sectors:
            z.sectors?.map((s) => ({
              sectorId: s.sectorId.toString(),
              color: s.color,
              geometry: s.geometry,
            })) ?? null,
          createdBy: z.createdBy.toString(),
          createdAt: z.createdAt,
          updatedAt: z.updatedAt,
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

      const body = req.body as any;
      const type = body?.type as ZoneType;
      if (!type) return reply.code(400).send({ error: 'TYPE_REQUIRED' });
      if (!body?.title?.trim()) return reply.code(400).send({ error: 'TITLE_REQUIRED' });
      if (!body?.color?.trim()) return reply.code(400).send({ error: 'COLOR_REQUIRED' });

      const now = new Date();
      const zone = await ZoneModel.create({
        missionId: new mongoose.Types.ObjectId(missionId),
        title: body.title.trim(),
        color: body.color.trim(),
        type,
        circle: type === 'circle' ? body.circle : undefined,
        polygon: type === 'polygon' ? body.polygon : undefined,
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
        color: zone.color,
        type: zone.type,
        circle: zone.circle ?? null,
        polygon: zone.polygon ?? null,
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

      app.io?.to(`mission:${missionId}`).emit('zone:created', { missionId, zone: dto });

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
      if (!mem || mem.role !== 'admin') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const body = req.body as any;
      const update: any = { updatedAt: new Date() };

      if (body.type) update.type = body.type;
      if (typeof body.title === 'string') update.title = body.title.trim();
      if (typeof body.color === 'string') update.color = body.color.trim();
      if (body.circle) update.circle = body.circle;
      if (body.polygon) update.polygon = body.polygon;
      if (Array.isArray(body.sectors)) {
        update.sectors = body.sectors.map((s: any) => ({
          sectorId: new mongoose.Types.ObjectId(s.sectorId),
          color: s.color,
          geometry: s.geometry,
        }));
      }

      const zone = await ZoneModel.findOneAndUpdate({ _id: zoneId, missionId }, { $set: update }, { new: true }).lean();
      if (!zone) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const dto = {
        id: zone._id.toString(),
        title: zone.title,
        color: zone.color,
        type: zone.type,
        circle: zone.circle ?? null,
        polygon: zone.polygon ?? null,
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

      app.io?.to(`mission:${missionId}`).emit('zone:updated', { missionId, zone: dto });

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
      if (!mem || mem.role !== 'admin') {
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
}

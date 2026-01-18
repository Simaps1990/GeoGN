import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { PoiModel, type PoiType } from '../models/poi.js';
import { UserModel } from '../models/user.js';

type CreatePoiBody = {
  type: PoiType;
  title: string;
  icon: string;
  color: string;
  comment: string;
  lng: number;
  lat: number;
};

type UpdatePoiBody = {
  type?: PoiType;
  title?: string;
  icon?: string;
  color?: string;
  comment?: string;
  lng?: number;
  lat?: number;
};

async function getMembership(userId: string, missionId: string) {
  return MissionMemberModel.findOne({ missionId, userId, removedAt: null }).lean();
}

export async function poisRoutes(app: FastifyInstance) {
  app.get<{ Params: { missionId: string } }>(
    '/missions/:missionId/pois',
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
      const pois = await PoiModel.find({ missionId, deletedAt: { $exists: false } }).sort({ createdAt: -1 }).lean();
      return reply.send(
        pois.map((p) => ({
          id: p._id.toString(),
          type: p.type,
          title: p.title,
          icon: p.icon,
          color: p.color,
          comment: p.comment,
          lng: p.loc.coordinates[0],
          lat: p.loc.coordinates[1],
          createdBy: p.createdBy.toString(),
          createdAt: p.createdAt,
        }))
      );
    }
  );

  app.post<{ Params: { missionId: string }; Body: CreatePoiBody }>(
    '/missions/:missionId/pois',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: CreatePoiBody }>, reply: FastifyReply) => {
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
      if ((mem as any).role === 'viewer') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const { type, title, icon, color, comment, lng, lat } = req.body;
      if (!type) return reply.code(400).send({ error: 'TYPE_REQUIRED' });
      if (!title?.trim()) return reply.code(400).send({ error: 'TITLE_REQUIRED' });
      if (!icon?.trim()) return reply.code(400).send({ error: 'ICON_REQUIRED' });
      if (!color?.trim()) return reply.code(400).send({ error: 'COLOR_REQUIRED' });
      if (!comment?.trim()) return reply.code(400).send({ error: 'COMMENT_REQUIRED' });
      if (typeof lng !== 'number' || typeof lat !== 'number') return reply.code(400).send({ error: 'INVALID_LOCATION' });

      const poi = await PoiModel.create({
        missionId: new mongoose.Types.ObjectId(missionId),
        createdBy: new mongoose.Types.ObjectId(req.userId),
        type,
        title: title.trim(),
        icon: icon.trim(),
        color: color.trim(),
        comment: comment.trim(),
        loc: { type: 'Point', coordinates: [lng, lat] },
        createdAt: new Date(),
      });

      const dto = {
        id: poi._id.toString(),
        type: poi.type,
        title: poi.title,
        icon: poi.icon,
        color: poi.color,
        comment: poi.comment,
        lng: poi.loc.coordinates[0],
        lat: poi.loc.coordinates[1],
        createdBy: poi.createdBy.toString(),
        createdAt: poi.createdAt,
      };

      // Récupérer le displayName pour l'inclure directement dans l'événement socket
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

      app.io?.to(`mission:${missionId}`).emit('poi:created', { missionId, poi: dto, createdByDisplayName });

      return reply.code(201).send(dto);
    }
  );

  app.patch<{ Params: { missionId: string; poiId: string }; Body: UpdatePoiBody }>(
    '/missions/:missionId/pois/:poiId',
    async (req: FastifyRequest<{ Params: { missionId: string; poiId: string }; Body: UpdatePoiBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, poiId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(poiId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const mem = await getMembership(req.userId, missionId);
      if (!mem) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }
      if ((mem as any).role === 'viewer') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const update: any = {};
      if (req.body.type) update.type = req.body.type;
      if (typeof req.body.title === 'string') update.title = req.body.title.trim();
      if (typeof req.body.icon === 'string') update.icon = req.body.icon.trim();
      if (typeof req.body.color === 'string') update.color = req.body.color.trim();
      if (typeof req.body.comment === 'string') update.comment = req.body.comment.trim();
      if (typeof req.body.lng === 'number' && typeof req.body.lat === 'number') {
        update.loc = { type: 'Point', coordinates: [req.body.lng, req.body.lat] };
      }

      const poi = await PoiModel.findOneAndUpdate(
        { _id: poiId, missionId, deletedAt: { $exists: false } },
        { $set: update },
        { new: true }
      ).lean();

      if (!poi) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const dto = {
        id: poi._id.toString(),
        type: poi.type,
        title: poi.title,
        icon: poi.icon,
        color: poi.color,
        comment: poi.comment,
        lng: poi.loc.coordinates[0],
        lat: poi.loc.coordinates[1],
        createdBy: poi.createdBy.toString(),
        createdAt: poi.createdAt,

      };

      app.io?.to(`mission:${missionId}`).emit('poi:updated', { missionId, poi: dto });

      return reply.send(dto);
    }
  );

  app.delete<{ Params: { missionId: string; poiId: string } }>(
    '/missions/:missionId/pois/:poiId',
    async (req: FastifyRequest<{ Params: { missionId: string; poiId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, poiId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(poiId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const res = await PoiModel.deleteOne({ _id: poiId, missionId });
      if (!res.deletedCount) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      app.io?.to(`mission:${missionId}`).emit('poi:deleted', { missionId, poiId });

      return reply.send({ ok: true });
    }
  );
}

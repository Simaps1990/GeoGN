import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { PersonCaseModel } from '../models/personCase.js';
import { VehicleTrackModel } from '../models/vehicleTrack.js';
import { UserModel } from '../models/user.js';

type PersonCaseBody = {
  lastKnown: {
    type: 'address' | 'poi';
    query: string;
    poiId?: string;
    lng?: number;
    lat?: number;
    when?: string;
  };
  nextClue?: {
    type: 'address' | 'poi';
    query: string;
    poiId?: string;
    lng?: number;
    lat?: number;
    when?: string;
  };
  mobility: 'none' | 'bike' | 'scooter' | 'motorcycle' | 'car';
  age?: number;
  sex: 'unknown' | 'female' | 'male';
  healthStatus: 'stable' | 'fragile' | 'critique';
  diseases?: string[];
  injuries?: { id: string; locations?: string[] }[];
  diseasesFreeText?: string;
  injuriesFreeText?: string;
};

async function requireAdminMembership(userId: string, missionId: string) {
  return MissionMemberModel.findOne({ missionId, userId, removedAt: null, role: 'admin' }).lean();
}

async function requireAnyMembership(userId: string, missionId: string) {
  return MissionMemberModel.findOne({ missionId, userId, removedAt: null }).lean();
}

function toDto(doc: any) {
  return {
    id: doc._id.toString(),
    missionId: doc.missionId.toString(),
    createdBy: doc.createdBy.toString(),
    lastKnown: {
      type: doc.lastKnown?.type,
      query: doc.lastKnown?.query,
      poiId: doc.lastKnown?.poiId ? doc.lastKnown.poiId.toString() : undefined,
      lng: doc.lastKnown?.lng,
      lat: doc.lastKnown?.lat,
      when: doc.lastKnown?.when ? new Date(doc.lastKnown.when).toISOString() : null,
    },
    nextClue: doc.nextClue
      ? {
          type: doc.nextClue?.type,
          query: doc.nextClue?.query,
          poiId: doc.nextClue?.poiId ? doc.nextClue.poiId.toString() : undefined,
          lng: doc.nextClue?.lng,
          lat: doc.nextClue?.lat,
          when: doc.nextClue?.when ? new Date(doc.nextClue.when).toISOString() : null,
        }
      : null,
    mobility: doc.mobility,
    age: doc.age ?? null,
    sex: doc.sex,
    healthStatus: doc.healthStatus,
    diseases: Array.isArray(doc.diseases) ? doc.diseases : [],
    injuries: Array.isArray(doc.injuries)
      ? doc.injuries.map((x: any) => ({
          id: String(x?.id ?? ''),
          locations: Array.isArray(x?.locations) ? x.locations.map((l: any) => String(l)) : [],
        }))
      : [],
    diseasesFreeText: typeof doc.diseasesFreeText === 'string' ? doc.diseasesFreeText : '',
    injuriesFreeText: typeof doc.injuriesFreeText === 'string' ? doc.injuriesFreeText : '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function personCasesRoutes(app: FastifyInstance) {
  // Read current person case for a mission (any mission member)
  app.get<{ Params: { missionId: string } }>(
    '/missions/:missionId/person-case',
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

      const mem = await requireAnyMembership(req.userId, missionId);
      if (!mem) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const doc = await PersonCaseModel.findOne({ missionId }).lean();
      if (!doc) {
        return reply.send({ case: null });
      }

      return reply.send({ case: toDto(doc) });
    }
  );

  // Delete person case for a mission (admin-only)
  app.delete<{ Params: { missionId: string } }>(
    '/missions/:missionId/person-case',
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

      const admin = await requireAdminMembership(req.userId, missionId);
      if (!admin) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const missionObjectId = new mongoose.Types.ObjectId(missionId);

      // Cascade delete: when removing the person case, also remove all vehicle tracks
      // (isochrone / road_graph) for the mission so nothing can persist in Mongo.
      const existingTracks = await VehicleTrackModel.find({ missionId: missionObjectId })
        .select({ _id: 1 })
        .lean();

      if (existingTracks.length) {
        await VehicleTrackModel.deleteMany({ missionId: missionObjectId });
        for (const t of existingTracks) {
          app.io?.to(`mission:${missionId}`).emit('vehicle-track:deleted', {
            missionId,
            trackId: (t as any)._id.toString(),
            actorUserId: req.userId,
          });
        }
      }

      const res = await PersonCaseModel.deleteOne({ missionId: missionObjectId });
      if ((res as any)?.deletedCount) {
        app.io?.to(`mission:${missionId}`).emit('person-case:deleted', { missionId, actorUserId: req.userId });
      }
      return reply.send({ ok: true });
    }
  );

  // Create or update person case for a mission (admin-only)
  app.put<{ Params: { missionId: string }; Body: PersonCaseBody }>(
    '/missions/:missionId/person-case',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: PersonCaseBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) {
        return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      }

      const admin = await requireAdminMembership(req.userId, missionId);
      if (!admin) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const existing = await PersonCaseModel.findOne({ missionId }).select({ _id: 1 }).lean();
      const created = !existing;

      const body = req.body as any;
      const lastKnownType = body?.lastKnown?.type;
      const lastKnownQuery = (body?.lastKnown?.query ?? '').trim();
      if (lastKnownType !== 'address' && lastKnownType !== 'poi') {
        return reply.code(400).send({ error: 'LAST_KNOWN_TYPE_REQUIRED' });
      }
      if (!lastKnownQuery) {
        return reply.code(400).send({ error: 'LAST_KNOWN_QUERY_REQUIRED' });
      }

      const mobility = body?.mobility;
      if (!['none', 'bike', 'scooter', 'motorcycle', 'car'].includes(mobility)) {
        return reply.code(400).send({ error: 'MOBILITY_REQUIRED' });
      }

      const sex = body?.sex;
      if (!['unknown', 'female', 'male'].includes(sex)) {
        return reply.code(400).send({ error: 'SEX_REQUIRED' });
      }

      const healthStatus = body?.healthStatus;
      if (!['stable', 'fragile', 'critique'].includes(healthStatus)) {
        return reply.code(400).send({ error: 'HEALTH_STATUS_REQUIRED' });
      }

      let age: number | undefined = undefined;
      if (typeof body.age === 'number') {
        const v = Math.floor(body.age);
        if (Number.isFinite(v) && v >= 0 && v <= 120) age = v;
      }

      let poiId: mongoose.Types.ObjectId | undefined = undefined;
      if (lastKnownType === 'poi' && typeof body?.lastKnown?.poiId === 'string') {
        if (mongoose.Types.ObjectId.isValid(body.lastKnown.poiId)) {
          poiId = new mongoose.Types.ObjectId(body.lastKnown.poiId);
        }
      }

      const lng = typeof body?.lastKnown?.lng === 'number' ? body.lastKnown.lng : undefined;
      const lat = typeof body?.lastKnown?.lat === 'number' ? body.lastKnown.lat : undefined;

      let when: Date | undefined = undefined;
      if (typeof body?.lastKnown?.when === 'string' && body.lastKnown.when.trim()) {
        const d = new Date(body.lastKnown.when);
        if (!Number.isNaN(d.getTime())) when = d;
      }

      if (when && when.getTime() > Date.now()) {
        return reply.code(400).send({ error: 'FUTURE_WHEN' });
      }

      let nextClue: any = undefined;
      if (body?.nextClue) {
        const ncType = body.nextClue.type;
        const ncQuery = (body.nextClue.query ?? '').trim();
        if (ncType === 'address' || ncType === 'poi') {
          if (ncQuery) {
            let ncPoiId: mongoose.Types.ObjectId | undefined = undefined;
            if (ncType === 'poi' && typeof body.nextClue.poiId === 'string') {
              if (mongoose.Types.ObjectId.isValid(body.nextClue.poiId)) {
                ncPoiId = new mongoose.Types.ObjectId(body.nextClue.poiId);
              }
            }
            const ncLng = typeof body.nextClue.lng === 'number' ? body.nextClue.lng : undefined;
            const ncLat = typeof body.nextClue.lat === 'number' ? body.nextClue.lat : undefined;
            let ncWhen: Date | undefined = undefined;
            if (typeof body.nextClue.when === 'string' && body.nextClue.when.trim()) {
              const d2 = new Date(body.nextClue.when);
              if (!Number.isNaN(d2.getTime())) ncWhen = d2;
            }
            nextClue = {
              type: ncType,
              query: ncQuery,
              poiId: ncPoiId,
              lng: ncLng,
              lat: ncLat,
              when: ncWhen,
            };
          }
        }
      }

      const diseases = Array.isArray(body?.diseases)
        ? body.diseases
            .map((x: any) => (typeof x === 'string' ? x.trim() : ''))
            .filter((x: string) => !!x)
        : [];

      const injuries = Array.isArray(body?.injuries)
        ? body.injuries
            .map((x: any) => {
              const id = typeof x?.id === 'string' ? x.id.trim() : '';
              if (!id) return null;
              const locations = Array.isArray(x?.locations)
                ? x.locations
                    .map((l: any) => (typeof l === 'string' ? l.trim() : ''))
                    .filter((l: string) => !!l)
                : [];
              return { id, locations };
            })
            .filter(Boolean)
        : [];

      const update: any = {
        updatedAt: new Date(),
        lastKnown: {
          type: lastKnownType,
          query: lastKnownQuery,
          poiId,
          lng,
          lat,
          when,
        },
        nextClue,
        mobility,
        age,
        sex,
        healthStatus,
        diseases,
        injuries,
        diseasesFreeText: typeof body.diseasesFreeText === 'string' ? body.diseasesFreeText.trim() : '',
        injuriesFreeText: typeof body.injuriesFreeText === 'string' ? body.injuriesFreeText.trim() : '',
      };

      const now = new Date();
      const doc = await PersonCaseModel.findOneAndUpdate(
        { missionId },
        {
          $set: update,
          $setOnInsert: {
            missionId: new mongoose.Types.ObjectId(missionId),
            createdBy: new mongoose.Types.ObjectId(req.userId),
            createdAt: now,
          },
        },
        { new: true, upsert: true }
      ).lean();

      const dto = toDto(doc);

      let actorDisplayName: string | undefined;
      try {
        const user = await UserModel.findById(req.userId).select({ displayName: 1, appUserId: 1 }).lean();
        if (user) {
          const dn = typeof (user as any).displayName === 'string' ? (user as any).displayName.trim() : '';
          const appId = typeof (user as any).appUserId === 'string' ? (user as any).appUserId.trim() : '';
          actorDisplayName = dn || appId || undefined;
        }
      } catch {
        // non bloquant
      }

      app.io?.to(`mission:${missionId}`).emit('person-case:upserted', {
        missionId,
        case: dto,
        actorUserId: req.userId,
        actorDisplayName,
        created,
      });

      return reply.send({ case: dto });
    }
  );
}

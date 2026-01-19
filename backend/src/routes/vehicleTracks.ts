import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionModel } from '../models/mission.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { UserModel } from '../models/user.js';
import { VehicleTrackModel } from '../models/vehicleTrack.js';
import { computeVehicleTomtomReachableRange } from '../traffic/computeVehicleTomtomReachableRange.js';

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
    label: doc.label,
    vehicleType: doc.vehicleType,
    origin: {
      type: doc.origin?.type,
      query: doc.origin?.query,
      poiId: doc.origin?.poiId ? doc.origin.poiId.toString() : undefined,
      lng: doc.origin?.lng,
      lat: doc.origin?.lat,
      when: doc.origin?.when ? new Date(doc.origin.when).toISOString() : null,
    },
    startedAt: doc.startedAt ? new Date(doc.startedAt).toISOString() : null,
    maxDurationSeconds: typeof doc.maxDurationSeconds === 'number' ? doc.maxDurationSeconds : 3600,
    trafficRefreshSeconds: typeof doc.trafficRefreshSeconds === 'number' ? doc.trafficRefreshSeconds : 60,
    status: doc.status,
    algorithm: doc.algorithm,
    lastComputedAt: doc.lastComputedAt ? new Date(doc.lastComputedAt).toISOString() : null,
    cache: doc.cache
      ? {
          computedAt: doc.cache.computedAt ? new Date(doc.cache.computedAt).toISOString() : null,
          elapsedSeconds:
            typeof doc.cache.elapsedSeconds === 'number' ? doc.cache.elapsedSeconds : 0,
          payloadGeojson: doc.cache.payloadGeojson ?? null,
          meta: doc.cache.meta ?? null,
        }
      : null,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
  };
}

type CreateVehicleTrackBody = {
  label: string;
  vehicleType: 'car' | 'motorcycle' | 'scooter' | 'truck' | 'unknown';
  origin: {
    type: 'address' | 'poi';
    query: string;
    poiId?: string;
    lng?: number;
    lat?: number;
    when?: string;
  };
  startedAt?: string;
  maxDurationSeconds?: number;
  algorithm?: 'mvp_isoline' | 'road_graph';
};

type UpdateVehicleTrackBody = Partial<CreateVehicleTrackBody> & {
  status?: 'active' | 'stopped' | 'expired';
};

export async function vehicleTracksRoutes(app: FastifyInstance) {
  app.get<{
    Params: { missionId: string };
    Querystring: {
      status?: 'active' | 'stopped' | 'expired';
      vehicleType?: 'car' | 'motorcycle' | 'scooter' | 'truck' | 'unknown';
      q?: string;
      limit?: string;
      offset?: string;
    };
  }>(
    '/missions/:missionId/vehicle-tracks',
    async (
      req: FastifyRequest<{
        Params: { missionId: string };
        Querystring: {
          status?: 'active' | 'stopped' | 'expired';
          vehicleType?: 'car' | 'motorcycle' | 'scooter' | 'truck' | 'unknown';
          q?: string;
          limit?: string;
          offset?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) {
        return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      }

      const mem = await requireAnyMembership((req as any).userId, missionId);
      if (!mem) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const { status, vehicleType, q } = req.query;
      let limit = 20;
      let offset = 0;
      if (typeof req.query.limit === 'string') {
        const v = parseInt(req.query.limit, 10);
        if (Number.isFinite(v) && v > 0) limit = Math.min(50, v);
      }
      if (typeof req.query.offset === 'string') {
        const v = parseInt(req.query.offset, 10);
        if (Number.isFinite(v) && v >= 0) offset = v;
      }

      const filter: any = { missionId: new mongoose.Types.ObjectId(missionId) };
      if (status && ['active', 'stopped', 'expired'].includes(status)) {
        filter.status = status;
      }
      if (vehicleType && ['car', 'motorcycle', 'scooter', 'truck', 'unknown'].includes(vehicleType)) {
        filter.vehicleType = vehicleType;
      }
      if (q && q.trim()) {
        filter.label = { $regex: q.trim(), $options: 'i' };
      }

      const [docs, total] = await Promise.all([
        VehicleTrackModel.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
        VehicleTrackModel.countDocuments(filter),
      ]);

      const tracks = docs.map((d) => toDto(d));

      return reply.send({ tracks, total });
    }
  );

  app.post<{
    Params: { missionId: string };
    Body: CreateVehicleTrackBody;
  }>(
    '/missions/:missionId/vehicle-tracks',
    async (
      req: FastifyRequest<{
        Params: { missionId: string };
        Body: CreateVehicleTrackBody;
      }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) {
        return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      }

      const admin = await requireAdminMembership((req as any).userId, missionId);
      if (!admin) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const body = req.body as any;

      const label = typeof body?.label === 'string' ? body.label.trim() : '';
      if (!label) {
        return reply.code(400).send({ error: 'LABEL_REQUIRED' });
      }

      const vehicleType = body?.vehicleType;
      if (!['car', 'motorcycle', 'scooter', 'truck', 'unknown'].includes(vehicleType)) {
        return reply.code(400).send({ error: 'VEHICLE_TYPE_REQUIRED' });
      }

      const originType = body?.origin?.type;
      const originQuery = (body?.origin?.query ?? '').trim();
      if (originType !== 'address' && originType !== 'poi') {
        return reply.code(400).send({ error: 'ORIGIN_TYPE_REQUIRED' });
      }
      if (!originQuery) {
        return reply.code(400).send({ error: 'ORIGIN_QUERY_REQUIRED' });
      }

      let originPoiId: mongoose.Types.ObjectId | undefined = undefined;
      if (originType === 'poi' && typeof body?.origin?.poiId === 'string') {
        if (mongoose.Types.ObjectId.isValid(body.origin.poiId)) {
          originPoiId = new mongoose.Types.ObjectId(body.origin.poiId);
        }
      }

      const originLng = typeof body?.origin?.lng === 'number' ? body.origin.lng : undefined;
      const originLat = typeof body?.origin?.lat === 'number' ? body.origin.lat : undefined;

      // Garantit au plus un suivi actif par mission côté backend.
      // Si un autre track est encore "active" pour cette mission, on le bascule en "stopped"
      // et on vide son cache avant de créer le nouveau.
      const missionObjectId = new mongoose.Types.ObjectId(missionId);
      const existingActive = await VehicleTrackModel.findOneAndUpdate(
        { missionId: missionObjectId, status: 'active' },
        { $set: { status: 'stopped', cache: undefined } },
        { new: true }
      ).lean();

      if (existingActive) {
        app.io?.to(`mission:${missionId}`).emit('vehicle-track:updated', {
          missionId,
          trackId: existingActive._id.toString(),
          status: existingActive.status,
        });
      }

      let originWhen: Date | undefined = undefined;
      if (typeof body?.origin?.when === 'string' && body.origin.when.trim()) {
        const d = new Date(body.origin.when);
        if (!Number.isNaN(d.getTime())) originWhen = d;
      }

      if (originWhen && originWhen.getTime() > Date.now()) {
        return reply.code(400).send({ error: 'FUTURE_WHEN' });
      }

      let startedAt: Date = new Date();
      if (typeof body?.startedAt === 'string' && body.startedAt.trim()) {
        const d = new Date(body.startedAt);
        if (!Number.isNaN(d.getTime())) startedAt = d;
      }

      let maxDurationSeconds: number = 7200;
      if (typeof body?.maxDurationSeconds === 'number') {
        const v = Math.floor(body.maxDurationSeconds);
        if (Number.isFinite(v)) {
          maxDurationSeconds = Math.max(60, Math.min(7200, v));
        }
      }

      const algorithm: 'mvp_isoline' | 'road_graph' =
        body?.algorithm === 'road_graph' ? 'road_graph' : 'mvp_isoline';

      const isTestCreate = /TEST/i.test(label) || algorithm === 'road_graph';

      const doc = await VehicleTrackModel.create({
        missionId: missionObjectId,
        createdBy: new mongoose.Types.ObjectId((req as any).userId),
        label,
        vehicleType,
        origin: {
          type: originType,
          query: originQuery,
          poiId: originPoiId,
          lng: originLng,
          lat: originLat,
          when: originWhen,
        },
        startedAt,
        maxDurationSeconds,
        trafficRefreshSeconds: 60,
        status: 'active',
        algorithm,
        lastComputedAt: undefined,
        cache: undefined,
      } as any);

      // Pour les pistes TEST, on calcule immédiatement le premier isochrone (40s)
      // afin d'avoir une forme dès la fermeture du popup.
      let finalDto = toDto(doc.toObject());
      try {
        const isTest = isTestCreate;
        if (isTest && typeof originLng === 'number' && typeof originLat === 'number') {
          const firstBudgetSec = (() => {
            const step = 20;
            const nowMs = Date.now();
            const startedAtMs = startedAt instanceof Date ? startedAt.getTime() : nowMs;
            const baseElapsed = originWhen ? Math.max(0, Math.floor((startedAtMs - originWhen.getTime()) / 1000)) : 0;
            const stepped = Math.floor(baseElapsed / step) * step;
            const maxSec = 43_200;
            return Math.min(maxSec, Math.max(40, stepped));
          })();
          const result = await computeVehicleTomtomReachableRange({
            lng: originLng,
            lat: originLat,
            elapsedSeconds: firstBudgetSec,
            maxBudgetSeconds: firstBudgetSec,
            vehicleType,
            label,
          });

          // S'assurer que le GeoJSON embarque bien budgetSec=20 (clé côté front).
          try {
            const f0: any = (result.geojson as any)?.features?.[0];
            if (f0?.properties && typeof f0.properties === 'object') {
              f0.properties.budgetSec = firstBudgetSec;
            }
          } catch {
            // ignore
          }

          const now = new Date();
          const updated = await VehicleTrackModel.findByIdAndUpdate(
            doc._id,
            {
              $set: {
                lastComputedAt: now,
                cache: {
                  computedAt: now,
                  elapsedSeconds: firstBudgetSec,
                  payloadGeojson: result.geojson,
                  meta: {
                    ...result.meta,
                    provider: 'tomtom_reachable_range',
                    budgetSec: firstBudgetSec,
                  },
                },
              },
            },
            { new: true }
          ).lean();
          if (updated) {
            finalDto = toDto(updated);
          }
        }
      } catch {
        // Non bloquant : si TomTom échoue, on garde la piste créée sans cache.
      }

      let actorDisplayName: string | undefined;
      try {
        const user = await UserModel.findById((req as any).userId).select({ displayName: 1, appUserId: 1 }).lean();
        if (user) {
          const dn = typeof (user as any).displayName === 'string' ? (user as any).displayName.trim() : '';
          const appId = typeof (user as any).appUserId === 'string' ? (user as any).appUserId.trim() : '';
          actorDisplayName = dn || appId || undefined;
        }
      } catch {
        // non bloquant
      }

      app.io?.to(`mission:${missionId}`).emit('vehicle-track:created', {
        missionId,
        track: finalDto,
        actorUserId: (req as any).userId,
        actorDisplayName,
      });

      return reply.code(201).send({ track: finalDto });
    }
  );

  app.patch<{
    Params: { missionId: string; trackId: string };
    Body: UpdateVehicleTrackBody;
  }>(
    '/missions/:missionId/vehicle-tracks/:trackId',
    async (
      req: FastifyRequest<{
        Params: { missionId: string; trackId: string };
        Body: UpdateVehicleTrackBody;
      }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, trackId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(trackId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const admin = await requireAdminMembership((req as any).userId, missionId);
      if (!admin) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const body = req.body as any;
      const updateSet: any = {};
      const updateUnset: any = {};

      if (typeof body.label === 'string') {
        const label = body.label.trim();
        if (!label) return reply.code(400).send({ error: 'LABEL_REQUIRED' });
        updateSet.label = label;
      }

      if (typeof body.vehicleType === 'string') {
        const vt = body.vehicleType;
        if (!['car', 'motorcycle', 'scooter', 'truck', 'unknown'].includes(vt)) {
          return reply.code(400).send({ error: 'INVALID_VEHICLE_TYPE' });
        }
        updateSet.vehicleType = vt;
      }

      if (body.origin) {
        const originType = body.origin.type;
        const originQuery = (body.origin.query ?? '').trim();
        if (originType !== 'address' && originType !== 'poi') {
          return reply.code(400).send({ error: 'ORIGIN_TYPE_REQUIRED' });
        }
        if (!originQuery) {
          return reply.code(400).send({ error: 'ORIGIN_QUERY_REQUIRED' });
        }

        let originPoiId: mongoose.Types.ObjectId | undefined = undefined;
        if (originType === 'poi' && typeof body.origin.poiId === 'string') {
          if (mongoose.Types.ObjectId.isValid(body.origin.poiId)) {
            originPoiId = new mongoose.Types.ObjectId(body.origin.poiId);
          }
        }

        const originLng = typeof body.origin.lng === 'number' ? body.origin.lng : undefined;
        const originLat = typeof body.origin.lat === 'number' ? body.origin.lat : undefined;

        let originWhen: Date | undefined = undefined;
        if (typeof body.origin.when === 'string' && body.origin.when.trim()) {
          const d = new Date(body.origin.when);
          if (!Number.isNaN(d.getTime())) originWhen = d;
        }

        if (originWhen && originWhen.getTime() > Date.now()) {
          return reply.code(400).send({ error: 'FUTURE_WHEN' });
        }

        updateSet.origin = {
          type: originType,
          query: originQuery,
          poiId: originPoiId,
          lng: originLng,
          lat: originLat,
          when: originWhen,
        };
      }

      if (typeof body.status === 'string') {
        const st = body.status;
        if (st !== 'active' && st !== 'stopped') {
          return reply.code(400).send({ error: 'INVALID_STATUS' });
        }
        updateSet.status = st;
        if (st === 'stopped') {
          // Important: purger le cache lors de l'arrêt pour éviter que des tuiles
          // TomTom restent stockées et soient rechargées / ré-affichées plus tard.
          updateUnset.cache = 1;
        }
      }

      if (Object.keys(updateSet).length === 0 && Object.keys(updateUnset).length === 0) {
        return reply.code(400).send({ error: 'EMPTY_UPDATE' });
      }

      const doc = await VehicleTrackModel.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(trackId), missionId },
        {
          ...(Object.keys(updateSet).length ? { $set: updateSet } : {}),
          ...(Object.keys(updateUnset).length ? { $unset: updateUnset } : {}),
        },
        { new: true }
      ).lean();

      if (!doc) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const dto = toDto(doc);

      app.io?.to(`mission:${missionId}`).emit('vehicle-track:updated', {
        missionId,
        track: dto,
      });

      return reply.send({ track: dto });
    }
  );

  app.delete<{
    Params: { missionId: string; trackId: string };
  }>(
    '/missions/:missionId/vehicle-tracks/:trackId',
    async (
      req: FastifyRequest<{
        Params: { missionId: string; trackId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, trackId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(trackId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const admin = await requireAdminMembership((req as any).userId, missionId);
      if (!admin) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const res = await VehicleTrackModel.deleteOne({
        _id: new mongoose.Types.ObjectId(trackId),
        missionId,
      });

      if (!res.deletedCount) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      app.io?.to(`mission:${missionId}`).emit('vehicle-track:deleted', {
        missionId,
        trackId,
        actorUserId: (req as any).userId,
      });

      return reply.send({ ok: true });
    }
  );

  app.get<{
    Params: { missionId: string; trackId: string };
  }>(
    '/missions/:missionId/vehicle-tracks/:trackId/state',
    async (
      req: FastifyRequest<{
        Params: { missionId: string; trackId: string };
      }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }

      const { missionId, trackId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId) || !mongoose.Types.ObjectId.isValid(trackId)) {
        return reply.code(400).send({ error: 'INVALID_ID' });
      }

      const mem = await requireAnyMembership((req as any).userId, missionId);
      if (!mem) {
        return reply.code(403).send({ error: 'FORBIDDEN' });
      }

      const doc = await VehicleTrackModel.findOne({
        _id: new mongoose.Types.ObjectId(trackId),
        missionId,
      })
        .select({
          missionId: 1,
          status: 1,
          cache: 1,
        })
        .lean();

      if (!doc) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const cache = doc.cache
        ? {
            computedAt: doc.cache.computedAt
              ? new Date(doc.cache.computedAt).toISOString()
              : null,
            elapsedSeconds:
              typeof doc.cache.elapsedSeconds === 'number'
                ? doc.cache.elapsedSeconds
                : 0,
            payloadGeojson: doc.cache.payloadGeojson ?? null,
            meta: doc.cache.meta ?? null,
          }
        : null;

      return reply.send({
        trackId: doc._id.toString(),
        missionId: doc.missionId.toString(),
        status: doc.status,
        cache,
      });
    }
  );
}

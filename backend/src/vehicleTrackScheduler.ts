import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { VehicleTrackModel, type VehicleTrackDoc } from './models/vehicleTrack.js';
import { HuntIsochroneModel } from './models/huntIsochrone.js';
import { computeVehicleIsoline } from './traffic/computeVehicleIsoline.js';
import { computeVehicleTomtomIsoline, type VehicleTomtomState } from './traffic/computeVehicleTomtomIsoline.js';
import { computeVehicleTomtomReachableRange } from './traffic/computeVehicleTomtomReachableRange.js';

const SCHEDULER_INTERVAL_MS = 20_000;

function clampElapsed(seconds: number, maxSeconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const max = Number.isFinite(maxSeconds) && maxSeconds > 0 ? Math.min(maxSeconds, 3600) : 3600;
  return Math.max(0, Math.min(max, seconds));
}

export function startVehicleTrackScheduler(app: FastifyInstance) {
  let running = false;
  const schedulerBootTime = new Date();

  // Best-effort cleanup: stop any track still marked active from a previous backend run.
  // This avoids the frontend reloading cached payloads for stale "active" tracks.
  void (async () => {
    try {
      const res = await VehicleTrackModel.updateMany(
        { status: 'active', startedAt: { $lt: schedulerBootTime } },
        { $set: { status: 'stopped', cache: undefined } }
      );
      app.log.info(
        {
          matched: (res as any).matchedCount ?? (res as any).n ?? undefined,
          modified: (res as any).modifiedCount ?? (res as any).nModified ?? undefined,
        },
        'vehicleTrackScheduler stale active tracks cleanup'
      );
    } catch (e) {
      app.log.error(e, 'vehicleTrackScheduler stale active tracks cleanup failed');
    }
  })();

  async function tick() {
    if (running) return;
    running = true;
    try {
      const now = new Date();

      // Ne traite que les pistes actives démarrées après le démarrage de ce processus.
      // Cela évite de continuer à consommer du TomTom pour d'anciens suivis laissés actifs
      // dans la base avant un redémarrage du backend.
      const activeTracks: VehicleTrackDoc[] = await VehicleTrackModel.find({
        status: 'active',
        startedAt: { $gte: schedulerBootTime },
      })
        .select({
          missionId: 1,
          startedAt: 1,
          maxDurationSeconds: 1,
          trafficRefreshSeconds: 1,
          lastComputedAt: 1,
          origin: 1,
          vehicleType: 1,
          algorithm: 1,
          label: 1,
          cache: 1, // nécessaire pour récupérer meta.tomtomState entre les ticks
        })
        .lean();

      // Par mission, on ne garde qu'un seul suivi actif : le plus récent (startedAt le plus tardif).
      // Tous les autres suivis encore "active" pour la même mission sont automatiquement stoppés.
      const tracksByMission = new Map<string, VehicleTrackDoc[]>();
      for (const t of activeTracks) {
        const missionIdStr = (t.missionId as mongoose.Types.ObjectId).toString();
        const arr = tracksByMission.get(missionIdStr) ?? [];
        arr.push(t);
        tracksByMission.set(missionIdStr, arr);
      }

      const tracksToProcess: VehicleTrackDoc[] = [];

      for (const [missionIdStr, tracks] of tracksByMission.entries()) {
        if (!tracks.length) continue;

        // Trie par startedAt décroissant : le plus récent d'abord.
        tracks.sort((a, b) => {
          const aTime = a.startedAt instanceof Date ? a.startedAt.getTime() : 0;
          const bTime = b.startedAt instanceof Date ? b.startedAt.getTime() : 0;
          return bTime - aTime;
        });

        const [latest, ...older] = tracks;
        tracksToProcess.push(latest);

        // Bascule toutes les anciennes pistes actives en "stopped" pour cette mission.
        // On nettoie aussi leur cache pour éviter tout recalcul ultérieur.
        for (const t of older) {
          const trackIdStr = t._id.toString();
          const updated = await VehicleTrackModel.findOneAndUpdate(
            { _id: t._id, status: 'active' },
            { $set: { status: 'stopped', cache: undefined } },
            { new: true }
          ).lean();

          if (updated) {
            app.io?.to(`mission:${missionIdStr}`).emit('vehicle-track:updated', {
              missionId: missionIdStr,
              trackId: trackIdStr,
              status: updated.status,
            });
          }
        }
      }

      for (const track of tracksToProcess) {
        // Sécurité supplémentaire : il est possible qu'une piste ait été supprimée ou
        // passée en "stopped" entre le moment où on a listé les pistes actives et
        // maintenant. On revérifie donc qu'elle existe encore et qu'elle est toujours
        // "active" avant de lancer un calcul TomTom potentiellement coûteux.
        const fresh = await VehicleTrackModel.findOne({ _id: track._id, status: 'active' })
          .select({
            missionId: 1,
            startedAt: 1,
            maxDurationSeconds: 1,
            trafficRefreshSeconds: 1,
            lastComputedAt: 1,
            origin: 1,
            vehicleType: 1,
            algorithm: 1,
            label: 1,
            cache: 1,
          })
          .lean();

        if (!fresh) {
          continue;
        }

        const trackId = fresh._id.toString();
        const missionId = (fresh.missionId as mongoose.Types.ObjectId).toString();

        const startedAtMs = fresh.startedAt instanceof Date ? fresh.startedAt.getTime() : now.getTime();
        const elapsedSeconds = clampElapsed(
          (now.getTime() - startedAtMs) / 1000,
          fresh.maxDurationSeconds ?? 3600
        );

        const maxDurationSeconds = Number.isFinite(fresh.maxDurationSeconds)
          ? Math.min(fresh.maxDurationSeconds, 3600)
          : 3600;

        if (elapsedSeconds >= maxDurationSeconds) {
          const updated = await VehicleTrackModel.findOneAndUpdate(
            { _id: fresh._id, status: 'active' },
            { $set: { status: 'expired', lastComputedAt: now } },
            { new: true }
          ).lean();

          if (updated) {
            app.io?.to(`mission:${missionId}`).emit('vehicle-track:expired', {
              missionId,
              trackId,
              status: 'expired',
            });
          }

          continue;
        }

        const label = typeof (fresh as any).label === 'string' ? ((fresh as any).label as string) : '';
        const isTestTrack = /TEST/i.test(label);

        const lastComputedAtMs = fresh.lastComputedAt instanceof Date ? fresh.lastComputedAt.getTime() : 0;
        const refreshSeconds = isTestTrack
          ? 20
          : Number.isFinite(fresh.trafficRefreshSeconds)
            ? Math.max(10, Math.min(3600, fresh.trafficRefreshSeconds))
            : 60;

        // Pour les pistes TEST, on veut que le premier calcul réel ne se produise
        // qu'après ~20s d'écoulement, puis toutes les ~20s ensuite.
        if (isTestTrack) {
          // Pas encore de calcul : on attend au moins refreshSeconds d'elapsed avant de lancer TomTom.
          if (!lastComputedAtMs && elapsedSeconds < refreshSeconds) {
            continue;
          }
          // Calculs suivants : on respecte le délai minimum entre deux requêtes.
          if (lastComputedAtMs && now.getTime() - lastComputedAtMs < refreshSeconds * 1000) {
            continue;
          }
        } else {
          if (lastComputedAtMs && now.getTime() - lastComputedAtMs < refreshSeconds * 1000) {
            continue;
          }
        }

        const origin = fresh.origin as any;
        const lng = typeof origin?.lng === 'number' ? origin.lng : undefined;
        const lat = typeof origin?.lat === 'number' ? origin.lat : undefined;

        let geojson: any;
        let meta: any;

        if (isTestTrack) {
          // Nouveau comportement pour les pistes TEST : on utilise uniquement
          // TomTom Calculate Reachable Range pour produire une isochrone,
          // avec un budget croissant en pas de 20 secondes (aligné sur le
          // scheduler), afin d'avoir une forme monotone et une clé différente
          // à chaque tick.
          try {
            const budgetSeconds = (() => {
              const step = Math.max(1, refreshSeconds);
              const maxSec = Number.isFinite(fresh.maxDurationSeconds)
                ? Math.max(1, fresh.maxDurationSeconds)
                : maxDurationSeconds;
              const stepped = Math.floor(elapsedSeconds / step) * step;

              // Si un budget a déjà été calculé (ex: calcul immédiat à la création),
              // on force l'avancement au palier suivant pour éviter 20 -> 20.
              const prevBudget = (() => {
                const metaBudget = (fresh as any)?.cache?.meta?.budgetSec;
                if (typeof metaBudget === 'number' && Number.isFinite(metaBudget)) return metaBudget;
                const cacheElapsed = (fresh as any)?.cache?.elapsedSeconds;
                if (typeof cacheElapsed === 'number' && Number.isFinite(cacheElapsed)) return cacheElapsed;
                return null;
              })();

              let next = Math.max(step, stepped);
              if (typeof prevBudget === 'number' && next <= prevBudget) {
                next = prevBudget + step;
              }
              return Math.min(maxSec, next);
            })();

            const result = await computeVehicleTomtomReachableRange({
              lng,
              lat,
              elapsedSeconds: budgetSeconds,
              vehicleType: fresh.vehicleType,
              maxBudgetSeconds: budgetSeconds,
              label,
            });

            geojson = result.geojson;
            meta = {
              ...result.meta,
              provider: 'tomtom_reachable_range',
              budgetSec: budgetSeconds,
            };

            // S'assurer que le GeoJSON embarque aussi le même budgetSec (utilisé côté front).
            try {
              if (geojson?.features?.[0]?.properties && typeof geojson.features[0].properties === 'object') {
                geojson.features[0].properties.budgetSec = budgetSeconds;
              }
            } catch {
              // ignore
            }

            // Historisation en base pour les traques TEST.
            try {
              await HuntIsochroneModel.create({
                trackId: fresh._id,
                missionId: fresh.missionId,
                ts: now,
                budgetSec: budgetSeconds,
                geojson,
                providerMeta: result.meta,
              });
            } catch (e) {
              app.log.error(
                { missionId, trackId, label, err: e },
                'vehicleTrackScheduler hunt isochrone insert failed'
              );
            }

            app.log.info(
              {
                missionId,
                trackId,
                label,
                vehicleType: track.vehicleType,
                algorithm: track.algorithm,
                mode: 'tomtom_reachable_range',
                lng,
                lat,
                elapsedSeconds,
                budgetSec: budgetSeconds,
              },
              'vehicleTrackScheduler tomtom_reachable_range computed'
            );
          } catch (e) {
            app.log.error(
              {
                missionId,
                trackId,
                label,
                vehicleType: track.vehicleType,
                algorithm: track.algorithm,
                lng,
                lat,
                elapsedSeconds,
                err: e,
              },
              'vehicleTrackScheduler tomtom_reachable_range compute failed'
            );

            const fallback = await computeVehicleIsoline({
              lng,
              lat,
              elapsedSeconds,
              vehicleType: track.vehicleType,
            });
            geojson = fallback.geojson;
            meta = {
              ...fallback.meta,
              provider: 'tomtom_reachable_range_fallback_circle',
            };
          }
        } else if (fresh.algorithm === 'road_graph') {
          const prevTomtomState: VehicleTomtomState | null =
            ((track.cache?.meta as any)?.tomtomState as VehicleTomtomState | null) ?? null;

          const baseSpeedKmh = (() => {
            switch (fresh.vehicleType) {
              case 'car':
                return 90;
              case 'motorcycle':
                return 100;
              case 'scooter':
                return 45;
              case 'truck':
                return 70;
              default:
                return 80;
            }
          })();

          try {
            const result = await computeVehicleTomtomIsoline({
              lng,
              lat,
              elapsedSeconds,
              vehicleType: track.vehicleType,
              baseSpeedKmh,
              prevState: prevTomtomState,
            });

            geojson = result.geojson;
            meta = {
              ...result.meta,
              tomtomState: result.nextState,
            };

            app.log.info(
              {
                missionId,
                trackId,
                label,
                vehicleType: track.vehicleType,
                algorithm: track.algorithm,
                mode: 'tomtom_tiles',
                lng,
                lat,
                elapsedSeconds,
                tilesCount: Object.keys(result.nextState.tiles).length,
              },
              'vehicleTrackScheduler tomtom_tiles computed'
            );
          } catch (e) {
            app.log.error(
              {
                missionId,
                trackId,
                label,
                vehicleType: track.vehicleType,
                algorithm: track.algorithm,
                lng,
                lat,
                elapsedSeconds,
                err: e,
              },
              'vehicleTrackScheduler tomtom_tiles compute failed'
            );

            const fallback = await computeVehicleIsoline({
              lng,
              lat,
              elapsedSeconds,
              vehicleType: track.vehicleType,
            });
            geojson = fallback.geojson;
            meta = {
              ...fallback.meta,
              provider: 'tomtom_tiles_fallback_circle',
            };
          }
        } else {
          const fallback = await computeVehicleIsoline({
            lng,
            lat,
            elapsedSeconds,
            vehicleType: fresh.vehicleType,
          });
          geojson = fallback.geojson;
          meta = fallback.meta;
        }

        const updated = await VehicleTrackModel.findOneAndUpdate(
          { _id: fresh._id, status: 'active' },
          {
            $set: {
              lastComputedAt: now,
              cache: {
                computedAt: now,
                elapsedSeconds,
                payloadGeojson: geojson,
                meta,
              },
            },
          },
          { new: true }
        ).lean();

        if (updated) {
          app.io?.to(`mission:${missionId}`).emit('vehicle-track:updated', {
            missionId,
            trackId,
            status: updated.status,
            cache: {
              computedAt: now.toISOString(),
              elapsedSeconds,
              payloadGeojson: geojson,
              meta,
            },
          });
        }
      }
    } catch (e) {
      // Best-effort scheduler: ne jamais faire tomber le serveur, mais logguer l'erreur
      app.log.error(e, 'vehicleTrackScheduler tick failed');
    } finally {
      running = false;
    }
  }

  setInterval(() => {
    void tick();
  }, SCHEDULER_INTERVAL_MS);
}

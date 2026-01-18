import type { FeatureCollection } from 'geojson';
import type { VehicleTrackVehicleType } from '../models/vehicleTrack.js';
import { computeVehicleIsoline } from './computeVehicleIsoline.js';
import { HttpRoadGraphProvider, type RoadGraphProfile, type RoadGraphTileEdge } from './roadGraphProvider.js';
import { getTileTrafficAverage, resetTomtomTickBudget } from './tomtomTrafficProvider.js';

export type TileStatus = 'NEW' | 'ACTIVE' | 'DONE';

export interface RoadGraphTileState {
  z: number;
  x: number;
  y: number;
  status: TileStatus;
  coverageRatio: number; // 0..1 estimation de remplissage des routes
}

export interface TrafficTileSample {
  avgSpeedKmh: number;
  updatedAt: number; // epoch ms
}

export interface VehicleRoadGraphState {
  version: 1;
  snappedOrigin?: {
    lng: number;
    lat: number;
    tileZ: number;
    tileX: number;
    tileY: number;
  };
  tiles: Record<string, RoadGraphTileState>;
  trafficCache: Record<string, TrafficTileSample>;
}

export interface ComputeVehicleRoadGraphInput {
  lng?: number;
  lat?: number;
  elapsedSeconds: number;
  vehicleType: VehicleTrackVehicleType | string;
  prevState?: VehicleRoadGraphState | null;
}

export interface ComputeVehicleRoadGraphResult {
  geojson: FeatureCollection;
  meta: any;
  nextState: VehicleRoadGraphState;
}

const DEFAULT_TILE_ZOOM = 14;
const TRAFFIC_CACHE_TTL_MS = 60_000;

// Provider HTTP vers le service road-graph (optionnel si aucune URL n'est
// configurée). On l'initialise en module-scope pour le réutiliser entre les
// appels du scheduler.
const ROAD_GRAPH_BASE_URL = process.env.ROAD_GRAPH_BASE_URL;

const roadGraphProvider = ROAD_GRAPH_BASE_URL
  ? new HttpRoadGraphProvider({ baseUrl: ROAD_GRAPH_BASE_URL })
  : null;

function vehicleTypeToProfile(vehicleType: VehicleTrackVehicleType | string): RoadGraphProfile {
  switch (vehicleType) {
    case 'motorcycle':
      return 'motorcycle';
    case 'scooter':
      return 'scooter';
    case 'truck':
      return 'truck';
    case 'car':
    default:
      return 'car';
  }
}

function baseSpeedLimitKmh(vehicleType: VehicleTrackVehicleType | string): number {
  switch (vehicleType) {
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
}

function overspeedCap(vehicleType: VehicleTrackVehicleType | string): number {
  switch (vehicleType) {
    case 'motorcycle':
      return 1.25;
    case 'scooter':
      return 1.1;
    case 'truck':
      return 1.05;
    case 'car':
    default:
      return 1.15;
  }
}

function maxHumanSpeedKmh(vehicleType: VehicleTrackVehicleType | string): number {
  switch (vehicleType) {
    case 'motorcycle':
      return 180;
    case 'scooter':
      return 120;
    case 'truck':
      return 130;
    case 'car':
    default:
      return 160;
  }
}

function applyCongestionResilience(
  vehicleType: VehicleTrackVehicleType | string,
  trafficSpeedKmh: number,
  roadClass?: string
): number {
  if (!Number.isFinite(trafficSpeedKmh) || trafficSpeedKmh <= 0) return trafficSpeedKmh;

  const isStrongCongestion = trafficSpeedKmh < 15;
  const isHighway = roadClass === 'motorway' || roadClass === 'trunk';

  if (!isStrongCongestion) return trafficSpeedKmh;

  if (vehicleType === 'motorcycle' || vehicleType === 'scooter') {
    if (isHighway) {
      return Math.min(trafficSpeedKmh * 3, 60);
    }
    return Math.min(trafficSpeedKmh * 2, 45);
  }

  // voitures / camions subissent la congestion
  if (vehicleType === 'truck') {
    return Math.min(trafficSpeedKmh, isHighway ? 15 : 12);
  }

  // voiture
  return Math.min(trafficSpeedKmh, isHighway ? 20 : 15);
}

function computeEffectiveSpeedKmh(args: {
  vehicleType: VehicleTrackVehicleType | string;
  trafficSpeedKmh?: number | null;
  roadClass?: string;
  speedLimitKmh?: number | null;
}): number {
  const baseFromVehicle = baseSpeedLimitKmh(args.vehicleType);
  const edgeLimit =
    Number.isFinite(args.speedLimitKmh ?? NaN) && (args.speedLimitKmh as number) > 0
      ? (args.speedLimitKmh as number)
      : null;
  const base = edgeLimit !== null ? Math.min(baseFromVehicle, edgeLimit) : baseFromVehicle;
  const cap = overspeedCap(args.vehicleType);

  let speedFromTraffic: number | null = null;
  if (Number.isFinite(args.trafficSpeedKmh ?? NaN) && (args.trafficSpeedKmh as number) > 0) {
    speedFromTraffic = applyCongestionResilience(args.vehicleType, args.trafficSpeedKmh as number, args.roadClass);
  }

  let effective = base * cap;
  if (speedFromTraffic !== null) {
    const fugitiveFactor = args.vehicleType === 'motorcycle' ? 1.15 : args.vehicleType === 'scooter' ? 1.1 : 1.1;
    effective = Math.min(base * cap, speedFromTraffic * fugitiveFactor);
  }

  const maxHuman = maxHumanSpeedKmh(args.vehicleType);
  return Math.max(10, Math.min(effective, maxHuman));
}

function initState(): VehicleRoadGraphState {
  return {
    version: 1,
    tiles: {},
    trafficCache: {},
  };
}

function lngLatToTile(z: number, lng: number, lat: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

export async function computeVehicleRoadGraph(
  input: ComputeVehicleRoadGraphInput
): Promise<ComputeVehicleRoadGraphResult> {
  const { lng, lat } = input;
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { provider: 'road_graph', reason: 'MISSING_COORDS' },
      nextState: initState(),
    };
  }

  const elapsedSeconds = Number.isFinite(input.elapsedSeconds)
    ? Math.max(0, Math.min(3600, input.elapsedSeconds))
    : 0;
  if (elapsedSeconds <= 0) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { provider: 'road_graph', reason: 'ZERO_ELAPSED' },
      nextState: input.prevState ?? initState(),
    };
  }

  const state: VehicleRoadGraphState = input.prevState && input.prevState.version === 1 ? input.prevState : initState();

  const now = Date.now();
  let roadGraphUnavailable = false;
  let roadGraphUnavailableStage: 'snap' | 'tile' | null = null;
  let snapError: string | null = null;
  let tileError: string | null = null;
  // Reset du budget TomTom au début de chaque tick logique. Ici on suppose
  // qu’un appel à computeVehicleRoadGraph correspond à un tick de scheduler
  // pour une piste donnée.
  resetTomtomTickBudget();
  const vehicleType = input.vehicleType;

  // Snapping de l'origine sur le réseau routier via le service road-graph,
  // si disponible. On le fait une seule fois et on le mémorise dans l'état.
  if (!state.snappedOrigin && roadGraphProvider) {
    try {
      const profile = vehicleTypeToProfile(vehicleType);
      const snapped = await roadGraphProvider.snap({ lng, lat, profile });
      if (!snapped) {
        roadGraphUnavailable = true;
        roadGraphUnavailableStage = 'snap';
      }
      if (snapped && Number.isFinite(snapped.lng) && Number.isFinite(snapped.lat)) {
        const { x, y } = lngLatToTile(DEFAULT_TILE_ZOOM, snapped.lng, snapped.lat);
        state.snappedOrigin = {
          lng: snapped.lng,
          lat: snapped.lat,
          tileZ: DEFAULT_TILE_ZOOM,
          tileX: x,
          tileY: y,
        };
      }
    } catch (e: any) {
      roadGraphUnavailable = true;
      roadGraphUnavailableStage = 'snap';
      snapError = e?.message ? String(e.message) : 'SNAP_FAILED';
      // En cas d'erreur réseau ou autre, on continue avec l'origine brute.
    }
  }

  // TODO: intégration réelle TomTom par tuile (flow). Pour l’instant, on
  // utilise une vitesse de trafic agrégée simplifiée stockée dans le state
  // et on tombe sur un cercle si rien n’est disponible.

  const tileX = state.snappedOrigin?.tileX ?? lngLatToTile(DEFAULT_TILE_ZOOM, lng, lat).x;
  const tileY = state.snappedOrigin?.tileY ?? lngLatToTile(DEFAULT_TILE_ZOOM, lng, lat).y;

  const trafficKey = `z${DEFAULT_TILE_ZOOM}-${tileX}-${tileY}`;
  let trafficSample = state.trafficCache[trafficKey];

  // Tentative de récupération de trafic temps réel TomTom pour la tuile.
  const tomtomSample = await getTileTrafficAverage(
    { z: DEFAULT_TILE_ZOOM, x: tileX, y: tileY },
    now,
    TRAFFIC_CACHE_TTL_MS
  );

  if (tomtomSample) {
    trafficSample = tomtomSample;
    state.trafficCache[trafficKey] = tomtomSample;
  } else if (!trafficSample) {
    // Fallback: pas de TomTom ou hors TTL et rien en cache => vitesse moyenne.
    trafficSample = {
      avgSpeedKmh: baseSpeedLimitKmh(vehicleType),
      updatedAt: now,
    };
    state.trafficCache[trafficKey] = trafficSample;
  }

  const effectiveSpeedKmh = computeEffectiveSpeedKmh({
    vehicleType,
    trafficSpeedKmh: trafficSample?.avgSpeedKmh,
  });
  const maxTravelSeconds = elapsedSeconds;

  // ---------------------------------------------------------------------------
  // 1) Chargement des edges sur un petit bloc de tuiles autour de l'origine
  // ---------------------------------------------------------------------------
  let reachedCoords: [number, number][] = [];
  let totalEdges = 0;
  let reachedEdges = 0;

  if (roadGraphProvider && state.snappedOrigin) {
    try {
      const originTileZ = state.snappedOrigin.tileZ;
      const originTileX = state.snappedOrigin.tileX;
      const originTileY = state.snappedOrigin.tileY;

      type Edge = RoadGraphTileEdge;
      const allEdges: Edge[] = [];

      // Pour l'instant, on charge un bloc 3x3 autour de la tuile d'origine.
      // Plus tard, on pourra utiliser state.tiles pour étendre dynamiquement.
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const tx = originTileX + dx;
          const ty = originTileY + dy;

          try {
            const resp = await roadGraphProvider.getTileEdges({
              z: originTileZ,
              x: tx,
              y: ty,
              profile: vehicleTypeToProfile(vehicleType),
            });

            if (resp && Array.isArray(resp.edges) && resp.edges.length) {
              allEdges.push(...(resp.edges as Edge[]));
            }
          } catch (e: any) {
            // On loggue l'erreur dans meta, mais on continue avec les autres tuiles.
            tileError = e?.message ? String(e.message) : 'TILE_FAILED';
          }
        }
      }

      if (!allEdges.length) {
        roadGraphUnavailable = true;
        roadGraphUnavailableStage = 'tile';
      } else {
        totalEdges = allEdges.length;

        // Dijkstra très simplifié sur les nodes du bloc de tuiles
        const bestTimeByNode = new Map<string, number>();
        type QueueItem = { nodeId: string; time: number };
        const queue: QueueItem[] = [];

        // Node de départ : plus proche de l'origine snappée
        let startNodeId: string | null = null;
        let bestDist = Infinity;
        const originLng = state.snappedOrigin.lng;
        const originLat = state.snappedOrigin.lat;

        for (const e of allEdges) {
          const c0 = e.geometry.coordinates[0];
          const dLng = c0[0] - originLng;
          const dLat = c0[1] - originLat;
          const dist2 = dLng * dLng + dLat * dLat;
          if (dist2 < bestDist) {
            bestDist = dist2;
            startNodeId = e.fromNodeId;
          }
        }

        if (startNodeId) {
          bestTimeByNode.set(startNodeId, 0);
          queue.push({ nodeId: startNodeId, time: 0 });

          const adjacency = new Map<string, Edge[]>();
          for (const e of allEdges) {
            if (!adjacency.has(e.fromNodeId)) adjacency.set(e.fromNodeId, []);
            adjacency.get(e.fromNodeId)!.push(e);
            if (!e.oneway) {
              // on ajoute un edge inverse logique pour la propagation si non one-way
              if (!adjacency.has(e.toNodeId)) adjacency.set(e.toNodeId, []);
              adjacency.get(e.toNodeId)!.push({ ...e, fromNodeId: e.toNodeId, toNodeId: e.fromNodeId } as Edge);
            }
          }

          while (queue.length) {
            // extraction naïve du min (OK pour un bloc de quelques tuiles)
            queue.sort((a, b) => a.time - b.time);
            const current = queue.shift()!;
            const knownTime = bestTimeByNode.get(current.nodeId)!;
            if (current.time > knownTime) continue;
            if (current.time > maxTravelSeconds) break;

            const edgesFromNode = adjacency.get(current.nodeId);
            if (!edgesFromNode) continue;

            for (const e of edgesFromNode) {
              const speedKmh = computeEffectiveSpeedKmh({
                vehicleType,
                trafficSpeedKmh: trafficSample?.avgSpeedKmh,
                roadClass: e.roadClass,
                speedLimitKmh: e.speedLimitKmh,
              });
              const seconds = (e.lengthMeters / 1000) / (speedKmh / 3600);
              const nextTime = current.time + seconds;
              if (nextTime > maxTravelSeconds) continue;

              const prev = bestTimeByNode.get(e.toNodeId);
              if (prev == null || nextTime < prev) {
                bestTimeByNode.set(e.toNodeId, nextTime);
                queue.push({ nodeId: e.toNodeId, time: nextTime });
              }
            }
          }

          // Edges atteints = ceux dont au moins une extrémité est atteinte
          for (const e of allEdges) {
            const tFrom = bestTimeByNode.get(e.fromNodeId);
            const tTo = bestTimeByNode.get(e.toNodeId);
            if (tFrom != null || tTo != null) {
              reachedEdges += 1;
              // On collecte les coordonnées pour construire un pseudo-poulpe
              for (const c of e.geometry.coordinates) {
                reachedCoords.push([c[0], c[1]]);
              }
            }
          }
        }
      }
    } catch (e: any) {
      roadGraphUnavailable = true;
      roadGraphUnavailableStage = 'tile';
      tileError = e?.message ? String(e.message) : 'TILE_FAILED';
      // En cas d'erreur, on retombera sur un cercle plus bas.
    }
  }

  const tileId = `z${DEFAULT_TILE_ZOOM}-${tileX}-${tileY}`;
  const existingTile = state.tiles[tileId] ?? {
    z: DEFAULT_TILE_ZOOM,
    x: tileX,
    y: tileY,
    status: 'ACTIVE' as TileStatus,
    coverageRatio: 0,
  };

  let coverageRatio = existingTile.coverageRatio;
  if (totalEdges > 0) {
    coverageRatio = Math.min(1, reachedEdges / totalEdges);
  }
  const status: TileStatus = coverageRatio >= 0.95 ? 'DONE' : 'ACTIVE';

  state.tiles[tileId] = {
    ...existingTile,
    coverageRatio,
    status,
  };

  let geojson: FeatureCollection;

  if (reachedCoords.length >= 2) {
    // Construction très simple : on renvoie toutes les lignes atteintes comme
    // MultiLineString pour visualiser le poulpe. On pourra ensuite les buffer
    // côté rendu ou backend.
    geojson = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiLineString',
            coordinates: [reachedCoords],
          },
        },
      ],
    };
  } else {
    // Fallback : pas d'edges dispo ou erreur côté road-graph → cercle simple
    const { geojson: circle } = await computeVehicleIsoline({
      lng,
      lat,
      elapsedSeconds,
      vehicleType,
    });
    geojson = circle;
  }

  const meta = {
    provider: 'road_graph',
    mode: reachedCoords.length >= 2 ? 'graph_single_tile' : 'circle_with_traffic',
    vehicleType,
    elapsedSeconds,
    effectiveSpeedKmh,
    tileState: state.tiles,
    roadGraphStatus:
      reachedCoords.length >= 2
        ? 'ready'
        : roadGraphUnavailable
          ? 'warming_up'
          : 'no_edges',
    roadGraphUnavailableStage,
    roadGraphBaseUrl: ROAD_GRAPH_BASE_URL ?? null,
    debug: {
      snappedOrigin: state.snappedOrigin ?? null,
      totalEdges,
      reachedEdges,
      snapError,
      tileError,
    },
  };

  return {
    geojson,
    meta,
    nextState: state,
  };
}

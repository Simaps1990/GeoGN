import type { FeatureCollection } from 'geojson';
import { getTileTrafficAverage, resetTomtomTickBudget } from './tomtomTrafficProvider.js';

export type TomtomTileStatus = 'NEW' | 'ACTIVE' | 'DONE';

export interface TomtomTileState {
  z: number;
  x: number;
  y: number;
  status: TomtomTileStatus;
  coverageRatio: number; // 0..1
  bestArrivalSeconds: number; // temps minimal pour atteindre le centre de la tuile
  neighborsSpawned: boolean; // true une fois que les tuiles voisines ont été créées
  tileSeconds: number; // temps nécessaire pour traverser complètement cette tuile
  avgSpeedKmh?: number; // vitesse moyenne brute renvoyée par TomTom pour cette tuile
}

export interface VehicleTomtomState {
  version: 1;
  tiles: Record<string, TomtomTileState>;
}

function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
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

function tileToBbox(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const northRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const southRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n)));
  const north = (northRad * 180) / Math.PI;
  const south = (southRad * 180) / Math.PI;
  return [west, south, east, north];
}

function initState(z: number, x: number, y: number): VehicleTomtomState {
  const tiles: Record<string, TomtomTileState> = {};

  function addTile(tx: number, ty: number, bestArrivalSeconds: number) {
    const k = tileKey(z, tx, ty);
    if (tiles[k]) return;
    tiles[k] = {
      z,
      x: tx,
      y: ty,
      status: 'ACTIVE',
      coverageRatio: 0,
      bestArrivalSeconds,
      neighborsSpawned: false,
      tileSeconds: 0,
      avgSpeedKmh: undefined,
    };
  }

  // On démarre uniquement avec la tuile d'origine.
  // Les tuiles voisines (3x3) seront ajoutées dynamiquement
  // quand cette tuile sera entièrement couverte.
  addTile(x, y, 0);

  return {
    version: 1,
    tiles,
  };
}

export interface ComputeVehicleTomtomIsolineInput {
  lng?: number;
  lat?: number;
  elapsedSeconds: number;
  vehicleType: string;
  baseSpeedKmh: number;
  prevState?: VehicleTomtomState | null;
}

export interface ComputeVehicleTomtomIsolineResult {
  geojson: FeatureCollection;
  meta: any;
  nextState: VehicleTomtomState;
}

export async function computeVehicleTomtomIsoline(
  input: ComputeVehicleTomtomIsolineInput
): Promise<ComputeVehicleTomtomIsolineResult> {
  const { lng, lat } = input;
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { provider: 'tomtom_tiles', reason: 'MISSING_COORDS' },
      nextState: { version: 1, tiles: {} },
    };
  }

  const elapsedSeconds = Number.isFinite(input.elapsedSeconds)
    ? Math.max(0, Math.min(3600, input.elapsedSeconds))
    : 0;
  if (elapsedSeconds <= 0) {
    const zoom = 15;
    const origin = lngLatToTile(zoom, lng, lat);
    const state = input.prevState && input.prevState.version === 1
      ? input.prevState
      : initState(zoom, origin.x, origin.y);
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { provider: 'tomtom_tiles', reason: 'ZERO_ELAPSED' },
      nextState: state,
    };
  }

  // Zoom plus global pour des tuiles plus grandes (≈ 800m) et moins de requêtes.
  const zoom = 15;
  const originTile = lngLatToTile(zoom, lng, lat);
  let state: VehicleTomtomState;
  if (input.prevState && input.prevState.version === 1 && Object.keys(input.prevState.tiles).length) {
    state = input.prevState;
  } else {
    state = initState(zoom, originTile.x, originTile.y);
  }

  resetTomtomTickBudget();
  const now = Date.now();
  const tiles = state.tiles;
  const features: any[] = [];
  const maxDistanceKm = (input.baseSpeedKmh * elapsedSeconds) / 3600;

  // Paramètre de base : temps nécessaire pour traverser une tuile complète
  // à la vitesse de base (en secondes). On ajuste ensuite avec TomTom.
  // On le garde raisonnable pour que la propagation reste visible entre deux
  // ticks du scheduler, même avec des tuiles plus grandes.
  const BASE_TILE_SECONDS = 20;

  // Découpage en bandes de vitesse (km/h) pour 1 tick ≈ 60s et des tuiles de ~800m :
  //  - 0–40  km/h -> 1 carré de portée
  //  - 41–90 km/h -> 2 carrés
  //  - 91–140 km/h -> 3 carrés
  //  - 141+  km/h -> 4 carrés
  const getMaxTileStepsForSpeed = (speedKmh: number): number => {
    if (!Number.isFinite(speedKmh) || speedKmh <= 0) return 1;
    if (speedKmh <= 40) return 1;
    if (speedKmh <= 90) return 2;
    if (speedKmh <= 140) return 3;
    return 4;
  };

  // Bonus de vitesse en km/h selon le type de véhicule (contexte "en fuite").
  const getVehicleSpeedBonusKmh = (vehicleType: string): number => {
    switch (vehicleType) {
      case 'car':
        return 30;
      case 'motorcycle':
        return 40;
      case 'scooter':
        return 15;
      case 'truck':
        return 10;
      default:
        return 20;
    }
  };

  // Pour pouvoir ajouter des voisins quand une tuile devient DONE.
  const addNeighborTile = (tx: number, ty: number, bestArrivalSeconds: number) => {
    const k = tileKey(zoom, tx, ty);
    if (tiles[k]) return;
    tiles[k] = {
      z: zoom,
      x: tx,
      y: ty,
      status: 'ACTIVE',
      coverageRatio: 0,
      bestArrivalSeconds,
      neighborsSpawned: false,
      tileSeconds: 0,
    };
  };

  for (const key of Object.keys(tiles)) {
    const t = tiles[key];
    const tileCenter = tileToBbox(t.z, t.x, t.y);

    // Si la tuile est déjà entièrement couverte, on ne la recalcule plus.
    if (t.status === 'DONE' && t.coverageRatio >= 1) {
      if (t.coverageRatio > 0) {
        const [west, south, east, north] = tileCenter;
        features.push({
          type: 'Feature',
          properties: {
            z: t.z,
            x: t.x,
            y: t.y,
            coverageRatio: t.coverageRatio,
            status: t.status,
            avgSpeedKmh: typeof t.avgSpeedKmh === 'number' ? t.avgSpeedKmh : null,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [west, south],
              [east, south],
              [east, north],
              [west, north],
              [west, south],
            ]],
          },
        });
      }
      continue;
    }

    // Calcule le temps propre à cette tuile (tileSeconds) une seule fois à partir
    // de TomTom (ou de la vitesse de base si TomTom ne répond pas), puis le
    // réutilise aux ticks suivants. Pas de "vitesse de fuite" pour l'instant.
    if (!Number.isFinite(t.tileSeconds) || t.tileSeconds <= 0) {
      let effectiveSpeedKmh = input.baseSpeedKmh;
      let rawAvgSpeedKmh: number | undefined;
      try {
        const sample = await getTileTrafficAverage({ z: t.z, x: t.x, y: t.y }, now);
        if (sample && Number.isFinite(sample.avgSpeedKmh) && sample.avgSpeedKmh > 0) {
          // On conserve la valeur brute TomTom pour l'affichage dans le carré.
          rawAvgSpeedKmh = sample.avgSpeedKmh;
          effectiveSpeedKmh = sample.avgSpeedKmh;
        }
      } catch {
        // ignore et garde la vitesse de base
      }

      // On n'ajoute plus de bonus artificiel de vitesse de fuite : la propagation
      // repose uniquement sur la vitesse TomTom (ou la vitesse de base).
      const factor = Math.max(0.2, Math.min(3, effectiveSpeedKmh / input.baseSpeedKmh));
      t.tileSeconds = factor > 0 ? BASE_TILE_SECONDS / factor : BASE_TILE_SECONDS;

      // avgSpeedKmh contient la vitesse brute TomTom, sans bonus ni clamp.
      if (typeof rawAvgSpeedKmh === 'number') {
        t.avgSpeedKmh = rawAvgSpeedKmh;
      } else {
        t.avgSpeedKmh = undefined;
      }
    }

    const tileSeconds = t.tileSeconds;
    const availableSeconds = Math.max(0, elapsedSeconds - t.bestArrivalSeconds);
    const coverageRatio = tileSeconds > 0 ? Math.max(0, Math.min(1, availableSeconds / tileSeconds)) : 0;

    const prevCoverage = t.coverageRatio;
    t.coverageRatio = coverageRatio;

    // Statut d'affichage très simple :
    // - "ACTIVE" (rouge) tant que la tuile n'est pas complètement remplie ;
    // - "DONE" (jaune) dès qu'elle est pleine, et elle le reste pour tous les ticks suivants.
    t.status = coverageRatio < 1 ? 'ACTIVE' : 'DONE';

    const justBecameDone = prevCoverage < 1 && coverageRatio >= 1;

    // Quand une tuile devient DONE pour la première fois, on ajoute ses voisines.
    if (justBecameDone) {
      // Vitesse effective approximative utilisée pour déterminer combien de
      // "pas" de 800m on peut anticiper dans la minute.
      const approxEffectiveSpeedKmh =
        t.tileSeconds > 0 ? (BASE_TILE_SECONDS / t.tileSeconds) * input.baseSpeedKmh : input.baseSpeedKmh;
      const maxSteps = getMaxTileStepsForSpeed(approxEffectiveSpeedKmh);

      // Pour chaque "anneau" de distance 1..maxSteps, on ajoute les tuiles
      // de la couronne correspondante, avec un bestArrivalSeconds proportionnel.
      for (let step = 1; step <= maxSteps; step += 1) {
        const arrival = t.bestArrivalSeconds + step * tileSeconds;
        for (let dx = -step; dx <= step; dx += 1) {
          for (let dy = -step; dy <= step; dy += 1) {
            // Couronne uniquement : on prend les cases dont la distance de Chebyshev vaut "step".
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== step) continue;
            if (dx === 0 && dy === 0) continue;
            addNeighborTile(t.x + dx, t.y + dy, arrival);
          }
        }
      }
    }

    if (coverageRatio > 0) {
      const [west, south, east, north] = tileCenter;
      features.push({
        type: 'Feature',
        properties: {
          z: t.z,
          x: t.x,
          y: t.y,
          coverageRatio,
          status: t.status,
          avgSpeedKmh: typeof t.avgSpeedKmh === 'number' ? t.avgSpeedKmh : null,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ]],
        },
      });
    }
  }

  const geojson: FeatureCollection = {
    type: 'FeatureCollection',
    features,
  };

  const meta = {
    provider: 'tomtom_tiles',
    elapsedSeconds,
    baseSpeedKmh: input.baseSpeedKmh,
    maxDistanceKm,
    tilesCount: Object.keys(state.tiles).length,
  };

  return { geojson, meta, nextState: state };
}

import { getTomtomApiKey, getTomtomBaseUrl, isTomtomEnabled } from './trafficConfig.js';

export interface TomtomTileTrafficSample {
  avgSpeedKmh: number;
  updatedAt: number; // epoch ms
}

export interface TomtomTileKey {
  z: number;
  x: number;
  y: number;
}

// Cache process-local par tuile
const tileTrafficCache: Record<string, TomtomTileTrafficSample> = {};

const DEFAULT_TTL_MS = 60_000;
const MAX_TOMTOM_CALLS_PER_TICK = 30;
let callsThisTick = 0;

export function resetTomtomTickBudget() {
  callsThisTick = 0;
}

function makeTileKey(key: TomtomTileKey): string {
  return `${key.z}/${key.x}/${key.y}`;
}

export async function getTileTrafficAverage(
  key: TomtomTileKey,
  now: number,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<TomtomTileTrafficSample | null> {
  if (!isTomtomEnabled()) return null;

  const cacheKey = makeTileKey(key);
  const cached = tileTrafficCache[cacheKey];
  if (cached && now - cached.updatedAt <= ttlMs) {
    return cached;
  }

  if (callsThisTick >= MAX_TOMTOM_CALLS_PER_TICK) {
    return cached ?? null;
  }

  const apiKey = getTomtomApiKey();
  if (!apiKey) return cached ?? null;

  callsThisTick += 1;

  try {
    const baseUrl = getTomtomBaseUrl();

    // Ici on utilise un appel très simplifié sur le centroïde de la tuile.
    // En pratique, tu adapteras l’URL à l’API Traffic Flow spécifique que
    // tu souhaites consommer (flow segment, vector tiles, etc.).

    const { lng, lat } = tileToLngLatCenter(key.z, key.x, key.y);

    const url = new URL('/traffic/services/4/flowSegmentData/absolute/10/json', baseUrl);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('point', `${lat},${lng}`);

    const res = await fetch(url.toString());
    if (!res.ok) {
      return cached ?? null;
    }

    const data: any = await res.json();
    const currentSpeed = Number(data?.flowSegmentData?.currentSpeed);
    if (!Number.isFinite(currentSpeed) || currentSpeed <= 0) {
      return cached ?? null;
    }

    const sample: TomtomTileTrafficSample = {
      avgSpeedKmh: currentSpeed,
      updatedAt: now,
    };
    tileTrafficCache[cacheKey] = sample;
    return sample;
  } catch {
    return cached ?? null;
  }
}

// Conversion WebMercator tuile -> centroïde WGS84
function tileToLngLatCenter(z: number, x: number, y: number): { lng: number; lat: number } {
  const n = 2 ** z;
  const lng = (x + 0.5) / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lng, lat };
}

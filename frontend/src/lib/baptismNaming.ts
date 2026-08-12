import { bearingDeg, distMeters } from './baptismAxes';

export type NamedCandidate = { name: string; point: [number, number]; tier: 1 | 2 | 3 };

const PUBLIC_AMENITIES = new Set([
  'townhall', 'place_of_worship', 'school', 'hospital', 'pharmacy', 'fire_station', 'police',
]);
const PLACE_KINDS = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'locality']);

export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

const CARDINALS = ['NORD', 'NORD-EST', 'EST', 'SUD-EST', 'SUD', 'SUD-OUEST', 'OUEST', 'NORD-OUEST'];

export function cardinalName(bearing: number): string {
  return CARDINALS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

export function buildPoiQuery(lat: number, lng: number, radius = 2000): string {
  const around = `around:${radius},${lat},${lng}`;
  return (
    `[out:json][timeout:25];(` +
    `node(${around})[name][place];` +
    `node(${around})[name][shop];way(${around})[name][shop];` +
    `node(${around})[name][amenity];way(${around})[name][amenity];` +
    `);out center;`
  );
}

export function parseOverpassPois(json: any): NamedCandidate[] {
  const out: NamedCandidate[] = [];
  for (const el of json?.elements ?? []) {
    const tags = el?.tags ?? {};
    const name = typeof tags.name === 'string' ? tags.name.trim() : '';
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    let tier: 1 | 2 | 3 | null = null;
    if (tags.shop || tags.amenity === 'fuel') tier = 1;
    else if (PUBLIC_AMENITIES.has(tags.amenity)) tier = 2;
    else if (PLACE_KINDS.has(tags.place)) tier = 3;
    if (tier === null) continue;
    out.push({ name, point: [lon, lat], tier });
  }
  return out;
}

export function rankAxisSuggestions(
  axisBearing: number,
  origin: [number, number],
  candidates: NamedCandidate[],
  coneDeg = 35
): string[] {
  const scored = candidates
    .filter((c) => angleDiffDeg(bearingDeg(origin, c.point), axisBearing) <= coneDeg)
    .map((c) => ({ c, score: c.tier * 100000 + distMeters(origin, c.point) }))
    .sort((a, b) => a.score - b.score);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const { c } of scored) {
    const up = c.name.toUpperCase();
    if (seen.has(up)) continue;
    seen.add(up);
    names.push(up);
    if (names.length === 3) break;
  }
  return names;
}

export function fallbackAxisName(firstWayTags: Record<string, string>, bearing: number): string {
  if (firstWayTags.ref) return firstWayTags.ref.toUpperCase();
  if (firstWayTags.name) return firstWayTags.name.toUpperCase();
  return cardinalName(bearing);
}

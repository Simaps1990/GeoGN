export const SIGNIFICANT_MOVE_METERS = 8;
export const HEARTBEAT_MS = 30_000;
export const MOVEMENT_NOISE_METERS = 2;
export const MOVEMENT_MAX_INTERVAL_MS = 2000;

export function haversineMeters(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number }
): number {
  const R = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roundCoord(n: number): number {
  return Math.round(n * 100_000) / 100_000;
}

export function shouldEmitPosition(
  last: { lng: number; lat: number; t: number } | null,
  next: { lng: number; lat: number; t: number }
): boolean {
  if (!last) return true;
  const distance = haversineMeters(last, next);
  const elapsed = next.t - last.t;
  if (distance >= SIGNIFICANT_MOVE_METERS) return true;
  if (distance > MOVEMENT_NOISE_METERS) return elapsed >= MOVEMENT_MAX_INTERVAL_MS;
  return elapsed >= HEARTBEAT_MS;
}

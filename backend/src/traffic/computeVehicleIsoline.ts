import type { FeatureCollection, Position } from 'geojson';

function vehicleTypeSpeedKmh(vehicleType: string): number {
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

function buildCirclePolygon(lng: number, lat: number, radiusKm: number, steps = 180): FeatureCollection {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const earthRadiusKm = 6371;
  const centerLatRad = (lat * Math.PI) / 180;
  const centerLonRad = (lng * Math.PI) / 180;

  const coordinates: Position[] = [];

  function offsetPoint(distanceKm: number, bearingDeg: number): [number, number] {
    const dByR = distanceKm / earthRadiusKm;
    const bearing = (bearingDeg * Math.PI) / 180;
    const lat2 =
      Math.asin(
        Math.sin(centerLatRad) * Math.cos(dByR) +
          Math.cos(centerLatRad) * Math.sin(dByR) * Math.cos(bearing)
      );
    const lon1 = centerLonRad;
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(dByR) * Math.cos(centerLatRad),
        Math.cos(dByR) - Math.sin(centerLatRad) * Math.sin(lat2)
      );
    return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
  }

  for (let i = 0; i < steps; i += 1) {
    const bearing = (360 / steps) * i;
    coordinates.push(offsetPoint(radiusKm, bearing));
  }
  if (coordinates.length) coordinates.push(coordinates[0]);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [coordinates],
        },
      },
    ],
  };
}

export async function computeVehicleIsoline(input: {
  lng?: number;
  lat?: number;
  elapsedSeconds: number;
  vehicleType: string;
}): Promise<{ geojson: FeatureCollection; meta: any }> {
  const { lng, lat } = input;
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { reason: 'MISSING_COORDS' },
    };
  }

  const elapsedSeconds = Number.isFinite(input.elapsedSeconds)
    ? Math.max(0, Math.min(3600, input.elapsedSeconds))
    : 0;
  if (elapsedSeconds <= 0) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { reason: 'ZERO_ELAPSED' },
    };
  }

  const speedKmh = vehicleTypeSpeedKmh(input.vehicleType);
  const hours = elapsedSeconds / 3600;
  const radiusKm = speedKmh * hours;

  const geojson = buildCirclePolygon(lng, lat, radiusKm);
  const meta = {
    provider: 'fallback_circle',
    vehicleType: input.vehicleType,
    speedKmh,
    elapsedSeconds,
    radiusKm,
  };

  return { geojson, meta };
}

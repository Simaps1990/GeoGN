import type { ApiZone } from './api';

// Géométrie des zones et des grilles de zone.
//
// Convention canonique d'une case (identique pour TOUTES les orientations):
//   - `col` 0 = première colonne le long de l'axe des colonnes de la grille (u minimal),
//     `row` 0 = première ligne le long de l'axe des lignes (v minimal).
//   - Le libellé est `${lettre(col)}${row + 1}` ("A1" = coin (u,v) minimal).
//     C'est le format déjà validé côté backend (isGridCellIdWithinGrid dans
//     backend/src/routes/zones.ts) et déjà stocké en base dans `gridCellId`.
//
// Pour une grille `vertical`, l'espace grille est directement (lng, lat): "A1" est
// donc au sud-ouest de la bbox. Pour une grille `diag45`, l'espace grille est le
// repère métrique tourné de -45° autour du centre de la zone: "A1" est au coin
// minimal de ce repère tourné. Auparavant `diag45` numérotait les lignes à
// l'envers (`rows - r`) par rapport à `vertical` (`r + 1`), et tous les décodeurs
// de `gridCellId` ignoraient la rotation: une même étiquette pouvait désigner
// deux endroits différents du terrain selon le code qui la produisait ou la
// relisait. Tout passe désormais par ce module.

const METERS_PER_DEG_LAT = 111_320;

export type ZoneGridOrientation = 'vertical' | 'diag45';

export type ZoneBbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

export function getZoneBbox(z: ApiZone): ZoneBbox | null {
  if (z.type === 'circle' && z.circle) {
    const { lng, lat } = z.circle.center;
    const metersPerDegLat = METERS_PER_DEG_LAT;
    const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
    const dLat = z.circle.radiusMeters / metersPerDegLat;
    const dLng = z.circle.radiusMeters / metersPerDegLng;
    return { minLng: lng - dLng, minLat: lat - dLat, maxLng: lng + dLng, maxLat: lat + dLat };
  }

  if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
    const ring = z.polygon.coordinates[0];
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const p of ring) {
      minLng = Math.min(minLng, p[0]);
      minLat = Math.min(minLat, p[1]);
      maxLng = Math.max(maxLng, p[0]);
      maxLat = Math.max(maxLat, p[1]);
    }
    return { minLng, minLat, maxLng, maxLat };
  }

  return null;
}

export function isPointInZone(lng: number, lat: number, z: ApiZone) {
  if (z.type === 'circle' && z.circle) {
    const { center, radiusMeters } = z.circle;
    const metersPerDegLat = METERS_PER_DEG_LAT;
    const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
    const dx = (lng - center.lng) * metersPerDegLng;
    const dy = (lat - center.lat) * metersPerDegLat;
    const distSq = dx * dx + dy * dy;
    return distSq <= radiusMeters * radiusMeters;
  }

  if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
    const ring = z.polygon.coordinates[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];

      const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  return false;
}

/** Approximation polygonale d'un cercle (zone circulaire, brouillon de zone). */
export function circleToPolygon(center: { lng: number; lat: number }, radiusMeters: number, steps = 64) {
  const latRad = (center.lat * Math.PI) / 180;
  const metersPerDegLat = METERS_PER_DEG_LAT;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(latRad);

  const coords: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dx = (radiusMeters / metersPerDegLng) * Math.cos(angle);
    const dy = (radiusMeters / metersPerDegLat) * Math.sin(angle);
    coords.push([center.lng + dx, center.lat + dy]);
  }
  coords.push(coords[0]);
  return { type: 'Polygon', coordinates: [coords] };
}

export function closeRing(ring: number[][]) {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

/** Segments [vMin, vMax] de la droite u = const à l'intérieur du polygone. */
export function clipVerticalLineToPolygon(lng: number, ringInput: number[][]) {
  const ring = closeRing(ringInput);
  const ys: number[] = [];
  const eps = 1e-12;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const dx = x2 - x1;
    if (Math.abs(dx) < eps) {
      if (Math.abs(lng - x1) < eps) {
        ys.push(y1, y2);
      }
      continue;
    }
    const t = (lng - x1) / dx;
    if (t < -eps || t > 1 + eps) continue;
    const y = y1 + t * (y2 - y1);
    ys.push(y);
  }

  ys.sort((a, b) => a - b);
  const segments: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) {
    const a = ys[i];
    const b = ys[i + 1];
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > eps) segments.push([a, b]);
  }
  return segments;
}

/** Segments [uMin, uMax] de la droite v = const à l'intérieur du polygone. */
export function clipHorizontalLineToPolygon(lat: number, ringInput: number[][]) {
  const ring = closeRing(ringInput);
  const xs: number[] = [];
  const eps = 1e-12;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const dy = y2 - y1;
    if (Math.abs(dy) < eps) {
      if (Math.abs(lat - y1) < eps) {
        xs.push(x1, x2);
      }
      continue;
    }
    const t = (lat - y1) / dy;
    if (t < -eps || t > 1 + eps) continue;
    const x = x1 + t * (x2 - x1);
    xs.push(x);
  }

  xs.sort((a, b) => a - b);
  const segments: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i];
    const b = xs[i + 1];
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > eps) segments.push([a, b]);
  }
  return segments;
}

export function gridColumnLetter(col: number) {
  return String.fromCharCode(65 + col);
}

/** "A1" pour (row 0, col 0). Format partagé avec le backend. */
export function formatGridCellId(row: number, col: number) {
  return `${gridColumnLetter(col)}${row + 1}`;
}

/** Inverse de formatGridCellId. Renvoie null si l'étiquette n'a pas le format canonique. */
export function parseGridCellId(gridCellId: string): { row: number; col: number } | null {
  const m = /^([A-Z])(\d+)$/.exec(gridCellId);
  if (!m) return null;
  return { col: m[1].charCodeAt(0) - 65, row: parseInt(m[2], 10) - 1 };
}

export type ZoneGridFrame = {
  rows: number;
  cols: number;
  orientation: ZoneGridOrientation;
  /** bbox de la grille dans l'espace grille (degrés si `vertical`, mètres tournés si `diag45`) */
  minU: number;
  minV: number;
  cellU: number;
  cellV: number;
  /** contour de la zone exprimé dans l'espace grille (polygones uniquement) */
  ring: number[][] | null;
  /** cercle exprimé dans l'espace grille (zones circulaires uniquement) */
  circle: { uOrigin: number; vOrigin: number; uScale: number; vScale: number; radiusMeters: number } | null;
  toLngLat(u: number, v: number): { lng: number; lat: number };
  toGrid(lng: number, lat: number): { u: number; v: number };
  /** (col, row) en unités de case (fractions autorisées; 0,0 = coin minimal de la case A1) */
  cellToLngLat(col: number, row: number): { lng: number; lat: number };
};

/**
 * Repère de la grille d'une zone. Toute la logique "case <-> terrain" passe par là,
 * de sorte que `vertical` et `diag45` partagent exactement la même convention.
 */
export function getZoneGridFrame(z: ApiZone): ZoneGridFrame | null {
  if (!z.grid?.rows || !z.grid?.cols) return null;
  const bbox = getZoneBbox(z);
  if (!bbox) return null;

  const rows = Math.max(1, z.grid.rows);
  const cols = Math.max(1, Math.min(26, z.grid.cols));
  const orientation: ZoneGridOrientation = z.grid.orientation === 'diag45' ? 'diag45' : 'vertical';

  const centerLng = z.type === 'circle' && z.circle ? z.circle.center.lng : (bbox.minLng + bbox.maxLng) / 2;
  const centerLat = z.type === 'circle' && z.circle ? z.circle.center.lat : (bbox.minLat + bbox.maxLat) / 2;
  const metersPerDegLat = METERS_PER_DEG_LAT;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);

  const polygonRing =
    z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length ? z.polygon.coordinates[0] : null;

  const withCellHelper = (
    frame: Omit<ZoneGridFrame, 'cellToLngLat'>
  ): ZoneGridFrame => ({
    ...frame,
    cellToLngLat: (col: number, row: number) =>
      frame.toLngLat(frame.minU + col * frame.cellU, frame.minV + row * frame.cellV),
  });

  if (orientation === 'vertical') {
    return withCellHelper({
      rows,
      cols,
      orientation,
      minU: bbox.minLng,
      minV: bbox.minLat,
      cellU: (bbox.maxLng - bbox.minLng) / cols,
      cellV: (bbox.maxLat - bbox.minLat) / rows,
      ring: polygonRing,
      circle:
        z.type === 'circle' && z.circle
          ? {
              uOrigin: z.circle.center.lng,
              vOrigin: z.circle.center.lat,
              uScale: metersPerDegLng,
              vScale: metersPerDegLat,
              radiusMeters: z.circle.radiusMeters,
            }
          : null,
      toLngLat: (u, v) => ({ lng: u, lat: v }),
      toGrid: (lng, lat) => ({ u: lng, v: lat }),
    });
  }

  // diag45: repère métrique centré sur la zone et tourné de -45°.
  const angle = Math.PI / 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const toGrid = (lng: number, lat: number) => {
    const x = (lng - centerLng) * metersPerDegLng;
    const y = (lat - centerLat) * metersPerDegLat;
    // rotation de -angle
    return { u: x * cos + y * sin, v: -x * sin + y * cos };
  };
  const toLngLat = (u: number, v: number) => {
    const x = u * cos - v * sin;
    const y = u * sin + v * cos;
    return { lng: centerLng + x / metersPerDegLng, lat: centerLat + y / metersPerDegLat };
  };

  let minU: number;
  let maxU: number;
  let minV: number;
  let maxV: number;
  let ring: number[][] | null = null;

  if (z.type === 'circle' && z.circle) {
    const R = z.circle.radiusMeters;
    minU = -R;
    maxU = R;
    minV = -R;
    maxV = R;
  } else if (polygonRing) {
    ring = polygonRing.map((p) => {
      const g = toGrid(p[0], p[1]);
      return [g.u, g.v];
    });
    minU = Math.min(...ring.map((p) => p[0]));
    maxU = Math.max(...ring.map((p) => p[0]));
    minV = Math.min(...ring.map((p) => p[1]));
    maxV = Math.max(...ring.map((p) => p[1]));
  } else {
    return null;
  }

  return withCellHelper({
    rows,
    cols,
    orientation,
    minU,
    minV,
    cellU: (maxU - minU) / cols,
    cellV: (maxV - minV) / rows,
    ring,
    circle:
      z.type === 'circle' && z.circle
        ? { uOrigin: 0, vOrigin: 0, uScale: 1, vScale: 1, radiusMeters: z.circle.radiusMeters }
        : null,
    toLngLat,
    toGrid,
  });
}

/** Segments [v1, v2] de la colonne u = const à l'intérieur de la zone (espace grille). */
export function clipGridColumn(frame: ZoneGridFrame, u: number): [number, number][] {
  if (frame.circle) {
    const { uOrigin, vOrigin, uScale, vScale, radiusMeters: R } = frame.circle;
    const x = (u - uOrigin) * uScale;
    if (Math.abs(x) >= R) return [];
    const y = Math.sqrt(R * R - x * x);
    return [[vOrigin - y / vScale, vOrigin + y / vScale]];
  }
  if (frame.ring) return clipVerticalLineToPolygon(u, frame.ring);
  return [];
}

/** Segments [u1, u2] de la ligne v = const à l'intérieur de la zone (espace grille). */
export function clipGridRow(frame: ZoneGridFrame, v: number): [number, number][] {
  if (frame.circle) {
    const { uOrigin, vOrigin, uScale, vScale, radiusMeters: R } = frame.circle;
    const y = (v - vOrigin) * vScale;
    if (Math.abs(y) >= R) return [];
    const x = Math.sqrt(R * R - y * y);
    return [[uOrigin - x / uScale, uOrigin + x / uScale]];
  }
  if (frame.ring) return clipHorizontalLineToPolygon(v, frame.ring);
  return [];
}

export function isCellInGrid(frame: ZoneGridFrame, row: number, col: number) {
  return row >= 0 && row < frame.rows && col >= 0 && col < frame.cols;
}

export type GridCellBounds = {
  center: { lng: number; lat: number };
  /** anneau fermé [lng, lat] prêt pour une géométrie Polygon */
  ring: [number, number][];
};

/** Centre et contour terrain d'une case. Renvoie null si la case est hors grille. */
export function gridCellBounds(frame: ZoneGridFrame, row: number, col: number): GridCellBounds | null {
  if (!isCellInGrid(frame, row, col)) return null;
  const corner = (c: number, r: number): [number, number] => {
    const p = frame.cellToLngLat(c, r);
    return [p.lng, p.lat];
  };
  const ring: [number, number][] = [
    corner(col, row),
    corner(col + 1, row),
    corner(col + 1, row + 1),
    corner(col, row + 1),
  ];
  return { center: frame.cellToLngLat(col + 0.5, row + 0.5), ring: [...ring, ring[0]] };
}

/** Case contenant un point terrain, ou null si le point est hors de la bbox de la grille. */
export function pickGridCell(frame: ZoneGridFrame, lng: number, lat: number) {
  const { u, v } = frame.toGrid(lng, lat);
  const maxU = frame.minU + frame.cols * frame.cellU;
  const maxV = frame.minV + frame.rows * frame.cellV;
  if (u < frame.minU || u > maxU || v < frame.minV || v > maxV) return null;
  const col = Math.min(frame.cols - 1, Math.max(0, Math.floor((u - frame.minU) / frame.cellU)));
  const row = Math.min(frame.rows - 1, Math.max(0, Math.floor((v - frame.minV) / frame.cellV)));
  return { row, col };
}

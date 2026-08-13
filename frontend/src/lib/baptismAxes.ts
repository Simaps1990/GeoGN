import { parseOverpassPois, rankAxisSuggestions, fallbackAxisName, forbiddenOriginNames } from './baptismNaming';
import { fetchOverpassRoads, fetchOverpassPois } from './api';

export type BaptismIcon = 'person' | 'car' | 'house';

export type OverpassWay = {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
};

export type BaptismAxisResult = {
  axisId: string;
  color: string;
  name: string | null;
  suggestions: string[];
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  bearing: number;
};

export type WalkedAxis = {
  coords: [number, number][];
  lengthMeters: number;
  endType: 'intersection' | 'deadend' | 'cap';
  firstWayTags: Record<string, string>;
};

export const AXIS_PALETTE = [
  '#e6194B', '#4363d8', '#3cb44b', '#ffe119', '#f58231',
  '#911eb4', '#f032e6', '#42d4f4', '#bfef45', '#9A6324',
];

const CAR_HIGHWAYS = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'service', 'living_street', 'track',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);
const FOOT_EXTRA = new Set(['footway', 'path', 'cycleway', 'bridleway', 'steps', 'pedestrian']);

export function isWayAllowed(icon: BaptismIcon, highway: string | undefined): boolean {
  if (!highway) return false;
  if (CAR_HIGHWAYS.has(highway)) return true;
  return icon !== 'car' && FOOT_EXTRA.has(highway);
}

const R = 6371000;
const VERTEX_SNAP_EPS_METERS = 5;
const CAP_METERS = 1500;
const MIN_AXIS_METERS = 10;
// Limites miroir du backend (validateAxis/validateAxes) : au-delà, le PUT est rejeté.
const MAX_AXIS_COORDS = 500;
const MAX_AXES = 20;

export function distMeters(a: [number, number], b: [number, number]): number {
  const dx = ((b[0] - a[0]) * Math.PI / 180) * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180) * R;
  const dy = ((b[1] - a[1]) * Math.PI / 180) * R;
  return Math.hypot(dx, dy);
}

export function bearingDeg(a: [number, number], b: [number, number]): number {
  const f1 = (a[1] * Math.PI) / 180;
  const f2 = (b[1] * Math.PI) / 180;
  const dl = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function destinationPoint(origin: [number, number], bearing: number, meters: number): [number, number] {
  const d = meters / R;
  const th = (bearing * Math.PI) / 180;
  const f1 = (origin[1] * Math.PI) / 180;
  const l1 = (origin[0] * Math.PI) / 180;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [((l2 * 180) / Math.PI + 540) % 360 - 180, (f2 * 180) / Math.PI];
}

type Graph = {
  ways: Map<number, OverpassWay>;
  degree: Map<number, number>;
  occurrences: Map<number, { wayId: number; idx: number }[]>;
};

function buildGraph(ways: OverpassWay[], icon: BaptismIcon): Graph {
  const g: Graph = { ways: new Map(), degree: new Map(), occurrences: new Map() };
  for (const w of ways) {
    if (
      w?.type !== 'way' ||
      !Array.isArray(w.nodes) ||
      !Array.isArray(w.geometry) ||
      w.nodes.length !== w.geometry.length ||
      w.nodes.length < 2 ||
      !isWayAllowed(icon, w.tags?.highway)
    )
      continue;
    g.ways.set(w.id, w);
    w.nodes.forEach((n, i) => {
      const inc = (i > 0 ? 1 : 0) + (i < w.nodes.length - 1 ? 1 : 0);
      g.degree.set(n, (g.degree.get(n) ?? 0) + inc);
      const occ = g.occurrences.get(n) ?? [];
      occ.push({ wayId: w.id, idx: i });
      g.occurrences.set(n, occ);
    });
  }
  return g;
}

function wayCoord(w: OverpassWay, i: number): [number, number] {
  return [w.geometry[i].lon, w.geometry[i].lat];
}

type Snap = { wayId: number; segIdx: number; t: number; point: [number, number] };

function snapToRoads(g: Graph, p: [number, number]): Snap | null {
  let best: Snap | null = null;
  let bestDist = Infinity;
  const cosLat = Math.cos((p[1] * Math.PI) / 180);
  for (const w of g.ways.values()) {
    for (let i = 0; i < w.geometry.length - 1; i++) {
      const a = wayCoord(w, i);
      const b = wayCoord(w, i + 1);
      const ax = (a[0] - p[0]) * cosLat, ay = a[1] - p[1];
      const bx = (b[0] - p[0]) * cosLat, by = b[1] - p[1];
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const q: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const d = distMeters(p, q);
      if (d < bestDist) {
        bestDist = d;
        best = { wayId: w.id, segIdx: i, t, point: q };
      }
    }
  }
  return best;
}

type WalkStart = { wayId: number; fromIdx: number; dir: 1 | -1; startPoint: [number, number] };

function walkOne(g: Graph, start: WalkStart): WalkedAxis {
  const coords: [number, number][] = [start.startPoint];
  let length = 0;
  let { wayId, fromIdx, dir } = start;
  let w = g.ways.get(wayId)!;
  const firstWayTags = w.tags ?? {};
  let guard = 0;

  let idx = fromIdx;
  while (guard++ < 10000) {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= w.nodes.length) break;
    const c = wayCoord(w, nextIdx);
    const prev = coords[coords.length - 1];
    if (c[0] !== prev[0] || c[1] !== prev[1]) {
      length += distMeters(prev, c);
      coords.push(c);
    }
    if (length >= CAP_METERS) return { coords, lengthMeters: length, endType: 'cap', firstWayTags };

    const nodeId = w.nodes[nextIdx];
    const deg = g.degree.get(nodeId) ?? 0;
    if (deg >= 3) return { coords, lengthMeters: length, endType: 'intersection', firstWayTags };

    const atWayEnd = nextIdx === 0 || nextIdx === w.nodes.length - 1;
    if (atWayEnd) {
      if (deg <= 1) return { coords, lengthMeters: length, endType: 'deadend', firstWayTags };
      const occ = (g.occurrences.get(nodeId) ?? []).filter((o) => !(o.wayId === wayId && o.idx === nextIdx));
      const next = occ[0];
      if (!next) return { coords, lengthMeters: length, endType: 'deadend', firstWayTags };
      const nw = g.ways.get(next.wayId)!;
      wayId = next.wayId;
      w = nw;
      idx = next.idx;
      dir = next.idx === 0 ? 1 : -1;
      continue;
    }
    idx = nextIdx;
  }
  return { coords, lengthMeters: length, endType: 'deadend', firstWayTags };
}

// Réduit une polyligne dense (ex. tracé GPS) à `max` sommets max : garde le premier,
// le dernier, et des points intermédiaires régulièrement espacés dans la liste.
function decimateCoords(coords: [number, number][], max: number): [number, number][] {
  if (coords.length <= max) return coords;
  const lastIdx = coords.length - 1;
  const innerCount = max - 2;
  const out: [number, number][] = [coords[0]];
  for (let i = 1; i <= innerCount; i++) {
    out.push(coords[Math.round((i * lastIdx) / (innerCount + 1))]);
  }
  out.push(coords[lastIdx]);
  return out;
}

// Tronque une polyligne à `meters` le long d'elle-même : garde tous les sommets
// traversés puis interpole le dernier point sur le segment où `meters` tombe.
// Renvoie le chemin entier (inchangé) si `meters` dépasse sa longueur totale.
export function slicePathMeters(coords: [number, number][], meters: number): [number, number][] {
  if (coords.length === 0) return [];
  const out: [number, number][] = [coords[0]];
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distMeters(coords[i], coords[i + 1]);
    if (acc + d >= meters && d > 0) {
      const t = (meters - acc) / d;
      out.push([
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
      ]);
      return out;
    }
    acc += d;
    out.push(coords[i + 1]);
  }
  return out;
}

// Cap local du segment où tombe `meters` le long du chemin ; plafonné au cap du
// dernier segment si `meters` dépasse la longueur totale.
// Un chemin à 0 ou 1 point n'a pas de segment dont dériver un cap (le pipeline normal
// filtre déjà `coords.length >= 2`, mais cette fonction est exportée et peut recevoir
// une géométrie d'axe chargée depuis le backend sans repasser par ce filtre) : 0° par
// convention plutôt qu'un throw sur `coords[-1]`/`coords[-2]` undefined.
export function bearingAtMeters(coords: [number, number][], meters: number): number {
  if (coords.length < 2) return 0;
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distMeters(coords[i], coords[i + 1]);
    if (acc + d >= meters && d > 0) return bearingDeg(coords[i], coords[i + 1]);
    acc += d;
  }
  return bearingDeg(coords[coords.length - 2], coords[coords.length - 1]);
}

function pointAlong(coords: [number, number][], meters: number): [number, number] {
  const sliced = slicePathMeters(coords, meters);
  return sliced[sliced.length - 1];
}

function isRingWay(w: OverpassWay): boolean {
  const j = w.tags?.junction;
  return j === 'roundabout' || j === 'circular';
}

// Rassemble tout l'anneau d'un rond-point par BFS sur les ways junction=roundabout/circular
// reliées par un nœud partagé : un rond-point OSM est presque toujours scindé en plusieurs ways.
function gatherRingWays(g: Graph, seedWayIds: Set<number>): Set<number> {
  const ring = new Set<number>();
  const queue = [...seedWayIds];
  while (queue.length) {
    const id = queue.pop()!;
    if (ring.has(id)) continue;
    const rw = g.ways.get(id);
    if (!rw || !isRingWay(rw)) continue;
    ring.add(id);
    for (const n of rw.nodes) {
      for (const occ of g.occurrences.get(n) ?? []) {
        if (!ring.has(occ.wayId)) queue.push(occ.wayId);
      }
    }
  }
  return ring;
}

export function computeAxesFromWays(
  ways: OverpassWay[],
  point: [number, number],
  icon: BaptismIcon
): { axes: BaptismAxisResult[]; walked: WalkedAxis[]; originTags: Record<string, string> } {
  const g = buildGraph(ways, icon);
  if (g.ways.size === 0) return { axes: [], walked: [], originTags: {} };
  const snap = snapToRoads(g, point);
  if (!snap) return { axes: [], walked: [], originTags: {} };

  const starts: WalkStart[] = [];
  const w = g.ways.get(snap.wayId)!;
  // La voie sur laquelle on se trouve : son nom/ref est exclu du nommage TION
  // (deux axes qui partent le long de la même rue porteraient sinon le même nom).
  const originTags = w.tags ?? {};

  const vertexCandidates: { idx: number }[] = [{ idx: snap.segIdx }, { idx: snap.segIdx + 1 }];
  let intersectionVertex: number | null = null;
  for (const { idx } of vertexCandidates) {
    const c = wayCoord(w, idx);
    if (distMeters(snap.point, c) <= VERTEX_SNAP_EPS_METERS && (g.degree.get(w.nodes[idx]) ?? 0) >= 3) {
      intersectionVertex = idx;
      break;
    }
  }

  // Rond-point : la way visée est un anneau, ou le point tombe près d'un nœud qui
  // appartient à un anneau (entrée du rond-point). Dans les deux cas, un axe par
  // branche accrochée à l'anneau ENTIER — pas les 2 arcs de l'anneau lui-même.
  const ringSeeds = new Set<number>();
  if (isRingWay(w)) ringSeeds.add(w.id);
  for (const { idx } of vertexCandidates) {
    const c = wayCoord(w, idx);
    if (distMeters(snap.point, c) > VERTEX_SNAP_EPS_METERS) continue;
    for (const occ of g.occurrences.get(w.nodes[idx]) ?? []) {
      const ow = g.ways.get(occ.wayId);
      if (ow && isRingWay(ow)) ringSeeds.add(ow.id);
    }
  }
  const ringWayIds = ringSeeds.size > 0 ? gatherRingWays(g, ringSeeds) : null;

  if (ringWayIds) {
    const ringNodeIds = new Set<number>();
    for (const id of ringWayIds) for (const n of g.ways.get(id)!.nodes) ringNodeIds.add(n);
    const seen = new Set<string>();
    for (const nodeId of ringNodeIds) {
      const occs = g.occurrences.get(nodeId) ?? [];
      const branchOccs = occs.filter((o) => !ringWayIds.has(o.wayId));
      if (branchOccs.length === 0) continue;
      const origin = wayCoord(g.ways.get(occs[0].wayId)!, occs[0].idx);
      for (const occ of branchOccs) {
        const ow = g.ways.get(occ.wayId)!;
        for (const dir of [1, -1] as const) {
          const ni = occ.idx + dir;
          if (ni < 0 || ni >= ow.nodes.length) continue;
          const edgeKey = `${occ.wayId}:${Math.min(occ.idx, ni)}`;
          if (seen.has(edgeKey)) continue;
          seen.add(edgeKey);
          starts.push({ wayId: occ.wayId, fromIdx: occ.idx, dir, startPoint: origin });
        }
      }
    }
  } else if (intersectionVertex !== null) {
    const nodeId = w.nodes[intersectionVertex];
    const origin = wayCoord(w, intersectionVertex);
    const seen = new Set<string>();
    for (const occ of g.occurrences.get(nodeId) ?? []) {
      const ow = g.ways.get(occ.wayId)!;
      for (const dir of [1, -1] as const) {
        const ni = occ.idx + dir;
        if (ni < 0 || ni >= ow.nodes.length) continue;
        const edgeKey = `${occ.wayId}:${Math.min(occ.idx, ni)}`;
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);
        starts.push({ wayId: occ.wayId, fromIdx: occ.idx, dir, startPoint: origin });
      }
    }
  } else {
    starts.push({ wayId: snap.wayId, fromIdx: snap.segIdx + 1, dir: -1, startPoint: snap.point });
    starts.push({ wayId: snap.wayId, fromIdx: snap.segIdx, dir: 1, startPoint: snap.point });
  }

  const walked = starts
    .map((s) => walkOne(g, s))
    .filter((wa) => wa.coords.length >= 2 && wa.lengthMeters >= MIN_AXIS_METERS);

  const withBearing = walked.map((wa) => ({
    wa,
    bearing: bearingDeg(wa.coords[0], pointAlong(wa.coords, Math.min(30, wa.lengthMeters))),
  }));
  withBearing.sort((a, b) => a.bearing - b.bearing);
  const capped = withBearing.slice(0, MAX_AXES);

  const axes: BaptismAxisResult[] = capped.map((x, i) => ({
    axisId: `a${i}`,
    color: AXIS_PALETTE[i % AXIS_PALETTE.length],
    name: null,
    suggestions: [],
    geometry: { type: 'LineString', coordinates: decimateCoords(x.wa.coords, MAX_AXIS_COORDS) },
    bearing: Math.round(x.bearing * 10) / 10 % 360,
  }));

  return { axes, walked: capped.map((x) => x.wa), originTags };
}

// Un miroir Overpass surchargé répond parfois HTTP 200 avec un corps d'erreur
// (`remark` de timeout/runtime-error) ou sans tableau `elements` exploitable.
// Sans cette validation, l'appelant lisait ça comme "zéro route" au lieu d'un
// échec de miroir, d'où de faux NO_ROAD_NEARBY en zone pourtant couverte.
// Le fetch Overpass direct côté client a été retiré : le terrain passe désormais
// par le proxy backend (cache Mongo partagé, voir backend/src/routes/overpass.ts,
// qui porte sa propre copie de cette garde). Cette fonction n'est plus appelée en
// runtime ici, mais reste exportée pour ses tests (baptismAxes.test.ts).
export function parseOverpassElements(json: any): OverpassWay[] {
  if (!json || typeof json !== 'object') throw new Error('OVERPASS_BAD_RESPONSE');
  if (typeof json.remark === 'string' && json.remark.length > 0) throw new Error('OVERPASS_BAD_RESPONSE');
  if (!Array.isArray(json.elements)) throw new Error('OVERPASS_BAD_RESPONSE');
  return json.elements;
}

export async function computeBaptismAxes(
  point: { lng: number; lat: number },
  icon: BaptismIcon
): Promise<{ axes: BaptismAxisResult[]; walked: WalkedAxis[] }> {
  // Les POI de nommage ne dépendent pas du rayon : requête lancée en parallèle
  // de la première requête routes (latence divisée par ~2), réutilisée ensuite.
  const poisPromise = fetchOverpassPois(point.lat, point.lng).catch(() => [] as OverpassWay[]);
  for (const radius of [250, 500]) {
    const elements = await fetchOverpassRoads(point.lat, point.lng, radius);
    const result = computeAxesFromWays(elements, [point.lng, point.lat], icon);
    if (result.axes.length === 0) continue;

    const candidates = parseOverpassPois({ elements: await poisPromise });
    const origin: [number, number] = [point.lng, point.lat];
    const forbidden = forbiddenOriginNames(result.originTags);
    // Deux axes ne reçoivent jamais le même nom auto : avec les génériques
    // (ÉCOLE, MAIRIE…), un même POI peut tomber dans le cône de deux axes.
    const used = new Set<string>();
    const named = result.axes.map((a, i) => {
      const suggestions = rankAxisSuggestions(a.bearing, origin, candidates, undefined, forbidden);
      const fallback = fallbackAxisName(result.walked[i]?.firstWayTags ?? {}, a.bearing, forbidden);
      const all = [...suggestions];
      if (!all.includes(fallback)) all.push(fallback);
      const name = all.find((n) => !used.has(n)) ?? all[0] ?? null;
      if (name) used.add(name);
      return { ...a, suggestions: all.slice(0, 5), name };
    });
    return { axes: named, walked: result.walked };
  }
  throw new Error('NO_ROAD_NEARBY');
}

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../plugins/auth.js';
import { OverpassCacheModel } from '../models/overpassCache.js';

type OverpassKind = 'roads' | 'pois';

// Miroirs MONDIAUX uniquement — même liste que l'ancien fetch client (retiré de
// frontend/src/lib/baptismAxes.ts au profit de ce proxy). Ne jamais ajouter un miroir
// régional : overpass.osm.ch (couverture Suisse) répondait « proprement » 0 élément
// pour toute la France, d'où un faux « Aucune route trouvée » côté terrain.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
// Mémoire du dernier miroir qui a répondu : essayé en premier au coup suivant,
// pour éviter de repayer la cascade complète à chaque requête non cachée.
let lastGoodMirror: string | null = null;

const FRESH_TTL_MS: Record<OverpassKind, number> = {
  roads: 30 * 24 * 60 * 60 * 1000,
  pois: 7 * 24 * 60 * 60 * 1000,
};
// Fenêtre de secours : au-delà de expiresAt le cache n'est plus "frais" mais reste
// utilisable en dépannage (stale:true) si la cascade de miroirs échoue entièrement.
const STALE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function validateCoords(lat: unknown, lng: unknown): boolean {
  return isFiniteNumber(lat) && lat >= -90 && lat <= 90 && isFiniteNumber(lng) && lng >= -180 && lng <= 180;
}

export function buildCacheKey(kind: OverpassKind, radius: number, lat: number, lng: number): string {
  return `${kind}:${radius}:${lat.toFixed(3)},${lng.toFixed(3)}`;
}

// Copie serveur de la garde anti-miroir-dégradé du client : un miroir Overpass
// surchargé répond parfois HTTP 200 avec un corps d'erreur (`remark` de
// timeout/runtime-error) ou sans tableau `elements` exploitable.
export function parseOverpassElements(json: any): unknown[] {
  if (!json || typeof json !== 'object') throw new Error('OVERPASS_BAD_RESPONSE');
  if (typeof json.remark === 'string' && json.remark.length > 0) throw new Error('OVERPASS_BAD_RESPONSE');
  if (!Array.isArray(json.elements)) throw new Error('OVERPASS_BAD_RESPONSE');
  return json.elements;
}

async function fetchFromMirrors(query: string, treatEmptyAsSuspicious: boolean): Promise<unknown[]> {
  const order = lastGoodMirror
    ? [lastGoodMirror, ...OVERPASS_MIRRORS.filter((m) => m !== lastGoodMirror)]
    : [...OVERPASS_MIRRORS];
  let emptyResult: unknown[] | null = null;
  for (let i = 0; i < order.length; i += 1) {
    const url = order[i];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const elements = parseOverpassElements(await res.json());
      // Un vide n'est fiable que venant du dernier miroir de la cascade (idem client) :
      // un miroir dégradé peut répondre "proprement" 0 élément là où un autre a des données.
      if (elements.length === 0 && treatEmptyAsSuspicious && i < order.length - 1) {
        emptyResult = elements;
        continue;
      }
      lastGoodMirror = url;
      return elements;
    } catch {
      // corps invalide, HTTP en erreur ou timeout : miroir suivant
    }
  }
  if (emptyResult) return emptyResult;
  throw new Error('OVERPASS_UNAVAILABLE');
}

function buildRoadsQuery(lat: number, lng: number, radius: number): string {
  return `[out:json][timeout:25];way(around:${radius},${lat},${lng})[highway];out geom;`;
}

// Identique à buildPoiQuery du frontend (frontend/src/lib/baptismNaming.ts).
function buildPoisQuery(lat: number, lng: number): string {
  const around = `around:2000,${lat},${lng}`;
  return (
    `[out:json][timeout:25];(` +
    `node(${around})[name][place];` +
    `node(${around})[name][shop];way(${around})[name][shop];` +
    `node(${around})[name][amenity];way(${around})[name][amenity];` +
    `);out center;`
  );
}

async function resolveOverpass(
  kind: OverpassKind,
  radius: number,
  lat: number,
  lng: number,
  query: string,
  treatEmptyAsSuspicious: boolean
): Promise<{ elements: unknown[]; cached?: true; stale?: true }> {
  const key = buildCacheKey(kind, radius, lat, lng);
  const now = new Date();
  const cached = await OverpassCacheModel.findOne({ key }).lean();
  if (cached && cached.expiresAt > now) {
    return { elements: cached.elements, cached: true };
  }

  try {
    const elements = await fetchFromMirrors(query, treatEmptyAsSuspicious);
    const expiresAt = new Date(now.getTime() + FRESH_TTL_MS[kind]);
    const purgeAt = new Date(expiresAt.getTime() + STALE_WINDOW_MS);
    try {
      await OverpassCacheModel.updateOne({ key }, { $set: { key, elements, expiresAt, purgeAt } }, { upsert: true });
    } catch {
      // ponytail: rare duplicate-key race between two concurrent cache misses on the
      // same key (unique index) — the fetch already succeeded, serve it anyway; the
      // next miss on this key repopulates the cache. Per-key lock if this ever bites.
    }
    return { elements };
  } catch {
    if (cached) return { elements: cached.elements, stale: true };
    throw new Error('OVERPASS_UNAVAILABLE');
  }
}

export async function overpassRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { lat?: string; lng?: string; radius?: string } }>(
    '/overpass/roads',
    async (
      req: FastifyRequest<{ Querystring: { lat?: string; lng?: string; radius?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radius = Number(req.query.radius);
      if (!validateCoords(lat, lng)) return reply.code(400).send({ error: 'INVALID_COORDS' });
      if (radius !== 250 && radius !== 500) return reply.code(400).send({ error: 'INVALID_RADIUS' });

      try {
        const result = await resolveOverpass('roads', radius, lat, lng, buildRoadsQuery(lat, lng, radius), true);
        return reply.send(result);
      } catch {
        return reply.code(503).send({ error: 'OVERPASS_UNAVAILABLE' });
      }
    }
  );

  app.get<{ Querystring: { lat?: string; lng?: string } }>(
    '/overpass/pois',
    async (req: FastifyRequest<{ Querystring: { lat?: string; lng?: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      if (!validateCoords(lat, lng)) return reply.code(400).send({ error: 'INVALID_COORDS' });

      try {
        const result = await resolveOverpass('pois', 2000, lat, lng, buildPoisQuery(lat, lng), false);
        return reply.send(result);
      } catch {
        return reply.code(503).send({ error: 'OVERPASS_UNAVAILABLE' });
      }
    }
  );
}

# Baptême terrain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Depuis un point (personne/voiture/maison) placé sur la carte, calculer, colorer et nommer les axes routiers qui en partent (jusqu'à la prochaine intersection), partagés en temps réel avec la mission.

**Architecture:** Le client créateur interroge Overpass (OSM), calcule les axes dans une lib pure testable (`frontend/src/lib/baptismAxes.ts`), et envoie le résultat au backend qui ne fait que valider/stocker/diffuser (modèle + routes calqués sur les zones, socket `baptism:*`). Rendu MapLibre : chevrons colorés (mode `colors`), flèche + étiquette « TION X » (mode `tion`), ou les deux (`both`).

**Tech Stack:** Fastify + Mongoose (backend), React + MapLibre GL (frontend), node:test via tsx (tests), Overpass API (données OSM, gratuit sans clé).

**Spec:** `docs/superpowers/specs/2026-08-12-bapteme-terrain-design.md`

## Global Constraints

- Aucune nouvelle dépendance npm (ni backend ni frontend).
- Tests = `node:test` lancés par `npm test` (backend : `tsx --test 'src/**/*.test.ts'` ; frontend : `tsx --test src/lib/*.test.ts` — les libs testées DOIVENT vivre dans `frontend/src/lib/`).
- Après toute tâche frontend : `cd frontend && npm run typecheck` doit passer.
- UI en français, classes tailwind du style existant.
- Suivre les patterns zones : routes (`backend/src/routes/zones.ts`), modèle (`backend/src/models/zone.ts`), client (`frontend/src/lib/api.ts`), socket room `mission:${missionId}`.
- Messages de commit en français, impératif (« Ajoute… », « Corrige… »).
- Ne jamais lancer de serveur dev pendant les tâches ; la vérification manuelle est une étape dédiée à la fin.
- Rôle `viewer` : lecture seule (GET autorisé, PUT/PATCH/DELETE interdits) — même règle que les zones.

---

### Task 1: Backend — modèle, validateurs, routes, socket

**Files:**
- Create: `backend/src/models/baptism.ts`
- Create: `backend/src/routes/baptisms.ts`
- Create: `backend/src/routes/baptisms.test.ts`
- Modify: `backend/src/index.ts` (2 lignes : import + enregistrement, à côté de `zonesRoutes`)

**Interfaces:**
- Consumes: `requireAuth` (`../plugins/auth.js`), `MissionMemberModel`, pattern `getMembership` copié de `zones.ts`.
- Produces (utilisé par Task 2 et 4) :
  - REST : `GET|PUT|PATCH|DELETE /missions/:missionId/baptism`
  - DTO JSON : `{ id, missionId, icon: 'person'|'car'|'house', point: {lng,lat}, displayMode: 'colors'|'tion'|'both', axes: [{ axisId, color, name, suggestions, geometry: {type:'LineString', coordinates:[[lng,lat],...]}, bearing }], createdBy, createdAt, updatedAt }`
  - Socket : `baptism:updated` `{ missionId, baptism: <dto avec dates ISO> }`, `baptism:deleted` `{ missionId }`
  - Validateurs exportés pour tests : `validateLngLatPoint`, `validateDisplayMode`, `validateIcon`, `validateAxis`, `validateAxes`

- [ ] **Step 1: Écrire les tests des validateurs (qui échouent)**

Créer `backend/src/routes/baptisms.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLngLatPoint,
  validateDisplayMode,
  validateIcon,
  validateAxis,
  validateAxes,
} from './baptisms.js';

const goodAxis = {
  axisId: 'a0',
  color: '#e6194B',
  name: null,
  suggestions: [],
  geometry: { type: 'LineString', coordinates: [[2.0, 48.0], [2.001, 48.0]] },
  bearing: 90,
};

test('validateLngLatPoint accepte un point valide et rejette le reste', () => {
  assert.equal(validateLngLatPoint({ lng: 2.35, lat: 48.85 }), true);
  assert.equal(validateLngLatPoint({ lng: 181, lat: 0 }), false);
  assert.equal(validateLngLatPoint({ lng: 0, lat: -91 }), false);
  assert.equal(validateLngLatPoint({ lng: NaN, lat: 0 }), false);
  assert.equal(validateLngLatPoint(null), false);
  assert.equal(validateLngLatPoint({ lng: '2', lat: 48 }), false);
});

test('validateDisplayMode et validateIcon acceptent uniquement les enums', () => {
  assert.equal(validateDisplayMode('colors'), true);
  assert.equal(validateDisplayMode('tion'), true);
  assert.equal(validateDisplayMode('both'), true);
  assert.equal(validateDisplayMode('rainbow'), false);
  assert.equal(validateIcon('person'), true);
  assert.equal(validateIcon('car'), true);
  assert.equal(validateIcon('house'), true);
  assert.equal(validateIcon('dog'), false);
});

test('validateAxis vérifie chaque champ', () => {
  assert.equal(validateAxis(goodAxis), null);
  assert.equal(validateAxis({ ...goodAxis, axisId: '' }), 'INVALID_AXIS_ID');
  assert.equal(validateAxis({ ...goodAxis, color: 'rouge' }), 'INVALID_AXIS_COLOR');
  assert.equal(validateAxis({ ...goodAxis, name: 'X'.repeat(41) }), 'INVALID_AXIS_NAME');
  assert.equal(validateAxis({ ...goodAxis, name: 'AUCHAN' }), null);
  assert.equal(validateAxis({ ...goodAxis, bearing: 360 }), 'INVALID_AXIS_BEARING');
  assert.equal(validateAxis({ ...goodAxis, bearing: -1 }), 'INVALID_AXIS_BEARING');
  assert.equal(
    validateAxis({ ...goodAxis, geometry: { type: 'LineString', coordinates: [[2, 48]] } }),
    'INVALID_AXIS_GEOMETRY'
  );
  assert.equal(
    validateAxis({ ...goodAxis, geometry: { type: 'LineString', coordinates: [[200, 48], [2, 48]] } }),
    'INVALID_AXIS_GEOMETRY'
  );
  assert.equal(validateAxis({ ...goodAxis, suggestions: ['A', 'B', 'C', 'D', 'E', 'F'] }), 'INVALID_AXIS_SUGGESTIONS');
});

test('validateAxes exige 1 à 20 axes avec des axisId uniques', () => {
  assert.equal(validateAxes([goodAxis]), null);
  assert.deepEqual(validateAxes([]), { error: 'AXES_REQUIRED' });
  assert.deepEqual(validateAxes([goodAxis, goodAxis]), { error: 'DUPLICATE_AXIS_ID' });
  const many = Array.from({ length: 21 }, (_, i) => ({ ...goodAxis, axisId: `a${i}` }));
  assert.deepEqual(validateAxes(many), { error: 'TOO_MANY_AXES' });
  assert.deepEqual(validateAxes([{ ...goodAxis, color: 'x' }]), { error: 'INVALID_AXIS_COLOR' });
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd backend && npm test`
Expected: FAIL — `Cannot find module './baptisms.js'`

- [ ] **Step 3: Créer le modèle**

Créer `backend/src/models/baptism.ts` :

```ts
import mongoose, { Schema } from 'mongoose';

export type BaptismIcon = 'person' | 'car' | 'house';
export type BaptismDisplayMode = 'colors' | 'tion' | 'both';

type GeoJSONLineString = {
  type: 'LineString';
  coordinates: number[][];
};

export interface BaptismAxis {
  axisId: string;
  color: string;
  name: string | null;
  suggestions: string[];
  geometry: GeoJSONLineString;
  bearing: number;
}

export interface BaptismDoc {
  _id: mongoose.Types.ObjectId;
  missionId: mongoose.Types.ObjectId;
  icon: BaptismIcon;
  point: { lng: number; lat: number };
  displayMode: BaptismDisplayMode;
  axes: BaptismAxis[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const GeoJSONLineStringSchema = new Schema<GeoJSONLineString>(
  {
    type: { type: String, required: true, enum: ['LineString'], default: 'LineString' },
    coordinates: { type: [[Number]], required: true },
  },
  { _id: false }
);

const BaptismAxisSchema = new Schema<BaptismAxis>(
  {
    axisId: { type: String, required: true },
    color: { type: String, required: true },
    name: { type: String, required: false, default: null },
    suggestions: { type: [String], default: [] },
    geometry: { type: GeoJSONLineStringSchema, required: true },
    bearing: { type: Number, required: true },
  },
  { _id: false }
);

const BaptismSchema = new Schema<BaptismDoc>(
  {
    missionId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
    icon: { type: String, required: true, enum: ['person', 'car', 'house'] },
    point: {
      type: { lng: Number, lat: Number },
      required: true,
    },
    displayMode: { type: String, required: true, enum: ['colors', 'tion', 'both'], default: 'colors' },
    axes: { type: [BaptismAxisSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { collection: 'baptisms' }
);

export const BaptismModel = mongoose.model<BaptismDoc>('Baptism', BaptismSchema);
```

- [ ] **Step 4: Créer les routes avec validateurs**

Créer `backend/src/routes/baptisms.ts`. Le helper `getMembership` est copié de `zones.ts` (il y est privé) :

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { requireAuth } from '../plugins/auth.js';
import { MissionMemberModel } from '../models/missionMember.js';
import { BaptismModel, type BaptismDoc, type BaptismIcon, type BaptismDisplayMode } from '../models/baptism.js';

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function validateLngLatPoint(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false;
  const { lng, lat } = p as { lng?: unknown; lat?: unknown };
  return isFiniteNumber(lng) && isFiniteNumber(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

export function validateDisplayMode(m: unknown): m is BaptismDisplayMode {
  return m === 'colors' || m === 'tion' || m === 'both';
}

export function validateIcon(i: unknown): i is BaptismIcon {
  return i === 'person' || i === 'car' || i === 'house';
}

export function validateAxis(a: unknown): string | null {
  if (!a || typeof a !== 'object') return 'INVALID_AXIS';
  const axis = a as Record<string, unknown>;
  if (typeof axis.axisId !== 'string' || axis.axisId.length < 1 || axis.axisId.length > 32) return 'INVALID_AXIS_ID';
  if (typeof axis.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(axis.color)) return 'INVALID_AXIS_COLOR';
  if (axis.name !== null && (typeof axis.name !== 'string' || axis.name.length > 40)) return 'INVALID_AXIS_NAME';
  if (
    !Array.isArray(axis.suggestions) ||
    axis.suggestions.length > 5 ||
    !axis.suggestions.every((s) => typeof s === 'string' && s.length <= 40)
  )
    return 'INVALID_AXIS_SUGGESTIONS';
  const geom = axis.geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!geom || geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) return 'INVALID_AXIS_GEOMETRY';
  const coords = geom.coordinates as unknown[];
  if (coords.length < 2 || coords.length > 500) return 'INVALID_AXIS_GEOMETRY';
  for (const pos of coords) {
    if (!Array.isArray(pos) || pos.length < 2) return 'INVALID_AXIS_GEOMETRY';
    const [lng, lat] = pos as unknown[];
    if (!isFiniteNumber(lng) || !isFiniteNumber(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90)
      return 'INVALID_AXIS_GEOMETRY';
  }
  if (!isFiniteNumber(axis.bearing) || axis.bearing < 0 || axis.bearing >= 360) return 'INVALID_AXIS_BEARING';
  return null;
}

export function validateAxes(list: unknown): { error: string } | null {
  if (!Array.isArray(list) || list.length === 0) return { error: 'AXES_REQUIRED' };
  if (list.length > 20) return { error: 'TOO_MANY_AXES' };
  const ids = new Set<string>();
  for (const a of list) {
    const err = validateAxis(a);
    if (err) return { error: err };
    const id = (a as { axisId: string }).axisId;
    if (ids.has(id)) return { error: 'DUPLICATE_AXIS_ID' };
    ids.add(id);
  }
  return null;
}

async function getMembership(userId: string, missionId: string) {
  return MissionMemberModel.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    missionId: new mongoose.Types.ObjectId(missionId),
  }).lean();
}

function toDto(b: BaptismDoc) {
  return {
    id: b._id.toString(),
    missionId: b.missionId.toString(),
    icon: b.icon,
    point: b.point,
    displayMode: b.displayMode,
    axes: b.axes.map((a) => ({
      axisId: a.axisId,
      color: a.color,
      name: a.name ?? null,
      suggestions: a.suggestions ?? [],
      geometry: a.geometry,
      bearing: a.bearing,
    })),
    createdBy: b.createdBy.toString(),
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function emitUpdated(app: FastifyInstance, missionId: string, dto: ReturnType<typeof toDto>) {
  app.io?.to(`mission:${missionId}`).emit('baptism:updated', {
    missionId,
    baptism: { ...dto, createdAt: dto.createdAt.toISOString(), updatedAt: dto.updatedAt.toISOString() },
  });
}

type PutBody = {
  icon: BaptismIcon;
  point: { lng: number; lat: number };
  displayMode: BaptismDisplayMode;
  axes: BaptismDoc['axes'];
};

type PatchBody = {
  displayMode?: BaptismDisplayMode;
  axisId?: string;
  name?: string | null;
  color?: string;
  remove?: boolean;
};

export async function baptismsRoutes(app: FastifyInstance) {
  app.get<{ Params: { missionId: string } }>(
    '/missions/:missionId/baptism',
    async (req: FastifyRequest<{ Params: { missionId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem) return reply.code(403).send({ error: 'FORBIDDEN' });
      const b = await BaptismModel.findOne({ missionId }).lean();
      if (!b) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.send(toDto(b as BaptismDoc));
    }
  );

  app.put<{ Params: { missionId: string }; Body: PutBody }>(
    '/missions/:missionId/baptism',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: PutBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });

      const body = req.body as PutBody;
      if (!validateIcon(body?.icon)) return reply.code(400).send({ error: 'INVALID_ICON' });
      if (!validateLngLatPoint(body?.point)) return reply.code(400).send({ error: 'INVALID_POINT' });
      if (!validateDisplayMode(body?.displayMode)) return reply.code(400).send({ error: 'INVALID_DISPLAY_MODE' });
      const axesErr = validateAxes(body?.axes);
      if (axesErr) return reply.code(400).send(axesErr);

      const now = new Date();
      const b = await BaptismModel.findOneAndUpdate(
        { missionId: new mongoose.Types.ObjectId(missionId) },
        {
          $set: {
            icon: body.icon,
            point: { lng: body.point.lng, lat: body.point.lat },
            displayMode: body.displayMode,
            axes: body.axes.map((a) => ({
              axisId: a.axisId,
              color: a.color,
              name: typeof a.name === 'string' ? a.name.trim().toUpperCase() : null,
              suggestions: (a.suggestions ?? []).map((s) => s.trim().toUpperCase()),
              geometry: a.geometry,
              bearing: a.bearing,
            })),
            updatedAt: now,
          },
          $setOnInsert: {
            createdBy: new mongoose.Types.ObjectId(req.userId),
            createdAt: now,
          },
        },
        { upsert: true, new: true }
      ).lean();

      const dto = toDto(b as BaptismDoc);
      emitUpdated(app, missionId, dto);
      return reply.code(200).send(dto);
    }
  );

  app.patch<{ Params: { missionId: string }; Body: PatchBody }>(
    '/missions/:missionId/baptism',
    async (req: FastifyRequest<{ Params: { missionId: string }; Body: PatchBody }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });

      const b = await BaptismModel.findOne({ missionId });
      if (!b) return reply.code(404).send({ error: 'NOT_FOUND' });

      const body = req.body as PatchBody;
      if (body.displayMode !== undefined) {
        if (!validateDisplayMode(body.displayMode)) return reply.code(400).send({ error: 'INVALID_DISPLAY_MODE' });
        b.displayMode = body.displayMode;
      }
      if (body.axisId !== undefined) {
        const axis = b.axes.find((a) => a.axisId === body.axisId);
        if (!axis) return reply.code(404).send({ error: 'AXIS_NOT_FOUND' });
        if (body.remove === true) {
          b.axes = b.axes.filter((a) => a.axisId !== body.axisId);
        } else {
          if (body.name !== undefined) {
            if (body.name !== null && (typeof body.name !== 'string' || body.name.length > 40))
              return reply.code(400).send({ error: 'INVALID_AXIS_NAME' });
            axis.name = typeof body.name === 'string' ? body.name.trim().toUpperCase() : null;
          }
          if (body.color !== undefined) {
            if (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.color))
              return reply.code(400).send({ error: 'INVALID_AXIS_COLOR' });
            axis.color = body.color;
          }
        }
      }
      b.updatedAt = new Date();
      await b.save();

      const dto = toDto(b.toObject() as BaptismDoc);
      emitUpdated(app, missionId, dto);
      return reply.send(dto);
    }
  );

  app.delete<{ Params: { missionId: string } }>(
    '/missions/:missionId/baptism',
    async (req: FastifyRequest<{ Params: { missionId: string } }>, reply: FastifyReply) => {
      try {
        requireAuth(req);
      } catch (e: any) {
        return reply.code(e.statusCode ?? 401).send({ error: 'UNAUTHORIZED' });
      }
      const { missionId } = req.params;
      if (!mongoose.Types.ObjectId.isValid(missionId)) return reply.code(400).send({ error: 'INVALID_MISSION_ID' });
      const mem = await getMembership(req.userId, missionId);
      if (!mem || (mem as any).role === 'viewer') return reply.code(403).send({ error: 'FORBIDDEN' });
      await BaptismModel.deleteOne({ missionId });
      app.io?.to(`mission:${missionId}`).emit('baptism:deleted', { missionId });
      return reply.send({ ok: true });
    }
  );
}
```

- [ ] **Step 5: Enregistrer les routes**

Dans `backend/src/index.ts` : après la ligne `import { zonesRoutes } from './routes/zones.js';` ajouter :

```ts
import { baptismsRoutes } from './routes/baptisms.js';
```

Après la ligne `await zonesRoutes(app);` ajouter :

```ts
await baptismsRoutes(app);
```

- [ ] **Step 6: Vérifier que les tests passent**

Run: `cd backend && npm test`
Expected: PASS (les 4 nouveaux tests + tous les tests existants)

- [ ] **Step 7: Vérifier la compilation**

Run: `cd backend && npm run build`
Expected: succès sans erreur TypeScript

- [ ] **Step 8: Commit**

```bash
git add backend/src/models/baptism.ts backend/src/routes/baptisms.ts backend/src/routes/baptisms.test.ts backend/src/index.ts
git commit -m "Ajoute le modèle et les routes baptême terrain (backend)"
```

---

### Task 2: Client API frontend

**Files:**
- Modify: `frontend/src/lib/api.ts` (ajouts en fin de fichier, types près des types Zone ~ligne 58)

**Interfaces:**
- Consumes: `apiFetch` (défini dans `api.ts`), DTO du Task 1.
- Produces (utilisé par Task 4) :
  - `ApiBaptismAxis`, `ApiBaptism` (types exportés)
  - `getBaptism(missionId): Promise<ApiBaptism | null>` (404 → null)
  - `putBaptism(missionId, input): Promise<ApiBaptism>`
  - `patchBaptism(missionId, input): Promise<ApiBaptism>`
  - `deleteBaptism(missionId): Promise<void>`

- [ ] **Step 1: Ajouter les types et fonctions**

Dans `frontend/src/lib/api.ts`, près des types `ApiZone` :

```ts
export type ApiBaptismAxis = {
  axisId: string;
  color: string;
  name: string | null;
  suggestions: string[];
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  bearing: number;
};

export type ApiBaptism = {
  id: string;
  missionId: string;
  icon: 'person' | 'car' | 'house';
  point: { lng: number; lat: number };
  displayMode: 'colors' | 'tion' | 'both';
  axes: ApiBaptismAxis[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
```

En fin de fichier :

```ts
export async function getBaptism(missionId: string): Promise<ApiBaptism | null> {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/baptism`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'GET_BAPTISM_FAILED');
  }
  return (await res.json()) as ApiBaptism;
}

export async function putBaptism(
  missionId: string,
  input: {
    icon: 'person' | 'car' | 'house';
    point: { lng: number; lat: number };
    displayMode: 'colors' | 'tion' | 'both';
    axes: ApiBaptismAxis[];
  }
): Promise<ApiBaptism> {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/baptism`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'PUT_BAPTISM_FAILED');
  }
  return (await res.json()) as ApiBaptism;
}

export async function patchBaptism(
  missionId: string,
  input: {
    displayMode?: 'colors' | 'tion' | 'both';
    axisId?: string;
    name?: string | null;
    color?: string;
    remove?: boolean;
  }
): Promise<ApiBaptism> {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/baptism`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'PATCH_BAPTISM_FAILED');
  }
  return (await res.json()) as ApiBaptism;
}

export async function deleteBaptism(missionId: string): Promise<void> {
  const res = await apiFetch(`/missions/${encodeURIComponent(missionId)}/baptism`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? 'DELETE_BAPTISM_FAILED');
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: succès

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "Ajoute le client API baptême terrain"
```

---

### Task 3: Lib de calcul des axes (Overpass → graphe → axes)

**Files:**
- Create: `frontend/src/lib/baptismAxes.ts`
- Create: `frontend/src/lib/baptismAxes.test.ts`

**Interfaces:**
- Consumes: rien (lib pure ; `fetch` global pour la partie réseau, non testée unitairement).
- Produces (utilisé par Task 4 et 5) :
  - `type BaptismIcon = 'person' | 'car' | 'house'`
  - `type BaptismAxisResult = { axisId: string; color: string; name: null; suggestions: string[]; geometry: { type: 'LineString'; coordinates: [number, number][] }; bearing: number }`
  - `type WalkedAxis = { coords: [number, number][]; lengthMeters: number; endType: 'intersection' | 'deadend' | 'cap'; firstWayTags: Record<string, string> }`
  - `AXIS_PALETTE: string[]` (10 couleurs)
  - `isWayAllowed(icon, highway): boolean`
  - `distMeters(a, b)`, `bearingDeg(a, b)`, `destinationPoint(origin, bearing, meters): [number, number]`
  - `computeAxesFromWays(ways, point: [lng, lat], icon): { axes: BaptismAxisResult[]; walked: WalkedAxis[] }`
  - `fetchOverpass(query): Promise<any>` (3 miroirs en cascade)
  - `computeBaptismAxes(point: {lng,lat}, icon): Promise<{ axes: BaptismAxisResult[]; walked: WalkedAxis[] }>` (rayon 250 m puis 500 m, throw `NO_ROAD_NEARBY` / `OVERPASS_UNAVAILABLE`)

- [ ] **Step 1: Écrire les tests fixtures (qui échouent)**

Créer `frontend/src/lib/baptismAxes.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AXIS_PALETTE,
  isWayAllowed,
  distMeters,
  bearingDeg,
  destinationPoint,
  computeAxesFromWays,
  type OverpassWay,
} from './baptismAxes.js';

function way(id: number, nodes: number[], pts: [number, number][], tags: Record<string, string> = { highway: 'residential' }): OverpassWay {
  return { type: 'way', id, tags, nodes, geometry: pts.map(([lon, lat]) => ({ lat, lon })) };
}

const CROSS: OverpassWay[] = [
  way(1, [1, 100, 2], [[1.999, 48], [2, 48], [2.001, 48]], { highway: 'residential', name: 'Rue Est-Ouest' }),
  way(2, [3, 100, 4], [[2, 47.999], [2, 48], [2, 48.001]]),
];

test('bearingDeg et destinationPoint sont cohérents', () => {
  const north = bearingDeg([2, 48], [2, 48.001]);
  assert.ok(Math.abs(north - 0) < 1 || Math.abs(north - 360) < 1);
  const east = bearingDeg([2, 48], [2.001, 48]);
  assert.ok(Math.abs(east - 90) < 1);
  const d = destinationPoint([2, 48], 90, 100);
  assert.ok(Math.abs(distMeters([2, 48], d) - 100) < 1);
});

test('isWayAllowed filtre selon l’icône', () => {
  assert.equal(isWayAllowed('car', 'residential'), true);
  assert.equal(isWayAllowed('car', 'footway'), false);
  assert.equal(isWayAllowed('person', 'footway'), true);
  assert.equal(isWayAllowed('house', 'path'), true);
  assert.equal(isWayAllowed('person', undefined), false);
});

test('carrefour en X : 4 axes triés par azimut avec couleurs de la palette', () => {
  const { axes, walked } = computeAxesFromWays(CROSS, [2, 48.00001], 'car');
  assert.equal(axes.length, 4);
  const bearings = axes.map((a) => a.bearing);
  const expected = [0, 90, 180, 270];
  bearings.forEach((b, i) => {
    const diff = Math.min(Math.abs(b - expected[i]), 360 - Math.abs(b - expected[i]));
    assert.ok(diff < 5, `azimut ${b} attendu ~${expected[i]}`);
  });
  assert.deepEqual(axes.map((a) => a.color), AXIS_PALETTE.slice(0, 4));
  assert.ok(walked.every((w) => w.endType === 'deadend'));
  axes.forEach((a) => {
    assert.deepEqual(a.geometry.coordinates[0], [2, 48]);
    assert.equal(a.name, null);
  });
});

test('milieu de segment : 2 axes, l’un s’arrête à l’intersection', () => {
  const { axes, walked } = computeAxesFromWays(CROSS, [2.0005, 48.00003], 'car');
  assert.equal(axes.length, 2);
  const atIntersection = walked.find((w) => w.endType === 'intersection');
  const atDeadend = walked.find((w) => w.endType === 'deadend');
  assert.ok(atIntersection && atDeadend);
  assert.deepEqual(atIntersection.coords[atIntersection.coords.length - 1], [2, 48]);
  assert.deepEqual(atDeadend.coords[atDeadend.coords.length - 1], [2.001, 48]);
});

test('jonction en T : la branche vers la traversante s’arrête au nœud partagé', () => {
  const T: OverpassWay[] = [
    way(1, [1, 100, 2], [[1.999, 48], [2, 48], [2.001, 48]]),
    way(2, [100, 3], [[2, 48], [2, 47.999]]),
  ];
  const { walked } = computeAxesFromWays(T, [2, 47.9995], 'car');
  assert.equal(walked.length, 2);
  const north = walked.find((w) => w.endType === 'intersection');
  assert.ok(north);
  assert.deepEqual(north.coords[north.coords.length - 1], [2, 48]);
});

test('continuité de way scindée : l’axe traverse le nœud de degré 2', () => {
  const SPLIT: OverpassWay[] = [
    way(1, [1, 2], [[2, 48], [2.001, 48]]),
    way(2, [2, 3], [[2.001, 48], [2.002, 48]], { highway: 'residential', ref: 'D45' }),
  ];
  const { walked } = computeAxesFromWays(SPLIT, [2.0003, 48], 'car');
  const east = walked.find((w) => w.coords[w.coords.length - 1][0] > 2.0015);
  assert.ok(east, 'l’axe est doit continuer sur la seconde way');
  assert.deepEqual(east.coords[east.coords.length - 1], [2.002, 48]);
  assert.equal(east.endType, 'deadend');
});

test('garde-fou : un axe est coupé vers 1500 m', () => {
  const nodes: number[] = [];
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    nodes.push(1000 + i);
    pts.push([2 + i * 0.0007, 48]);
  }
  const LONG = [way(1, nodes, pts)];
  const { walked } = computeAxesFromWays(LONG, [2.00001, 48], 'car');
  const capped = walked.find((w) => w.endType === 'cap');
  assert.ok(capped, 'un axe doit être plafonné');
  assert.ok(capped.lengthMeters <= 1600 && capped.lengthMeters >= 1400, `longueur ${capped.lengthMeters}`);
});

test('rond-point : l’axe s’arrête à l’entrée du rond-point', () => {
  const RB: OverpassWay[] = [
    way(1, [1, 10], [[2, 48], [2.001, 48]]),
    way(2, [10, 11, 12, 13, 10], [[2.001, 48], [2.0012, 48.0002], [2.0014, 48], [2.0012, 47.9998], [2.001, 48]], {
      highway: 'residential',
      junction: 'roundabout',
    }),
  ];
  const { walked } = computeAxesFromWays(RB, [2.0004, 48], 'car');
  const east = walked.find((w) => w.endType === 'intersection');
  assert.ok(east);
  assert.deepEqual(east.coords[east.coords.length - 1], [2.001, 48]);
});

test('filtrage par icône sur un croisement route/sentier', () => {
  const MIX: OverpassWay[] = [
    way(1, [1, 100, 2], [[1.999, 48], [2, 48], [2.001, 48]]),
    way(2, [3, 100, 4], [[2, 47.999], [2, 48], [2, 48.001]], { highway: 'footway' }),
  ];
  assert.equal(computeAxesFromWays(MIX, [2, 48.00001], 'car').axes.length, 2);
  assert.equal(computeAxesFromWays(MIX, [2, 48.00001], 'person').axes.length, 4);
});

test('aucune route : résultat vide', () => {
  assert.equal(computeAxesFromWays([], [2, 48], 'car').axes.length, 0);
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module './baptismAxes.js'`

- [ ] **Step 3: Implémenter la lib**

Créer `frontend/src/lib/baptismAxes.ts` :

```ts
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
  name: null;
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

function pointAlong(coords: [number, number][], meters: number): [number, number] {
  let acc = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distMeters(coords[i], coords[i + 1]);
    if (acc + d >= meters && d > 0) {
      const t = (meters - acc) / d;
      return [
        coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
        coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
      ];
    }
    acc += d;
  }
  return coords[coords.length - 1];
}

export function computeAxesFromWays(
  ways: OverpassWay[],
  point: [number, number],
  icon: BaptismIcon
): { axes: BaptismAxisResult[]; walked: WalkedAxis[] } {
  const g = buildGraph(ways, icon);
  if (g.ways.size === 0) return { axes: [], walked: [] };
  const snap = snapToRoads(g, point);
  if (!snap) return { axes: [], walked: [] };

  const starts: WalkStart[] = [];
  const w = g.ways.get(snap.wayId)!;

  const vertexCandidates: { idx: number }[] = [{ idx: snap.segIdx }, { idx: snap.segIdx + 1 }];
  let intersectionVertex: number | null = null;
  for (const { idx } of vertexCandidates) {
    const c = wayCoord(w, idx);
    if (distMeters(snap.point, c) <= VERTEX_SNAP_EPS_METERS && (g.degree.get(w.nodes[idx]) ?? 0) >= 3) {
      intersectionVertex = idx;
      break;
    }
  }

  if (intersectionVertex !== null) {
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

  const axes: BaptismAxisResult[] = withBearing.map((x, i) => ({
    axisId: `a${i}`,
    color: AXIS_PALETTE[i % AXIS_PALETTE.length],
    name: null,
    suggestions: [],
    geometry: { type: 'LineString', coordinates: x.wa.coords },
    bearing: Math.round(x.bearing * 10) / 10 % 360,
  }));

  return { axes, walked: withBearing.map((x) => x.wa) };
}

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

export async function fetchOverpass(query: string): Promise<any> {
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      // essayer le miroir suivant
    }
  }
  throw new Error('OVERPASS_UNAVAILABLE');
}

export async function computeBaptismAxes(
  point: { lng: number; lat: number },
  icon: BaptismIcon
): Promise<{ axes: BaptismAxisResult[]; walked: WalkedAxis[] }> {
  for (const radius of [250, 500]) {
    const q = `[out:json][timeout:25];way(around:${radius},${point.lat},${point.lng})[highway];out geom;`;
    const json = await fetchOverpass(q);
    const result = computeAxesFromWays((json?.elements ?? []) as OverpassWay[], [point.lng, point.lat], icon);
    if (result.axes.length > 0) return result;
  }
  throw new Error('NO_ROAD_NEARBY');
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd frontend && npm test`
Expected: PASS (tous les tests, y compris les existants)

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: succès

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/baptismAxes.ts frontend/src/lib/baptismAxes.test.ts
git commit -m "Ajoute le calcul des axes de baptême (graphe Overpass)"
```

---

### Task 4: Hook useBaptism (état, socket, actions)

**Files:**
- Create: `frontend/src/hooks/useBaptism.ts`

**Interfaces:**
- Consumes: `getBaptism`, `putBaptism`, `patchBaptism`, `deleteBaptism`, `ApiBaptism` (Task 2) ; `computeBaptismAxes`, `BaptismIcon` (Task 3) ; `getSocket` (`../lib/socket`).
- Produces (utilisé par Task 5) :

```ts
export type BaptismDraftState = { icon: BaptismIcon; point: { lng: number; lat: number } | null };
export type UseBaptismResult = {
  baptism: ApiBaptism | null;
  draft: BaptismDraftState | null;
  computing: boolean;
  computeError: string | null;
  startPlacing: (icon: BaptismIcon) => void;
  placeAt: (lng: number, lat: number) => void;
  cancelDraft: () => void;
  confirmDraft: () => Promise<boolean>;
  renameAxis: (axisId: string, name: string | null) => Promise<void>;
  recolorAxis: (axisId: string, color: string) => Promise<void>;
  removeAxis: (axisId: string) => Promise<void>;
  setDisplayMode: (mode: 'colors' | 'tion' | 'both') => Promise<void>;
  removeBaptism: () => Promise<void>;
};
```

- [ ] **Step 1: Implémenter le hook**

Créer `frontend/src/hooks/useBaptism.ts` :

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getBaptism,
  putBaptism,
  patchBaptism,
  deleteBaptism,
  type ApiBaptism,
} from '../lib/api';
import { computeBaptismAxes, type BaptismIcon } from '../lib/baptismAxes';
import { getSocket } from '../lib/socket';

export type BaptismDraftState = { icon: BaptismIcon; point: { lng: number; lat: number } | null };

export type UseBaptismResult = {
  baptism: ApiBaptism | null;
  draft: BaptismDraftState | null;
  computing: boolean;
  computeError: string | null;
  startPlacing: (icon: BaptismIcon) => void;
  placeAt: (lng: number, lat: number) => void;
  cancelDraft: () => void;
  confirmDraft: () => Promise<boolean>;
  renameAxis: (axisId: string, name: string | null) => Promise<void>;
  recolorAxis: (axisId: string, color: string) => Promise<void>;
  removeAxis: (axisId: string) => Promise<void>;
  setDisplayMode: (mode: 'colors' | 'tion' | 'both') => Promise<void>;
  removeBaptism: () => Promise<void>;
};

export function useBaptism({ selectedMissionId }: { selectedMissionId: string | null }): UseBaptismResult {
  const [baptism, setBaptism] = useState<ApiBaptism | null>(null);
  const [draft, setDraft] = useState<BaptismDraftState | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const missionRef = useRef(selectedMissionId);
  missionRef.current = selectedMissionId;

  useEffect(() => {
    setBaptism(null);
    setDraft(null);
    setComputeError(null);
    if (!selectedMissionId) return;
    let cancelled = false;
    getBaptism(selectedMissionId)
      .then((b) => {
        if (!cancelled) setBaptism(b);
      })
      .catch(() => {
        /* non bloquant : la carte reste utilisable sans baptême */
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMissionId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onUpdated = (payload: { missionId: string; baptism: ApiBaptism }) => {
      if (payload?.missionId === missionRef.current) setBaptism(payload.baptism);
    };
    const onDeleted = (payload: { missionId: string }) => {
      if (payload?.missionId === missionRef.current) setBaptism(null);
    };
    socket.on('baptism:updated', onUpdated);
    socket.on('baptism:deleted', onDeleted);
    return () => {
      socket.off('baptism:updated', onUpdated);
      socket.off('baptism:deleted', onDeleted);
    };
  }, []);

  const startPlacing = useCallback((icon: BaptismIcon) => {
    setDraft({ icon, point: null });
    setComputeError(null);
  }, []);

  const placeAt = useCallback((lng: number, lat: number) => {
    setDraft((d) => (d ? { ...d, point: { lng, lat } } : d));
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setComputeError(null);
  }, []);

  const confirmDraft = useCallback(async (): Promise<boolean> => {
    const missionId = missionRef.current;
    const d = draft;
    if (!missionId || !d?.point) return false;
    setComputing(true);
    setComputeError(null);
    try {
      const { axes } = await computeBaptismAxes(d.point, d.icon);
      const saved = await putBaptism(missionId, {
        icon: d.icon,
        point: d.point,
        displayMode: baptism?.displayMode ?? 'colors',
        axes,
      });
      setBaptism(saved);
      setDraft(null);
      return true;
    } catch (e: any) {
      setComputeError(e?.message === 'NO_ROAD_NEARBY' ? 'NO_ROAD_NEARBY' : 'OVERPASS_UNAVAILABLE');
      return false;
    } finally {
      setComputing(false);
    }
  }, [draft, baptism?.displayMode]);

  const patch = useCallback(async (input: Parameters<typeof patchBaptism>[1]) => {
    const missionId = missionRef.current;
    if (!missionId) return;
    const updated = await patchBaptism(missionId, input);
    setBaptism(updated);
  }, []);

  const renameAxis = useCallback((axisId: string, name: string | null) => patch({ axisId, name }), [patch]);
  const recolorAxis = useCallback((axisId: string, color: string) => patch({ axisId, color }), [patch]);
  const removeAxis = useCallback((axisId: string) => patch({ axisId, remove: true }), [patch]);
  const setDisplayMode = useCallback((mode: 'colors' | 'tion' | 'both') => patch({ displayMode: mode }), [patch]);

  const removeBaptism = useCallback(async () => {
    const missionId = missionRef.current;
    if (!missionId) return;
    await deleteBaptism(missionId);
    setBaptism(null);
  }, []);

  return {
    baptism,
    draft,
    computing,
    computeError,
    startPlacing,
    placeAt,
    cancelDraft,
    confirmDraft,
    renameAxis,
    recolorAxis,
    removeAxis,
    setDisplayMode,
    removeBaptism,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: succès (le hook n'est pas encore branché — normal qu'il soit inutilisé)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useBaptism.ts
git commit -m "Ajoute le hook useBaptism (état, socket, actions)"
```

---

### Task 5: Rendu carte, toolbar et panneau d'édition

**Files:**
- Modify: `frontend/src/hooks/useMapDraft.ts` (étendre `DraftTool` avec `'baptism'`)
- Modify: `frontend/src/components/MapRightToolbar.tsx` (bouton + sous-menu icône)
- Modify: `frontend/src/components/MapLibreMap.tsx` (sources/couches, effet de sync, clics, marqueur, barre de validation, panneau d'édition)

**Interfaces:**
- Consumes: `useBaptism` (Task 4), `AXIS_PALETTE`, `destinationPoint`, `BaptismIcon` (Task 3), `ApiBaptism` (Task 2).
- Produces: UI finale phase 1. IDs de sources/couches MapLibre : sources `baptism-axes`, `baptism-tion` ; couches `baptism-chevrons`, `baptism-tion-casing`, `baptism-tion-arrow`, `baptism-tion-head`, `baptism-tion-label`.
- Note spec : la spec dit « tap long sur l'icône → supprimer le baptême ». Implémentation retenue : **tap simple sur l'icône ouvre le panneau baptême** (mode d'affichage + suppression) — plus fiable sur mobile que le tap long. Écart mineur assumé, à mentionner au review.

- [ ] **Step 1: Étendre DraftTool**

Dans `frontend/src/hooks/useMapDraft.ts` ligne 15 :

```ts
export type DraftTool = 'none' | 'poi' | 'zone_circle' | 'zone_polygon' | 'baptism';
```

Run: `cd frontend && npm run typecheck` — corriger toute exhaustivité de switch qui casse (ajouter le cas `'baptism'` comme no-op là où le compilateur le demande).

- [ ] **Step 2: Bouton toolbar + sous-menu icône**

Dans `frontend/src/components/MapRightToolbar.tsx` :

1. Ajouter aux imports lucide : `Signpost`, `User`, `Car`, `Home`.
2. Ajouter aux props :

```ts
  baptismMenuOpen: boolean;
  setBaptismMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  onStartBaptism: (icon: 'person' | 'car' | 'house') => void;
```

3. À côté du bouton zone existant (même conteneur, mêmes classes de bouton — copier les classes exactes du bouton zone voisin), ajouter :

```tsx
{canEditMap && (
  <div className="relative">
    <button
      type="button"
      title="Baptême terrain"
      onClick={() => setBaptismMenuOpen((v) => !v)}
      className={/* mêmes classes que le bouton zone voisin, état actif si activeTool === 'baptism' */}
    >
      <Signpost className="h-5 w-5" />
    </button>
    {baptismMenuOpen && (
      <div className="absolute right-full top-0 mr-2 flex flex-col gap-1 rounded-lg bg-white p-1 shadow-lg">
        <button type="button" title="Personne" onClick={() => { onStartBaptism('person'); setBaptismMenuOpen(false); }} className="rounded p-2 hover:bg-gray-100">
          <User className="h-5 w-5" />
        </button>
        <button type="button" title="Voiture" onClick={() => { onStartBaptism('car'); setBaptismMenuOpen(false); }} className="rounded p-2 hover:bg-gray-100">
          <Car className="h-5 w-5" />
        </button>
        <button type="button" title="Domicile" onClick={() => { onStartBaptism('house'); setBaptismMenuOpen(false); }} className="rounded p-2 hover:bg-gray-100">
          <Home className="h-5 w-5" />
        </button>
      </div>
    )}
  </div>
)}
```

Adapter les classes au style réel des boutons voisins (les copier textuellement depuis le fichier).

- [ ] **Step 3: Brancher le hook et les sources/couches dans MapLibreMap**

Dans `frontend/src/components/MapLibreMap.tsx` :

1. Imports : `useBaptism` , `destinationPoint`, `AXIS_PALETTE`, `type BaptismIcon`.
2. Instancier le hook près des autres états (~ligne 308) : `const baptismApi = useBaptism({ selectedMissionId });` + `const [editingAxisId, setEditingAxisId] = useState<string | null>(null);` + `const [baptismMenuOpen, setBaptismMenuOpen] = useState(false);` + `const [baptismPanelOpen, setBaptismPanelOpen] = useState(false);`
3. Dans le bloc d'initialisation des sources/couches où sont créées les sources zones (~ligne 2337), ajouter :

```ts
map.addSource('baptism-axes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
map.addSource('baptism-tion', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

map.addLayer({
  id: 'baptism-chevrons',
  type: 'symbol',
  source: 'baptism-axes',
  layout: {
    'symbol-placement': 'line',
    'symbol-spacing': 45,
    'text-field': '>',
    'text-size': 22,
    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
    'text-keep-upright': false,
    'text-allow-overlap': true,
    'text-ignore-placement': true,
    'text-rotation-alignment': 'map',
  },
  paint: {
    'text-color': ['get', 'color'],
    'text-halo-color': '#1f2937',
    'text-halo-width': 1.5,
  },
});

map.addLayer({
  id: 'baptism-tion-casing',
  type: 'line',
  source: 'baptism-tion',
  filter: ['==', ['geometry-type'], 'LineString'],
  paint: { 'line-color': '#ffffff', 'line-width': 6 },
});
map.addLayer({
  id: 'baptism-tion-arrow',
  type: 'line',
  source: 'baptism-tion',
  filter: ['==', ['geometry-type'], 'LineString'],
  paint: { 'line-color': '#111827', 'line-width': 3 },
});
map.addLayer({
  id: 'baptism-tion-head',
  type: 'symbol',
  source: 'baptism-tion',
  filter: ['==', ['geometry-type'], 'Point'],
  layout: {
    'text-field': '>',
    'text-size': 24,
    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
    'text-rotate': ['get', 'rotation'],
    'text-rotation-alignment': 'map',
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  },
  paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
});
map.addLayer({
  id: 'baptism-tion-label',
  type: 'symbol',
  source: 'baptism-tion',
  filter: ['==', ['geometry-type'], 'Point'],
  layout: {
    'text-field': ['get', 'label'],
    'text-size': 13,
    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
    'text-offset': [0, 1.2],
    'text-anchor': 'top',
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  },
  paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
});
```

ATTENTION : ce bloc d'init est ré-exécuté quand le style de carte change (bouton satellite). Suivre le même mécanisme que les sources zones pour la re-création (si les zones utilisent un helper de ré-ajout après `setStyle`, y inclure les sources/couches baptism).

- [ ] **Step 4: Effet de synchronisation des données**

Ajouter dans MapLibreMap (près des effets qui synchronisent les zones vers leurs sources) :

```ts
useEffect(() => {
  const map = mapRef.current; // utiliser la ref carte réelle du fichier
  if (!map || !mapReady) return; // utiliser le flag "style chargé" existant du fichier
  const b = baptismApi.baptism;
  const showChevrons = !!b && (b.displayMode === 'colors' || b.displayMode === 'both');
  const showTion = !!b && (b.displayMode === 'tion' || b.displayMode === 'both');

  const axesSrc = map.getSource('baptism-axes') as maplibregl.GeoJSONSource | undefined;
  const tionSrc = map.getSource('baptism-tion') as maplibregl.GeoJSONSource | undefined;
  if (!axesSrc || !tionSrc) return;

  axesSrc.setData({
    type: 'FeatureCollection',
    features: showChevrons
      ? b!.axes.map((a) => ({
          type: 'Feature' as const,
          properties: { axisId: a.axisId, color: a.color },
          geometry: a.geometry,
        }))
      : [],
  });

  const tionFeatures: GeoJSON.Feature[] = [];
  if (showTion && b) {
    for (const a of b.axes) {
      const origin: [number, number] = [b.point.lng, b.point.lat];
      const tip = destinationPoint(origin, a.bearing, 120);
      tionFeatures.push({
        type: 'Feature',
        properties: { axisId: a.axisId },
        geometry: { type: 'LineString', coordinates: [origin, tip] },
      });
      tionFeatures.push({
        type: 'Feature',
        properties: {
          axisId: a.axisId,
          rotation: (a.bearing - 90 + 360) % 360,
          label: a.name ? `TION ${a.name}` : 'TION ?',
        },
        geometry: { type: 'Point', coordinates: tip },
      });
    }
  }
  tionSrc.setData({ type: 'FeatureCollection', features: tionFeatures });
}, [baptismApi.baptism, mapReady]);
```

Adapter `mapRef`/`mapReady` aux noms réels utilisés dans le fichier pour les effets zones (les copier).

- [ ] **Step 5: Marqueur du point (icône) + marqueur de brouillon**

Toujours dans MapLibreMap, un effet qui gère deux `maplibregl.Marker` (refs `baptismMarkerRef`, `baptismDraftMarkerRef`) :

```ts
const BAPTISM_EMOJI: Record<BaptismIcon, string> = { person: '🚶', car: '🚗', house: '🏠' };

function makeBaptismEl(icon: BaptismIcon, dashed: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = BAPTISM_EMOJI[icon];
  el.style.cssText = `font-size:20px;line-height:1;background:#fff;border-radius:9999px;padding:6px;border:2px ${dashed ? 'dashed #6b7280' : 'solid #111827'};box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer;`;
  return el;
}

useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady) return;
  baptismMarkerRef.current?.remove();
  baptismMarkerRef.current = null;
  const b = baptismApi.baptism;
  if (b) {
    const el = makeBaptismEl(b.icon, false);
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      setBaptismPanelOpen(true);
      setEditingAxisId(null);
    });
    baptismMarkerRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([b.point.lng, b.point.lat])
      .addTo(map);
  }
  return () => {
    baptismMarkerRef.current?.remove();
    baptismMarkerRef.current = null;
  };
}, [baptismApi.baptism, mapReady]);

useEffect(() => {
  const map = mapRef.current;
  if (!map || !mapReady) return;
  baptismDraftMarkerRef.current?.remove();
  baptismDraftMarkerRef.current = null;
  const d = baptismApi.draft;
  if (d?.point) {
    const marker = new maplibregl.Marker({ element: makeBaptismEl(d.icon, true), draggable: true })
      .setLngLat([d.point.lng, d.point.lat])
      .addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLngLat();
      baptismApi.placeAt(p.lng, p.lat);
    });
    baptismDraftMarkerRef.current = marker;
  }
  return () => {
    baptismDraftMarkerRef.current?.remove();
    baptismDraftMarkerRef.current = null;
  };
}, [baptismApi.draft, mapReady]);
```

- [ ] **Step 6: Routage des clics carte**

1. Démarrage : `onStartBaptism` (passé à la toolbar) fait `baptismApi.startPlacing(icon); setActiveTool('baptism');`.
2. Dans le handler de clic carte existant qui route selon `activeToolRef.current` (celui de useMapDraft), ajouter en tête : si `activeToolRef.current === 'baptism'` → `baptismApi.placeAt(e.lngLat.lng, e.lngLat.lat)` et return (le clic ne doit PAS créer de POI/zone ni ouvrir de popup).
3. Dans `onZoneClick` (~ligne 2841), avant le `queryRenderedFeatures` zones, ajouter :

```ts
const baptismHits = map.queryRenderedFeatures(e.point, {
  layers: ['baptism-chevrons', 'baptism-tion-label', 'baptism-tion-arrow'].filter((l) => !!map.getLayer(l)),
});
if (baptismHits.length > 0) {
  const axisId = baptismHits[0].properties?.axisId as string | undefined;
  if (axisId) {
    setEditingAxisId(axisId);
    setBaptismPanelOpen(false);
    return;
  }
}
```

4. Annulation : le mécanisme `cancelDraft` existant de la toolbar doit aussi faire `baptismApi.cancelDraft()` quand `activeTool === 'baptism'`, puis `setActiveTool('none')`.

- [ ] **Step 7: Barre de validation du brouillon + panneau d'édition (JSX)**

Dans le JSX de MapLibreMap (à côté des overlays existants) :

```tsx
{baptismApi.draft?.point && (
  <div className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-xl bg-white p-3 shadow-xl">
    {baptismApi.computeError ? (
      <div className="flex items-center gap-2">
        <span className="text-sm text-red-600">
          {baptismApi.computeError === 'NO_ROAD_NEARBY'
            ? 'Aucune route trouvée à proximité (500 m).'
            : 'Overpass indisponible. Vérifie ta connexion.'}
        </span>
        <button type="button" className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white" onClick={() => void baptismApi.confirmDraft()}>
          Réessayer
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700">Placer le point puis valider</span>
        <button
          type="button"
          className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm"
          onClick={() => {
            baptismApi.cancelDraft();
            setActiveTool('none');
          }}
        >
          Annuler
        </button>
        <button
          type="button"
          disabled={baptismApi.computing}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          onClick={() => {
            void baptismApi.confirmDraft().then((ok) => {
              if (ok) setActiveTool('none');
            });
          }}
        >
          {baptismApi.computing ? 'Calcul…' : 'Valider'}
        </button>
      </div>
    )}
  </div>
)}

{editingAxisId && baptismApi.baptism && (() => {
  const axis = baptismApi.baptism.axes.find((a) => a.axisId === editingAxisId);
  if (!axis) return null;
  return (
    <div className="absolute right-3 top-16 z-20 w-64 rounded-xl bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Axe {axis.name ? `TION ${axis.name}` : ''}</span>
        <button type="button" onClick={() => setEditingAxisId(null)} className="text-gray-500">✕</button>
      </div>
      <input
        type="text"
        defaultValue={axis.name ?? ''}
        placeholder="Nom (ex. AUCHAN)"
        className="mb-2 w-full rounded-lg border px-2 py-1.5 text-sm uppercase"
        onBlur={(e) => {
          const v = e.target.value.trim();
          void baptismApi.renameAxis(axis.axisId, v ? v : null);
        }}
      />
      <div className="mb-2 flex flex-wrap gap-1">
        {AXIS_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className="h-6 w-6 rounded-full border-2"
            style={{ backgroundColor: c, borderColor: c === axis.color ? '#111827' : 'transparent' }}
            onClick={() => void baptismApi.recolorAxis(axis.axisId, c)}
          />
        ))}
      </div>
      <button
        type="button"
        className="w-full rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600"
        onClick={() => {
          void baptismApi.removeAxis(axis.axisId);
          setEditingAxisId(null);
        }}
      >
        Supprimer cet axe
      </button>
    </div>
  );
})()}

{baptismPanelOpen && baptismApi.baptism && (
  <div className="absolute right-3 top-16 z-20 w-64 rounded-xl bg-white p-3 shadow-xl">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-sm font-semibold">Baptême terrain</span>
      <button type="button" onClick={() => setBaptismPanelOpen(false)} className="text-gray-500">✕</button>
    </div>
    <div className="mb-2 grid grid-cols-3 gap-1">
      {(['colors', 'tion', 'both'] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={`rounded-lg px-2 py-1.5 text-xs ${baptismApi.baptism!.displayMode === m ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}
          onClick={() => void baptismApi.setDisplayMode(m)}
        >
          {m === 'colors' ? 'Couleurs' : m === 'tion' ? 'TION' : 'Les deux'}
        </button>
      ))}
    </div>
    <button
      type="button"
      className="w-full rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600"
      onClick={() => {
        void baptismApi.removeBaptism();
        setBaptismPanelOpen(false);
      }}
    >
      Supprimer le baptême
    </button>
  </div>
)}
```

Passer les nouvelles props à `<MapRightToolbar … baptismMenuOpen={baptismMenuOpen} setBaptismMenuOpen={setBaptismMenuOpen} onStartBaptism={(icon) => { baptismApi.startPlacing(icon); setActiveTool('baptism'); }} />`.

Si un placement de baptême existe déjà (`baptismApi.baptism !== null`) au moment de `onStartBaptism`, afficher le `ConfirmDialog` existant (« Remplacer le baptême actuel ? ») avant `startPlacing`.

- [ ] **Step 8: Typecheck + tests**

Run: `cd frontend && npm run typecheck && npm test`
Expected: succès

- [ ] **Step 9: Commit**

```bash
git add frontend/src/hooks/useMapDraft.ts frontend/src/components/MapRightToolbar.tsx frontend/src/components/MapLibreMap.tsx
git commit -m "Ajoute l'UI baptême terrain : toolbar, rendu carte, édition d'axe"
```

---

### Task 6: Phase 2 — suggestion automatique des noms TION

**Files:**
- Create: `frontend/src/lib/baptismNaming.ts`
- Create: `frontend/src/lib/baptismNaming.test.ts`
- Modify: `frontend/src/lib/baptismAxes.ts` (intégrer le nommage dans `computeBaptismAxes`)
- Modify: `frontend/src/components/MapLibreMap.tsx` (chips de suggestions dans le panneau d'axe)

**Interfaces:**
- Consumes: `fetchOverpass`, `bearingDeg`, `distMeters`, `WalkedAxis` (Task 3).
- Produces:
  - `type NamedCandidate = { name: string; point: [number, number]; tier: 1 | 2 | 3 }`
  - `angleDiffDeg(a, b): number`
  - `cardinalName(bearing): string` (8 secteurs : `NORD`, `NORD-EST`, …)
  - `parseOverpassPois(json): NamedCandidate[]`
  - `buildPoiQuery(lat, lng, radius?): string`
  - `rankAxisSuggestions(axisBearing, origin, candidates, coneDeg?): string[]` (max 3, MAJUSCULES)
  - `fallbackAxisName(firstWayTags, bearing): string`
  - `computeBaptismAxes` retourne désormais des axes avec `suggestions` remplies et `name` pré-rempli (jamais null en sortie de calcul).

- [ ] **Step 1: Écrire les tests (qui échouent)**

Créer `frontend/src/lib/baptismNaming.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angleDiffDeg,
  cardinalName,
  parseOverpassPois,
  rankAxisSuggestions,
  fallbackAxisName,
  type NamedCandidate,
} from './baptismNaming.js';

test('angleDiffDeg gère le passage par le nord', () => {
  assert.equal(angleDiffDeg(350, 10), 20);
  assert.equal(angleDiffDeg(10, 350), 20);
  assert.equal(angleDiffDeg(90, 90), 0);
  assert.equal(angleDiffDeg(0, 180), 180);
});

test('cardinalName découpe en 8 secteurs', () => {
  assert.equal(cardinalName(0), 'NORD');
  assert.equal(cardinalName(45), 'NORD-EST');
  assert.equal(cardinalName(90), 'EST');
  assert.equal(cardinalName(180), 'SUD');
  assert.equal(cardinalName(270), 'OUEST');
  assert.equal(cardinalName(337.6), 'NORD');
  assert.equal(cardinalName(292.5), 'NORD-OUEST');
});

test('rankAxisSuggestions filtre par cône ±35° et classe par niveau', () => {
  const origin: [number, number] = [2, 48];
  const candidates: NamedCandidate[] = [
    { name: 'Auchan', point: [2.005, 48.0001], tier: 1 },
    { name: 'Mairie', point: [2.004, 48.0002], tier: 2 },
    { name: 'Verneuil', point: [2.01, 48.0003], tier: 3 },
    { name: 'Hors cône', point: [2, 48.01], tier: 1 },
  ];
  const suggestions = rankAxisSuggestions(90, origin, candidates);
  assert.deepEqual(suggestions, ['AUCHAN', 'MAIRIE', 'VERNEUIL']);
});

test('rankAxisSuggestions préfère le plus proche dans un même niveau', () => {
  const origin: [number, number] = [2, 48];
  const candidates: NamedCandidate[] = [
    { name: 'Carrefour', point: [2.02, 48], tier: 1 },
    { name: 'Auchan', point: [2.005, 48], tier: 1 },
  ];
  assert.deepEqual(rankAxisSuggestions(90, origin, candidates), ['AUCHAN', 'CARREFOUR']);
});

test('parseOverpassPois classe par tags et lit le center des ways', () => {
  const json = {
    elements: [
      { type: 'node', id: 1, lat: 48.001, lon: 2.001, tags: { name: 'Auchan', shop: 'supermarket' } },
      { type: 'node', id: 2, lat: 48.002, lon: 2.002, tags: { name: 'Total', amenity: 'fuel' } },
      { type: 'way', id: 3, center: { lat: 48.003, lon: 2.003 }, tags: { name: 'Mairie', amenity: 'townhall' } },
      { type: 'node', id: 4, lat: 48.004, lon: 2.004, tags: { name: 'Verneuil', place: 'village' } },
      { type: 'node', id: 5, lat: 48.005, lon: 2.005, tags: { shop: 'bakery' } },
    ],
  };
  const c = parseOverpassPois(json);
  assert.equal(c.length, 4);
  assert.deepEqual(c.find((x) => x.name === 'Auchan')?.tier, 1);
  assert.deepEqual(c.find((x) => x.name === 'Total')?.tier, 1);
  assert.deepEqual(c.find((x) => x.name === 'Mairie')?.tier, 2);
  assert.deepEqual(c.find((x) => x.name === 'Verneuil')?.tier, 3);
  assert.deepEqual(c.find((x) => x.name === 'Mairie')?.point, [2.003, 48.003]);
});

test('fallbackAxisName : ref, puis name, puis cardinal', () => {
  assert.equal(fallbackAxisName({ ref: 'D45', name: 'Rue des Lilas' }, 45), 'D45');
  assert.equal(fallbackAxisName({ name: 'Rue des Lilas' }, 45), 'RUE DES LILAS');
  assert.equal(fallbackAxisName({}, 45), 'NORD-EST');
});
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module './baptismNaming.js'`

- [ ] **Step 3: Implémenter la lib de nommage**

Créer `frontend/src/lib/baptismNaming.ts` :

```ts
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
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cd frontend && npm test`
Expected: PASS

- [ ] **Step 5: Intégrer le nommage dans computeBaptismAxes**

Dans `frontend/src/lib/baptismAxes.ts`, modifier `computeBaptismAxes` (le nommage est non bloquant : s'il échoue, les axes sortent avec le repli) :

```ts
import { buildPoiQuery, parseOverpassPois, rankAxisSuggestions, fallbackAxisName } from './baptismNaming';

export async function computeBaptismAxes(
  point: { lng: number; lat: number },
  icon: BaptismIcon
): Promise<{ axes: BaptismAxisResult[]; walked: WalkedAxis[] }> {
  for (const radius of [250, 500]) {
    const q = `[out:json][timeout:25];way(around:${radius},${point.lat},${point.lng})[highway];out geom;`;
    const json = await fetchOverpass(q);
    const result = computeAxesFromWays((json?.elements ?? []) as OverpassWay[], [point.lng, point.lat], icon);
    if (result.axes.length === 0) continue;

    let candidates: ReturnType<typeof parseOverpassPois> = [];
    try {
      const poisJson = await fetchOverpass(buildPoiQuery(point.lat, point.lng));
      candidates = parseOverpassPois(poisJson);
    } catch {
      // non bloquant : on retombe sur le repli (ref/nom de route, cardinal)
    }
    const origin: [number, number] = [point.lng, point.lat];
    const named = result.axes.map((a, i) => {
      const suggestions = rankAxisSuggestions(a.bearing, origin, candidates);
      const fallback = fallbackAxisName(result.walked[i]?.firstWayTags ?? {}, a.bearing);
      const all = [...suggestions];
      if (!all.includes(fallback)) all.push(fallback);
      return { ...a, suggestions: all.slice(0, 5), name: all[0] ?? null };
    });
    return { axes: named, walked: result.walked };
  }
  throw new Error('NO_ROAD_NEARBY');
}
```

Ajuster le type `BaptismAxisResult.name` de `null` à `string | null` (et le test « aucune route » ne change pas ; dans les tests de `computeAxesFromWays`, `name` reste `null` car le nommage ne se fait que dans `computeBaptismAxes`).

- [ ] **Step 6: Chips de suggestions dans le panneau d'axe**

Dans le panneau d'édition d'axe de MapLibreMap (Task 5 Step 7), sous l'input nom, ajouter :

```tsx
{axis.suggestions.length > 0 && (
  <div className="mb-2 flex flex-wrap gap-1">
    {axis.suggestions.map((s) => (
      <button
        key={s}
        type="button"
        className={`rounded-full px-2 py-1 text-xs ${axis.name === s ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}
        onClick={() => void baptismApi.renameAxis(axis.axisId, s)}
      >
        TION {s}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 7: Typecheck + tests complets**

Run: `cd frontend && npm run typecheck && npm test`
Expected: succès

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/baptismNaming.ts frontend/src/lib/baptismNaming.test.ts frontend/src/lib/baptismAxes.ts frontend/src/components/MapLibreMap.tsx
git commit -m "Ajoute la suggestion automatique des noms TION (phase 2)"
```

---

### Task 7: Vérification manuelle de bout en bout

**Files:** aucun (vérification).

- [ ] **Step 1: Lancer l'application**

Backend : `cd backend && npm run dev` — Frontend : `cd frontend && npm run dev` (nécessite Mongo + `.env` conformes à l'existant).

- [ ] **Step 2: Scénario complet**

1. Se connecter, ouvrir une mission, activer le bouton Baptême → choisir Voiture.
2. Taper la carte sur une route réelle → marqueur pointillé → Valider → les chevrons colorés apparaissent, chaque axe s'arrête au prochain carrefour.
3. Taper un axe → le panneau s'ouvre : suggestions TION présentes, renommer, changer la couleur, supprimer un axe.
4. Taper l'icône voiture → basculer displayMode sur TION (flèches + étiquettes), puis Les deux.
5. Ouvrir la mission dans un second navigateur (autre compte membre) → le baptême apparaît et suit les modifications en direct.
6. Placer un nouveau baptême → confirmation de remplacement → l'ancien disparaît partout.
7. Supprimer le baptême depuis le panneau → disparaît partout.
8. Tester le cas d'erreur : placer un point en pleine mer/champ → message « Aucune route trouvée » + Réessayer.

- [ ] **Step 3: Commit final éventuel**

Si des ajustements ont été nécessaires, les committer avec un message descriptif en français.

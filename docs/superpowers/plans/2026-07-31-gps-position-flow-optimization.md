# GPS Position Flow Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut bandwidth and CPU of the real-time GPS position flow by filtering
insignificant movement client-side, batching server broadcasts and Mongo
writes per mission tick, and adding a startup notice about the temporary free
hosting — all without changing any of the mandatory codebase patterns.

**Architecture:** Client-side: a small pure helper module gates which GPS
fixes actually get emitted (movement threshold or heartbeat), rounded to 5
decimals. Server-side: `position:update` no longer writes/broadcasts
immediately — it buffers per mission in memory, and a per-mission tick
(1.5s) flushes buffered positions as one Mongo bulk write + one
`position:batch` broadcast. `position:update` is fully replaced by
`position:batch` (no transition period — front/back are always deployed
together in this monorepo). A separate, isolated task swaps the Socket.IO
JSON parser for msgpack on both sides. A last, independent task adds a
non-dismissible startup modal warning about the free-tier host's cold start.

**Tech Stack:** Fastify 4, Socket.IO 4, Mongoose 8 (backend) — React 18,
Vite, MapLibreGL, socket.io-client 4 (frontend). No test framework exists in
this repo today (verified: no jest/vitest/mocha in either `package.json`,
no `test` script). This plan uses Node's built-in `node:test` +
`node:assert` runner via `tsx` (already a backend devDependency; added as a
frontend devDependency in Task 1) for the units that are pure logic and
cheaply testable. Wiring into Socket.IO/timers/Mongo I/O has no existing
test harness in this repo (no test DB, no socket.io test client) — those
steps are manually verified against a running dev server instead, per the
approved spec's own validation section.

## Global Constraints

- `requireAuth(req)` first in every route handler — none of these tasks add
  new HTTP routes, so this doesn't apply here, but don't break it in files
  you touch in passing.
- `.lean()` on every Mongoose read.
- Soft-delete only, never a physical delete.
- Socket emissions use optional chaining: `app.io?.to(...).emit(...)`.
- React state updates are functional: `setState(prev => ...)`, never a
  closure over stale state.
- Never add `required: true` to a Mongoose schema field without a migration
  plan. (No schema field changes required by this plan — flag it if a task
  seems to need one, don't just add it.)
- `position:bulk` (offline flush) must keep working unmodified throughout —
  every task that touches a shared file must leave its handler and payload
  shape untouched.

---

### Task 1: Shared GPS filter helpers (client-side)

**Files:**
- Create: `frontend/src/lib/gpsFilter.ts`
- Create: `frontend/src/lib/gpsFilter.test.ts`
- Modify: `frontend/package.json` (add `tsx` devDependency + `test` script)

**Interfaces:**
- Produces: `SIGNIFICANT_MOVE_METERS: number` (= 8), `HEARTBEAT_MS: number`
  (= 30_000), `haversineMeters(a: {lng:number;lat:number}, b: {lng:number;lat:number}): number`,
  `roundCoord(n: number): number`, `shouldEmitPosition(last: {lng:number;lat:number;t:number} | null, next: {lng:number;lat:number;t:number}): boolean`.
  Tasks 2 and 3 import all five names from `../lib/gpsFilter.js` (or `./gpsFilter.js` from within `lib/`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/gpsFilter.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineMeters,
  roundCoord,
  shouldEmitPosition,
} from './gpsFilter.js';

test('haversineMeters returns ~0 for identical points', () => {
  const d = haversineMeters({ lng: 2.35, lat: 48.85 }, { lng: 2.35, lat: 48.85 });
  assert.ok(d < 0.01, `expected ~0, got ${d}`);
});

test('haversineMeters returns ~111.2km for one degree of latitude', () => {
  // One degree of latitude is a constant ~111.2km regardless of longitude —
  // a safe synthetic case that doesn't depend on real-world city coordinates.
  const d = haversineMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
  assert.ok(d > 110_000 && d < 112_000, `expected ~111.2km, got ${d}`);
});

test('roundCoord rounds to 5 decimals', () => {
  assert.equal(roundCoord(48.856614123), 48.85661);
  assert.equal(roundCoord(2.352222), 2.35222);
});

test('shouldEmitPosition always emits the first point (no last position)', () => {
  assert.equal(shouldEmitPosition(null, { lng: 2.35, lat: 48.85, t: 1000 }), true);
});

test('shouldEmitPosition rejects a near-identical point sent quickly', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  // ~0.73m at this latitude, well under the 8m threshold; 500ms < 30s heartbeat.
  const next = { lng: 2.35001, lat: 48.85, t: 1500 };
  assert.equal(shouldEmitPosition(last, next), false);
});

test('shouldEmitPosition accepts a point past the significant-move threshold', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  // ~14.6m at this latitude, past the 8m threshold; 500ms < 30s heartbeat.
  const next = { lng: 2.3502, lat: 48.85, t: 1500 };
  assert.equal(shouldEmitPosition(last, next), true);
});

test('shouldEmitPosition accepts an unmoved point after the heartbeat interval', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  const next = { lng: 2.35, lat: 48.85, t: 1000 + 30_000 };
  assert.equal(shouldEmitPosition(last, next), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

First add the `test` script and `tsx` devDependency so the runner exists:

Edit `frontend/package.json`, add to `"scripts"`:
```json
"test": "tsx --test src/lib/*.test.ts"
```
Add to `"devDependencies"`:
```json
"tsx": "^4.19.2"
```
(same version already pinned in `backend/package.json`, for consistency).

Run: `cd frontend && npm install && npm test`
Expected: FAIL — `gpsFilter.ts` does not exist yet (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/gpsFilter.ts`:

```ts
export const SIGNIFICANT_MOVE_METERS = 8;
export const HEARTBEAT_MS = 30_000;

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
  if (next.t - last.t >= HEARTBEAT_MS) return true;
  return haversineMeters(last, next) >= SIGNIFICANT_MOVE_METERS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/gpsFilter.ts frontend/src/lib/gpsFilter.test.ts
git commit -m "Add shared GPS movement-filter helpers with node:test coverage"
```

---

### Task 2: Wire the filter into `useMissionGeolocation.ts`

**Files:**
- Modify: `frontend/src/hooks/useMissionGeolocation.ts`

**Interfaces:**
- Consumes: `roundCoord`, `shouldEmitPosition` from `../lib/gpsFilter.js` (Task 1).
- Produces: no new exports — same public `useMissionGeolocation(params)` signature.

This hook has two `socket.emit('position:update', ...)` call-sites: the
continuous `watchPosition` callback (~line 153-172) and the one-shot
`pushOnePositionNow` triggered on focus/visibility (~line 111-133). Both must
be gated by the same filter and share one "last sent" ref so a focus-trigger
push right after a watch-triggered push doesn't double-send.

- [ ] **Step 1: Add the shared ref and import**

In `frontend/src/hooks/useMissionGeolocation.ts`, add the import at the top:

```ts
import { roundCoord, shouldEmitPosition } from '../lib/gpsFilter.js';
```

Add a new ref alongside the existing ones (near `watchIdRef`, `pendingRef`, `persistTimeoutRef`):

```ts
const lastSentRef = useRef<{ lng: number; lat: number; t: number } | null>(null);
```

- [ ] **Step 2: Gate `pushOnePositionNow`**

Replace the body of `pushOnePositionNow`'s `getCurrentPosition` success callback
(currently building `payload` with raw `pos.coords.longitude`/`latitude` and
unconditionally emitting) with:

```ts
const pushOnePositionNow = () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const t = Date.now();
      const lng = roundCoord(pos.coords.longitude);
      const lat = roundCoord(pos.coords.latitude);
      const payload: PendingPoint = {
        lng,
        lat,
        speed: pos.coords.speed ?? undefined,
        heading: pos.coords.heading ?? undefined,
        accuracy: pos.coords.accuracy ?? undefined,
        t,
      };
      if (socket.connected) {
        if (!shouldEmitPosition(lastSentRef.current, { lng, lat, t })) return;
        lastSentRef.current = { lng, lat, t };
        socket.emit('position:update', payload);
      } else {
        pendingRef.current = [...pendingRef.current, payload].slice(-MAX_PENDING);
        persistPending();
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
  );
};
```

- [ ] **Step 3: Gate the `watchPosition` callback**

Replace the body of the `watchPosition` success callback (currently building
`payload` with raw coords and unconditionally emitting) with the same
pattern:

```ts
watchIdRef.current = navigator.geolocation.watchPosition(
  (pos) => {
    const t = Date.now();
    const lng = roundCoord(pos.coords.longitude);
    const lat = roundCoord(pos.coords.latitude);
    const payload: PendingPoint = {
      lng,
      lat,
      speed: pos.coords.speed ?? undefined,
      heading: pos.coords.heading ?? undefined,
      accuracy: pos.coords.accuracy ?? undefined,
      t,
    };
    if (socket.connected) {
      if (!shouldEmitPosition(lastSentRef.current, { lng, lat, t })) return;
      lastSentRef.current = { lng, lat, t };
      socket.emit('position:update', payload);
    } else {
      pendingRef.current = [...pendingRef.current, payload].slice(-MAX_PENDING);
      persistPending();
    }
  },
  () => {},
  { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
);
```

- [ ] **Step 4: Reset `lastSentRef` when the watcher (re)starts**

Right after the "Sécurité : on tue tout watcher orphelin précédent" cleanup
block (before `watchIdRef.current = navigator.geolocation.watchPosition(...)`),
add:

```ts
lastSentRef.current = null;
```

This guarantees the very first fix of a new watch session is always sent
(matches `shouldEmitPosition`'s "no last position → always emit" rule) rather
than silently comparing against a stale position from a previous mount.

- [ ] **Step 5: Manual verification (no automated test — needs a live GPS/browser)**

Run: `cd frontend && npm run typecheck` — must pass with no new errors.

Then run the dev server (`cd frontend && npm run dev`) and, in a browser with
geolocation enabled, watch the Network → WS tab while stationary: confirm
`position:update` frames appear roughly every 30s instead of continuously.
This full end-to-end behavior (real GPS + real socket) is covered in the
Claude Cowork verification prompt, not automated here — no test DB or
geolocation mock exists in this repo.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useMissionGeolocation.ts
git commit -m "Gate real-time position:update emission behind movement/heartbeat filter"
```

---

### Task 3: Wire the filter into `MapLibreMap.tsx`'s own GPS watcher

**Files:**
- Modify: `frontend/src/components/MapLibreMap.tsx`

**Interfaces:**
- Consumes: `haversineMeters`, `roundCoord`, `shouldEmitPosition` from
  `../lib/gpsFilter.js` (Task 1).
- Produces: no new exports.

`MapLibreMap.tsx` has its own local `haversineMeters` (line 304-315) used
elsewhere in the file (e.g. line 5041, drawing a draft circle radius) and its
own GPS watcher (line 6597-6649) that emits `position:update` independently
from the hook touched in Task 2. Both need the shared helper.

- [ ] **Step 1: Import the shared helper and delete the local duplicate**

Add near the top of `frontend/src/components/MapLibreMap.tsx` (with the
other local imports):

```ts
import { haversineMeters, roundCoord, shouldEmitPosition } from '../lib/gpsFilter.js';
```

Delete the local `function haversineMeters(...)` definition (lines 304-315).
All existing call sites (e.g. line 5041 `haversineMeters(center, edge)`) keep
working unchanged — same name, same signature, now imported instead of
locally defined.

- [ ] **Step 2: Add a "last sent" ref**

Near `watchIdRef` (used by this component's own watcher, distinct from the
hook's ref in Task 2 — these are two separate emission sites with two
separate refs, exactly as documented in the design spec), add:

```ts
const lastSentRef = useRef<{ lng: number; lat: number; t: number } | null>(null);
```

- [ ] **Step 3: Gate the watcher's emission**

In the `watchPosition` callback (line ~6597-6649), the current code computes
raw `lng`/`lat`, updates `lastPos`/`tracePoints` unconditionally, then only
gates the *socket emission* on `socket.connected`. Change the emission block
so rounding + filtering happens before emit, while `lastPos`/`tracePoints`
(used for local rendering) keep updating on every raw fix — only the
network emission is filtered:

Replace:
```ts
        const socket = socketRef.current;
        if (socket && selectedMissionId) {
          const payload = {
            lng,
            lat,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            accuracy: pos.coords.accuracy ?? undefined,
            t,
          };

          if (socket.connected) {
            wasSocketConnectedRef.current = true;
            socket.emit('position:update', payload);
          } else {
            // First offline point: persist immediately (then throttle every 2s)
            if (wasSocketConnectedRef.current) {
              wasSocketConnectedRef.current = false;
              lastPersistTsRef.current = 0;
            }

            pendingBulkRef.current = [...pendingBulkRef.current, payload].slice(-5000);
            if (user?.id) {
              persistPendingPositions(selectedMissionId, user.id);
            }
          }
        }
```

With:
```ts
        const socket = socketRef.current;
        if (socket && selectedMissionId) {
          const roundedLng = roundCoord(lng);
          const roundedLat = roundCoord(lat);
          const payload = {
            lng: roundedLng,
            lat: roundedLat,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            accuracy: pos.coords.accuracy ?? undefined,
            t,
          };

          if (socket.connected) {
            wasSocketConnectedRef.current = true;
            if (shouldEmitPosition(lastSentRef.current, { lng: roundedLng, lat: roundedLat, t })) {
              lastSentRef.current = { lng: roundedLng, lat: roundedLat, t };
              socket.emit('position:update', payload);
            }
          } else {
            // First offline point: persist immediately (then throttle every 2s)
            if (wasSocketConnectedRef.current) {
              wasSocketConnectedRef.current = false;
              lastPersistTsRef.current = 0;
            }

            pendingBulkRef.current = [...pendingBulkRef.current, payload].slice(-5000);
            if (user?.id) {
              persistPendingPositions(selectedMissionId, user.id);
            }
          }
        }
```

Note: the offline branch is intentionally left ungated (matches Task 2 and
the approved spec — the filter only applies to the real-time emit path, not
to what gets queued for `position:bulk` catch-up).

- [ ] **Step 4: Reset `lastSentRef` when the watcher (re)starts**

In the same effect, right after `watchIdRef.current !== null` cleanup and
before the new `navigator.geolocation.watchPosition(...)` call, add:

```ts
    lastSentRef.current = null;
```

- [ ] **Step 5: Manual verification**

Run: `cd frontend && npm run typecheck` — must pass with no new errors, and
confirm (by reading the diff) that the local `haversineMeters` definition
was removed, not just shadowed, and that the call at line ~5041 still
resolves to the imported one.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/MapLibreMap.tsx
git commit -m "Gate MapLibreMap's own GPS watcher behind movement/heartbeat filter, dedupe haversineMeters"
```

---

### Task 4: Startup hosting notice modal

**Files:**
- Create: `frontend/src/components/StartupNoticeModal.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces: `export default function StartupNoticeModal(props: { open: boolean; onDismiss: () => void }): JSX.Element | null`
- Consumes (from `App.tsx`): nothing from other tasks — fully independent.

This follows `ConfirmDialog.tsx`'s portal pattern (`createPortal` to
`document.body`, same visual language) but deliberately **omits** the
backdrop `onClick={onCancel}` handler that `ConfirmDialog` has — this modal
must not be dismissible by clicking outside or pressing Escape (no Escape
listener exists in `ConfirmDialog` either, so none needs to be added here).

- [ ] **Step 1: Create the modal component**

Create `frontend/src/components/StartupNoticeModal.tsx`:

```tsx
import { createPortal } from 'react-dom';

// TODO: retirer cette modale une fois le backend basculé sur les serveurs de l'unité
export default function StartupNoticeModal(props: { open: boolean; onDismiss: () => void }) {
  const { open, onDismiss } = props;
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold text-gray-900">Version limitée</div>
        <div className="mt-2 text-sm text-gray-700">
          GeoGN fonctionne actuellement sur une offre d'hébergement temporaire.
          Le premier chargement peut prendre jusqu'à une minute, le temps que
          le serveur redémarre. Cette limitation disparaîtra dès le
          basculement sur les serveurs de l'unité.
        </div>
        <div className="mt-5 flex items-center justify-end">
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
            onClick={onDismiss}
          >
            J'ai compris
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 2: Mount it at the app root, open by default**

In `frontend/src/App.tsx`, add the import at the top:

```tsx
import { useState } from 'react';
import StartupNoticeModal from './components/StartupNoticeModal';
```

(Note: `Suspense, lazy` are already imported from `'react'` in this file —
merge into the existing `import { Suspense, lazy } from 'react';` line
instead of adding a second `react` import: `import { Suspense, lazy, useState } from 'react';`.)

In the `App` function, before the returned JSX, add the state and render the
modal as a sibling of `AppContent` — so it renders regardless of auth/loading
state and blocks interaction immediately:

```tsx
function App() {
  const [showStartupNotice, setShowStartupNotice] = useState(true);

  return (
    <AuthProvider>
      <MissionProvider>
        <StartupNoticeModal
          open={showStartupNotice}
          onDismiss={() => setShowStartupNotice(false)}
        />
        <AppContent />
      </MissionProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Verify it blocks interaction and only closes on the button**

Run: `cd frontend && npm run typecheck` — must pass.

Start the dev server and open the app in a browser:
- Confirm the modal appears immediately on load, before/over the login or
  map screen.
- Click on the dark overlay outside the modal card — confirm it does
  **not** close.
- Press Escape — confirm it does **not** close.
- Click "J'ai compris" — confirm it closes and the rest of the app becomes
  interactive.
- Reload the page — confirm the modal reappears (no localStorage
  memorization).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/StartupNoticeModal.tsx frontend/src/App.tsx
git commit -m "Add non-dismissible startup notice about temporary free-tier hosting"
```

---

### Task 5: Server-side position batching (buffer, tick, bulk Mongo writes)

**Files:**
- Create: `backend/src/positionBatch.ts`
- Create: `backend/src/positionBatch.test.ts`
- Modify: `backend/src/socket.ts`
- Modify: `backend/package.json` (add `test` script; `tsx` already present)

**Interfaces:**
- Produces (from `positionBatch.ts`, consumed by `socket.ts` in this same
  task): `type BufferedPosition = { userId: string; lng: number; lat: number; speed: number | null; heading: number | null; accuracy: number | null; t: number; color: string; retentionSeconds: number }`,
  `selectTraceInserts(points: BufferedPosition[], missionId: string, lastTraceTsByUserMission: Map<string, number>, traceThrottleMs: number): TraceInsert[]`
  where `TraceInsert = { missionId: string; userId: string; color: string; lng: number; lat: number; createdAt: number; expiresAt: number }`.
- Produces (from `socket.ts`, consumed by Task 6): the server now emits
  `position:batch` with payload shape `{ missionId: string; points: Array<{ userId: string; lng: number; lat: number; speed: number | null; heading: number | null; accuracy: number | null; t: number }> }`
  to room `mission:{missionId}`, on a per-mission tick, instead of emitting
  `position:update` per message. `position:update` is fully removed from the
  server's outgoing broadcast (kept as an *incoming* client→server event
  name — only the payload the server sends back changes name/shape).

This is the highest-risk task: it changes the real-time contract between
server and client. The pure trace-selection decision (which points are old
enough to write a new `Trace` doc, mirroring the existing
`TRACE_THROTTLE_MS` per-user gate) is extracted into a testable function.
The buffering, per-mission timer, and actual Mongo I/O are integration-level
code with no test harness in this repo (no test MongoDB instance configured)
— verified manually against a running dev server instead.

- [ ] **Step 1: Write the failing test for the pure trace-selection logic**

Create `backend/src/positionBatch.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTraceInserts, type BufferedPosition } from './positionBatch.js';

function point(overrides: Partial<BufferedPosition> = {}): BufferedPosition {
  return {
    userId: 'user1',
    lng: 2.35,
    lat: 48.85,
    speed: null,
    heading: null,
    accuracy: null,
    t: 1000,
    color: '#3b82f6',
    retentionSeconds: 3600,
    ...overrides,
  };
}

test('selectTraceInserts inserts a point with no prior trace for that user/mission', () => {
  const last = new Map<string, number>();
  const inserts = selectTraceInserts([point({ t: 1000 })], 'mission1', last, 2000);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].userId, 'user1');
  assert.equal(inserts[0].missionId, 'mission1');
  assert.equal(inserts[0].createdAt, 1000);
  assert.equal(inserts[0].expiresAt, 1000 + 3600 * 1000);
});

test('selectTraceInserts skips a point within the throttle window of the last insert', () => {
  const last = new Map<string, number>([['mission1:user1', 1000]]);
  const inserts = selectTraceInserts([point({ t: 1500 })], 'mission1', last, 2000);
  assert.equal(inserts.length, 0);
});

test('selectTraceInserts keeps a point past the throttle window and updates the map', () => {
  const last = new Map<string, number>([['mission1:user1', 1000]]);
  const inserts = selectTraceInserts([point({ t: 3000 })], 'mission1', last, 2000);
  assert.equal(inserts.length, 1);
  assert.equal(last.get('mission1:user1'), 3000);
});

test('selectTraceInserts handles multiple users independently in the same tick', () => {
  const last = new Map<string, number>();
  const points = [point({ userId: 'user1', t: 1000 }), point({ userId: 'user2', t: 1000 })];
  const inserts = selectTraceInserts(points, 'mission1', last, 2000);
  assert.equal(inserts.length, 2);
  assert.deepEqual(
    inserts.map((i) => i.userId).sort(),
    ['user1', 'user2']
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Add to `backend/package.json` `"scripts"`:
```json
"test": "tsx --test src/**/*.test.ts"
```

Run: `cd backend && npm test`
Expected: FAIL — `positionBatch.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation of the pure logic**

Create `backend/src/positionBatch.ts`:

```ts
export type BufferedPosition = {
  userId: string;
  lng: number;
  lat: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  t: number;
  color: string;
  retentionSeconds: number;
};

export type TraceInsert = {
  missionId: string;
  userId: string;
  color: string;
  lng: number;
  lat: number;
  createdAt: number;
  expiresAt: number;
};

export function selectTraceInserts(
  points: BufferedPosition[],
  missionId: string,
  lastTraceTsByUserMission: Map<string, number>,
  traceThrottleMs: number
): TraceInsert[] {
  const inserts: TraceInsert[] = [];
  for (const p of points) {
    const key = `${missionId}:${p.userId}`;
    const lastTs = lastTraceTsByUserMission.get(key) ?? 0;
    if (p.t - lastTs < traceThrottleMs) continue;
    inserts.push({
      missionId,
      userId: p.userId,
      color: p.color,
      lng: p.lng,
      lat: p.lat,
      createdAt: p.t,
      expiresAt: p.t + Math.max(0, p.retentionSeconds) * 1000,
    });
    lastTraceTsByUserMission.set(key, p.t);
  }
  return inserts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Commit the pure logic**

```bash
git add backend/package.json backend/src/positionBatch.ts backend/src/positionBatch.test.ts
git commit -m "Add pure trace-insert selection logic for position batching, with node:test coverage"
```

- [ ] **Step 6: Wire buffering + tick + bulk writes into `socket.ts`**

In `backend/src/socket.ts`:

Add the import near the top (with the other model imports):
```ts
import { selectTraceInserts, type BufferedPosition } from './positionBatch.js';
```

Add module-scope state near `const lastTraceTsByUserMission = new Map<string, number>();` (line 42):
```ts
const BATCH_TICK_MS = 1500;
const positionBuffers = new Map<string, Map<string, BufferedPosition>>();
const missionTickTimers = new Map<string, NodeJS.Timeout>();

async function flushPositionBatch(missionId: string, points: BufferedPosition[]) {
  const missionObjectId = new mongoose.Types.ObjectId(missionId);

  if (points.length > 0) {
    const positionOps = points.map((p) => ({
      updateOne: {
        filter: { missionId: missionObjectId, userId: new mongoose.Types.ObjectId(p.userId) },
        update: {
          $set: {
            loc: { type: 'Point', coordinates: [p.lng, p.lat] },
            speed: p.speed ?? undefined,
            heading: p.heading ?? undefined,
            accuracy: p.accuracy ?? undefined,
            timestamp: new Date(p.t),
          },
        },
        upsert: true,
      },
    }));
    await PositionCurrentModel.bulkWrite(positionOps, { ordered: false });
  }

  const traceInserts = selectTraceInserts(points, missionId, lastTraceTsByUserMission, TRACE_THROTTLE_MS);
  if (traceInserts.length > 0) {
    await TraceModel.insertMany(
      traceInserts.map((ins) => ({
        missionId: new mongoose.Types.ObjectId(ins.missionId),
        userId: new mongoose.Types.ObjectId(ins.userId),
        color: ins.color,
        loc: { type: 'Point', coordinates: [ins.lng, ins.lat] },
        createdAt: new Date(ins.createdAt),
        expiresAt: new Date(ins.expiresAt),
      })),
      { ordered: false }
    );
  }
}

function ensureMissionTick(io: Server, missionId: string) {
  if (missionTickTimers.has(missionId)) return;
  const timer = setInterval(() => {
    void (async () => {
      const room = io.sockets.adapter.rooms.get(`mission:${missionId}`);
      if (!room || room.size === 0) {
        clearInterval(timer);
        missionTickTimers.delete(missionId);
        positionBuffers.delete(missionId);
        return;
      }

      const buffer = positionBuffers.get(missionId);
      if (!buffer || buffer.size === 0) return;

      const points = Array.from(buffer.values());
      buffer.clear();

      try {
        await flushPositionBatch(missionId, points);
      } catch (e) {
        console.error('[socket] position:batch flush failed:', e);
      }

      io.to(`mission:${missionId}`).emit('position:batch', {
        missionId,
        points: points.map((p) => ({
          userId: p.userId,
          lng: p.lng,
          lat: p.lat,
          speed: p.speed,
          heading: p.heading,
          accuracy: p.accuracy,
          t: p.t,
        })),
      });
    })();
  }, BATCH_TICK_MS);
  missionTickTimers.set(missionId, timer);
}
```

- [ ] **Step 7: Replace the immediate write/emit in the `position:update` handler**

In the `socket.on('position:update', ...)` handler, replace this block
(currently: individual `PositionCurrentModel.updateOne`, conditional
individual `TraceModel.create`, then immediate `io.to(...).emit('position:update', msg)`):

```ts
        const nowMs = Date.now();
        const tMs = typeof payload.t === 'number' ? payload.t : nowMs;
        const t = new Date(tMs);

        await PositionCurrentModel.updateOne(
          { missionId: new mongoose.Types.ObjectId(missionId), userId: new mongoose.Types.ObjectId(userId) },
          {
            $set: {
              loc: { type: 'Point', coordinates: [payload.lng, payload.lat] },
              speed: payload.speed,
              heading: payload.heading,
              accuracy: payload.accuracy,
              timestamp: t,
            },
          },
          { upsert: true }
        );

        const expiresAt = new Date(t.getTime() + Math.max(0, retentionSeconds) * 1000);

        const key = `${missionId}:${userId}`;
        const lastTs = lastTraceTsByUserMission.get(key) ?? 0;
        const diff = tMs - lastTs;

        if (diff >= TRACE_THROTTLE_MS) {
          await TraceModel.create({
            missionId: new mongoose.Types.ObjectId(missionId),
            userId: new mongoose.Types.ObjectId(userId),
            color: memberColor,
            loc: { type: 'Point', coordinates: [payload.lng, payload.lat] },
            createdAt: t,
            expiresAt,
          });

          lastTraceTsByUserMission.set(key, tMs);
        }

        const msg = {
          missionId,
          userId,
          lng: payload.lng,
          lat: payload.lat,
          speed: payload.speed ?? null,
          heading: payload.heading ?? null,
          accuracy: payload.accuracy ?? null,
          t: t.getTime(),
        };

        io.to(`mission:${missionId}`).emit('position:update', msg);
        ack?.({ ok: true });
```

With:
```ts
        const nowMs = Date.now();
        const tMs = typeof payload.t === 'number' ? payload.t : nowMs;

        let buffer = positionBuffers.get(missionId);
        if (!buffer) {
          buffer = new Map();
          positionBuffers.set(missionId, buffer);
        }
        buffer.set(userId, {
          userId,
          lng: payload.lng,
          lat: payload.lat,
          speed: payload.speed ?? null,
          heading: payload.heading ?? null,
          accuracy: payload.accuracy ?? null,
          t: tMs,
          color: memberColor,
          retentionSeconds,
        });
        ensureMissionTick(io, missionId);

        ack?.({ ok: true });
```

Note: `memberColor` and `retentionSeconds` are already computed earlier in
this same handler (existing cache-or-fetch block, lines ~283-315) — nothing
changes there, they're just consumed differently now.

- [ ] **Step 8: Manual verification (no automated test — requires a running Socket.IO server + Mongo)**

Run: `cd backend && npm run build` — must compile with no new TypeScript errors.

Start the backend dev server against a real (or local) MongoDB, connect two
authenticated clients into the same mission (e.g. via the frontend dev
server or a small script emitting `position:update`), and confirm:
- Positions from both users arrive together in a single `position:batch`
  event roughly every 1.5s, not as individual `position:update` events.
- `PositionCurrentModel` documents update correctly for each user.
- `TraceModel` documents are still throttled to one per ~2s per user (same
  behavior as before, now written via `insertMany` instead of individual
  `create` calls — check via `db.traces.find({missionId: ...}).count()`
  growth rate).
- After all members disconnect from a mission, the tick stops (no timer
  leak) — e.g. add a temporary `console.log('tick cleared', missionId)` in
  the cleanup branch, disconnect the last socket, confirm it logs once and
  not on every subsequent interval.

This full scenario is also covered by the Claude Cowork verification prompt
delivered after this plan — not attempted automatically here since it needs
two live authenticated sessions in the same mission.

- [ ] **Step 9: Commit**

```bash
git add backend/src/socket.ts
git commit -m "Buffer position:update per mission and flush as position:batch on a 1.5s tick"
```

---

### Task 6: Frontend `position:batch` listener

**Files:**
- Modify: `frontend/src/components/MapLibreMap.tsx`

**Interfaces:**
- Consumes: the `position:batch` event shape produced by Task 5 —
  `{ missionId: string; points: Array<{ userId: string; lng: number; lat: number; speed: number | null; heading: number | null; accuracy: number | null; t: number }> }`.
  Consumes the existing `applyRemotePosition(msg: any, opts?: { fromBulk?: boolean }): void`
  helper already defined in this file (line ~6041) — unchanged, reused as-is.
- Produces: no new exports.

`position:update` is fully removed as a listened *incoming* event here (the
server no longer sends it, per Task 5) — only `position:batch` replaces it.
`position:bulk` (offline flush, still per-user with its own `onPosBulk`
handler) is untouched.

- [ ] **Step 1: Replace the `onPos` handler with `onPosBatch`**

In `frontend/src/components/MapLibreMap.tsx`, near the existing `onPos`/
`onPosBulk` definitions (line ~6113-6124), replace:

```ts
    const onPos = (msg: any) => {
      applyRemotePosition(msg);
    };

    const onPosBulk = (msg: any) => {
```

With:

```ts
    const onPosBatch = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      const points = Array.isArray(msg.points) ? msg.points : [];
      for (const p of points) {
        applyRemotePosition(p);
      }
    };

    const onPosBulk = (msg: any) => {
```

- [ ] **Step 2: Update the event registration**

Replace (line ~6126-6128):
```ts
    socket.on('mission:snapshot', onSnapshot);
    socket.on('position:update', onPos);
    socket.on('position:bulk', onPosBulk);
```

With:
```ts
    socket.on('mission:snapshot', onSnapshot);
    socket.on('position:batch', onPosBatch);
    socket.on('position:bulk', onPosBulk);
```

- [ ] **Step 3: Update the cleanup**

Replace (line ~6519-6521):
```ts
      socket.off('mission:snapshot', onSnapshot);
      socket.off('position:update', onPos);
      socket.off('position:bulk', onPosBulk);
```

With:
```ts
      socket.off('mission:snapshot', onSnapshot);
      socket.off('position:batch', onPosBatch);
      socket.off('position:bulk', onPosBulk);
```

- [ ] **Step 4: Manual verification**

Run: `cd frontend && npm run typecheck` — must pass with no new errors.

With the Task 5 backend running, open two authenticated browser sessions in
the same mission and confirm other members' markers still update smoothly
on the map, now driven by `position:batch` frames instead of individual
`position:update` frames (check Network → WS in devtools).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MapLibreMap.tsx
git commit -m "Listen to position:batch instead of position:update for remote member positions"
```

---

### Task 7: msgpack binary parser (isolated, last)

**Files:**
- Modify: `backend/src/socket.ts`
- Modify: `backend/package.json`
- Modify: `frontend/src/lib/socket.ts`
- Modify: `frontend/package.json`

**Interfaces:**
- No new exports. Both sides must ship together in the same
  deploy — this task is deliberately its own commit, done only after Tasks
  1-6 are merged and manually verified in dev, per the approved design spec.

**Do not start this task until Tasks 1-6 are confirmed working.** A
mismatched parser between client and server breaks the entire Socket.IO
connection, not just position updates.

- [ ] **Step 1: Install the dependency on both sides**

```bash
cd backend && npm install socket.io-msgpack-parser
cd frontend && npm install socket.io-msgpack-parser
```

- [ ] **Step 2: Configure the backend Server**

In `backend/src/socket.ts`, add the import near the top:
```ts
import { parser } from 'socket.io-msgpack-parser';
```

In `setupSocket`, add `parser` to the existing `new Server(app.server, { ... })`
options (the `cors` block stays exactly as-is):
```ts
  const io = new Server(app.server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        cb(null, isAllowedOrigin(origin));
      },
      credentials: true,
    },
    parser,
  });
```

- [ ] **Step 3: Configure the frontend client**

In `frontend/src/lib/socket.ts`, add the import near the top:
```ts
import { parser } from 'socket.io-msgpack-parser';
```

Add `parser` to the existing `io(baseUrl, { ... })` options:
```ts
    socket = io(baseUrl, {
      transports: ['websocket', 'polling'],
      autoConnect: false,
      parser,
    });
```

- [ ] **Step 4: Manual verification (both sides must be tested together, in dev, before any deploy)**

Run: `cd backend && npm run build` and `cd frontend && npm run typecheck` —
both must pass.

Start both dev servers with the new parser and confirm, in a browser with
two authenticated sessions in the same mission:
- The connection still establishes successfully (check for `connect_error`
  in the console — a parser mismatch fails the handshake immediately).
- `position:batch` frames still arrive and update the map.
- Other Socket.IO event families still work: zone create/update, POI
  create/update, notifications, `vehicle-track:updated`.
- In devtools Network → WS, confirm frames are now binary (not readable
  JSON text) — this is the actual bandwidth win.

This is also covered by the Claude Cowork verification prompt — do not
deploy to production until this manual dev check passes on both sides.

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/socket.ts frontend/package.json frontend/package-lock.json frontend/src/lib/socket.ts
git commit -m "Switch Socket.IO to msgpack binary parser on both sides"
```

---

## Execution order

1. Task 1 (frontend gpsFilter helpers) and Task 4 (startup modal) — fully
   independent, can run in parallel.
2. Task 2, then Task 3 — both depend on Task 1's exports; Task 3 additionally
   removes a duplicate function so should follow Task 2 to keep diffs clean
   (not a hard dependency, just cleaner history).
3. Task 5 — start once Task 1-3 are merged (touches the same
   `MapLibreMap.tsx` file as Task 3, in a different section, but merging on
   an up-to-date base avoids any conflict).
4. Task 6 — immediately after Task 5 merges (must match its exact event
   contract).
5. Task 7 — only after Tasks 1-6 are merged and manually verified in dev.

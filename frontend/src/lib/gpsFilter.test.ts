import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineMeters,
  roundCoord,
  shouldEmitPosition,
  SIGNIFICANT_MOVE_METERS,
  MOVEMENT_NOISE_METERS,
  MOVEMENT_MAX_INTERVAL_MS,
  HEARTBEAT_MS,
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
  // ~0.73m at this latitude (below MOVEMENT_NOISE_METERS, i.e. GPS jitter while
  // stationary); 500ms is under the 30s heartbeat, so no emit yet.
  const next = { lng: 2.35001, lat: 48.85, t: 1500 };
  assert.equal(shouldEmitPosition(last, next), false);
});

test('shouldEmitPosition accepts a point past the significant-move threshold', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  // ~14.6m at this latitude, past SIGNIFICANT_MOVE_METERS (8m); always emits
  // immediately regardless of elapsed time.
  const next = { lng: 2.3502, lat: 48.85, t: 1500 };
  assert.equal(shouldEmitPosition(last, next), true);
});

test('shouldEmitPosition accepts an unmoved point after the heartbeat interval', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  const next = { lng: 2.35, lat: 48.85, t: 1000 + HEARTBEAT_MS };
  assert.equal(shouldEmitPosition(last, next), true);
});

test('shouldEmitPosition rejects modest real movement before the 2s movement cap', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  // haversineMeters({lng:2.35,lat:48.85}, {lng:2.35004,lat:48.85}) ~= 2.93m:
  // above MOVEMENT_NOISE_METERS (2m, so it's real movement, not jitter) but
  // below SIGNIFICANT_MOVE_METERS (8m). Only 1000ms elapsed, under the 2s cap.
  const next = { lng: 2.35004, lat: 48.85, t: 1000 + 1000 };
  assert.ok(haversineMeters(last, next) > MOVEMENT_NOISE_METERS);
  assert.ok(haversineMeters(last, next) < SIGNIFICANT_MOVE_METERS);
  assert.equal(shouldEmitPosition(last, next), false);
});

test('shouldEmitPosition emits modest real movement once the 2s movement cap elapses', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  // Same ~2.93m modest movement as above, but now MOVEMENT_MAX_INTERVAL_MS
  // (2000ms) has elapsed, so the 2s cap fires even though we're nowhere near 8m.
  const next = { lng: 2.35004, lat: 48.85, t: 1000 + MOVEMENT_MAX_INTERVAL_MS };
  assert.equal(shouldEmitPosition(last, next), true);
});

test('shouldEmitPosition emits a fast mover immediately even with almost no elapsed time', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  // haversineMeters({lng:2.35,lat:48.85}, {lng:2.35012,lat:48.85}) ~= 8.78m,
  // at/above SIGNIFICANT_MOVE_METERS (8m); only 200ms elapsed, far under the
  // 2s movement cap, but the 8m distance still forces an immediate emit.
  const next = { lng: 2.35012, lat: 48.85, t: 1000 + 200 };
  assert.ok(haversineMeters(last, next) >= SIGNIFICANT_MOVE_METERS);
  assert.equal(shouldEmitPosition(last, next), true);
});

test('shouldEmitPosition rejects GPS jitter while genuinely stationary before the heartbeat', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  // haversineMeters({lng:2.35,lat:48.85}, {lng:2.350005,lat:48.85}) ~= 0.37m,
  // well below MOVEMENT_NOISE_METERS (2m) -> treated as jitter, not movement.
  // Only 5000ms elapsed, under the 30s heartbeat, so no emit.
  const next = { lng: 2.350005, lat: 48.85, t: 1000 + 5000 };
  assert.ok(haversineMeters(last, next) <= MOVEMENT_NOISE_METERS);
  assert.equal(shouldEmitPosition(last, next), false);
});

test('shouldEmitPosition emits GPS jitter once the 30s heartbeat elapses', () => {
  const last = { lng: 2.35, lat: 48.85, t: 1000 };
  // Same ~0.37m jitter as above, but now HEARTBEAT_MS (30s) has elapsed.
  const next = { lng: 2.350005, lat: 48.85, t: 1000 + HEARTBEAT_MS };
  assert.equal(shouldEmitPosition(last, next), true);
});

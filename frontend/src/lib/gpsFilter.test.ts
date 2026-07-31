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

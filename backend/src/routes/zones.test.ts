import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidLngLat, isValidRingShape, validateCircle, validatePolygon } from './zones.js';

test('isValidLngLat accepts in-range finite pairs and rejects everything else', () => {
  assert.equal(isValidLngLat(2.35, 48.85), true);
  assert.equal(isValidLngLat(-180, -90), true);
  assert.equal(isValidLngLat(180, 90), true);
  assert.equal(isValidLngLat(181, 0), false);
  assert.equal(isValidLngLat(0, -91), false);
  assert.equal(isValidLngLat(NaN, 0), false);
  assert.equal(isValidLngLat('2.35', 48.85), false);
});

test('isValidRingShape requires >=4 positions and a closed ring', () => {
  const closed = [[0, 0], [1, 0], [1, 1], [0, 0]];
  assert.equal(isValidRingShape(closed), true);

  const tooShort = [[0, 0], [1, 0], [0, 0]];
  assert.equal(isValidRingShape(tooShort), false);

  const notClosed = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.equal(isValidRingShape(notClosed), false);

  assert.equal(isValidRingShape(null), false);
});

test('validatePolygon rejects malformed rings and out-of-range coordinates', () => {
  assert.deepEqual(
    validatePolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1]]] }),
    { error: 'INVALID_POLYGON_RING' }
  );
  assert.deepEqual(
    validatePolygon({ type: 'Polygon', coordinates: [[[0, 0], [200, 0], [1, 1], [0, 0]]] }),
    { error: 'INVALID_COORDINATES' }
  );
  assert.equal(
    validatePolygon({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }),
    null
  );
});

test('validateCircle rejects bad centers and non-positive radii', () => {
  assert.deepEqual(validateCircle({ center: { lng: 200, lat: 48 }, radiusMeters: 100 }), {
    error: 'INVALID_COORDINATES',
  });
  assert.deepEqual(validateCircle({ center: { lng: 2, lat: 48 }, radiusMeters: -5 }), {
    error: 'INVALID_CIRCLE_RADIUS',
  });
  assert.deepEqual(validateCircle({ center: { lng: 2, lat: 48 }, radiusMeters: 0 }), {
    error: 'INVALID_CIRCLE_RADIUS',
  });
  assert.equal(validateCircle({ center: { lng: 2, lat: 48 }, radiusMeters: 500 }), null);
});

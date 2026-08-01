import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidLngLat,
  isValidRingShape,
  validateCircle,
  validatePolygon,
  isGridCellIdWithinGrid,
} from './zones.js';

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

test('isGridCellIdWithinGrid accepts cells inside the grid and rejects malformed or out-of-bounds labels', () => {
  // "C3" -> col 'C' = index 2, row 3 = index 2
  assert.equal(isGridCellIdWithinGrid('C3', 12, 12), true);
  // "H9" -> col 'H' = index 7, row 9 = index 8: both out of bounds once the grid shrinks
  // to 4x4 (the exact 12x12 -> 4x4 shrink scenario from the audit finding).
  assert.equal(isGridCellIdWithinGrid('H9', 4, 4), false);
  // A label that stays structurally valid ("C3" -> col 2, row 2) under a different-sized
  // grid (12x12 -> 10x10) is still considered "in bounds" by this helper: this is exactly
  // why the PATCH route does NOT rely on this helper to decide whether to keep an
  // assignment across a real dimension change (it clears unconditionally instead) -
  // bounds-checking alone can't tell "still the same real cell" from "coincidentally
  // still a valid label".
  assert.equal(isGridCellIdWithinGrid('C3', 10, 10), true);
  // Row/col at the edge of the grid.
  assert.equal(isGridCellIdWithinGrid('A1', 1, 1), true);
  assert.equal(isGridCellIdWithinGrid('B1', 1, 1), false);
  assert.equal(isGridCellIdWithinGrid('A2', 1, 1), false);
  // Malformed labels.
  assert.equal(isGridCellIdWithinGrid('3C', 12, 12), false);
  assert.equal(isGridCellIdWithinGrid('c3', 12, 12), false);
  assert.equal(isGridCellIdWithinGrid('', 12, 12), false);
  assert.equal(isGridCellIdWithinGrid('AA1', 26, 26), false);
});

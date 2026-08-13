import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateLngLatPoint,
  validateDisplayMode,
  validateIcon,
  validateAxis,
  validateAxes,
  validatePointName,
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

test('validatePointName accepte null/vide et rejette >40 caractères après trim', () => {
  assert.deepEqual(validatePointName(null), { value: null });
  assert.deepEqual(validatePointName(undefined), { value: null });
  assert.deepEqual(validatePointName(''), { value: null });
  assert.deepEqual(validatePointName('   '), { value: null });
  assert.deepEqual(validatePointName('auchan'), { value: 'AUCHAN' });
  assert.deepEqual(validatePointName('  auchan  '), { value: 'AUCHAN' });
  assert.deepEqual(validatePointName('X'.repeat(40)), { value: 'X'.repeat(40) });
  assert.deepEqual(validatePointName('X'.repeat(41)), { error: 'INVALID_POINT_NAME' });
  assert.deepEqual(validatePointName(42), { error: 'INVALID_POINT_NAME' });
});

test('validateAxes exige 1 à 20 axes avec des axisId uniques', () => {
  assert.equal(validateAxes([goodAxis]), null);
  assert.deepEqual(validateAxes([]), { error: 'AXES_REQUIRED' });
  assert.deepEqual(validateAxes([goodAxis, goodAxis]), { error: 'DUPLICATE_AXIS_ID' });
  const many = Array.from({ length: 21 }, (_, i) => ({ ...goodAxis, axisId: `a${i}` }));
  assert.deepEqual(validateAxes(many), { error: 'TOO_MANY_AXES' });
  assert.deepEqual(validateAxes([{ ...goodAxis, color: 'x' }]), { error: 'INVALID_AXIS_COLOR' });
});

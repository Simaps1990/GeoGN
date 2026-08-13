import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheKey, parseOverpassElements, validateCoords } from './overpass.js';

test('buildCacheKey arrondit lat/lng à 3 décimales et distingue kind/radius', () => {
  assert.equal(buildCacheKey('roads', 250, 47.81456, -4.33641), 'roads:250:47.815,-4.336');
  assert.equal(buildCacheKey('roads', 500, 47.81456, -4.33641), 'roads:500:47.815,-4.336');
  assert.equal(buildCacheKey('pois', 2000, 47.8, -4.3), 'pois:2000:47.800,-4.300');
  // deux points arrondis dans le même bucket à 3 décimales partagent la même clé cache
  assert.equal(buildCacheKey('roads', 250, 47.8112, -4.336), buildCacheKey('roads', 250, 47.8114, -4.336));
});

test('validateCoords accepte un point valide et rejette le reste', () => {
  assert.equal(validateCoords(48.85, 2.35), true);
  assert.equal(validateCoords(0, -180), true);
  assert.equal(validateCoords(90, 180), true);
  assert.equal(validateCoords(91, 0), false);
  assert.equal(validateCoords(0, 181), false);
  assert.equal(validateCoords(NaN, 0), false);
  assert.equal(validateCoords(0, NaN), false);
  assert.equal(validateCoords('48' as any, 2), false);
  assert.equal(validateCoords(undefined, 2), false);
});

test('parseOverpassElements rejette un miroir en erreur (remark, elements absent, réponse non-objet)', () => {
  assert.throws(
    () => parseOverpassElements({ remark: 'runtime error: Query timed out in "query" at line 1' }),
    /OVERPASS_BAD_RESPONSE/
  );
  assert.throws(() => parseOverpassElements({}), /OVERPASS_BAD_RESPONSE/);
  assert.throws(() => parseOverpassElements(null), /OVERPASS_BAD_RESPONSE/);
  assert.deepEqual(parseOverpassElements({ elements: [] }), []);
  const el = { type: 'way', id: 1, tags: { highway: 'residential' } };
  assert.deepEqual(parseOverpassElements({ elements: [el] }), [el]);
});

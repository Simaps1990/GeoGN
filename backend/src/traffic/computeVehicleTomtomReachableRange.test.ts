import { test } from 'node:test';
import assert from 'node:assert/strict';

// NB: trafficConfig.ts reads TRAFFIC_PROVIDER into a module-level const at import time,
// so the env vars below must be set BEFORE the module (and its computeVehicleTomtomReachableRange
// dependency) is first loaded — hence the dynamic import inside the test instead of a static one.
// Régression: le facteur "vélo" était détecté par regex sur le LIBELLÉ de la piste.
// Une piste vélo nommée autrement était calculée à vitesse moto (isochrone ~2x trop
// grande). Il doit désormais dépendre uniquement de vehicleType === 'bike'.
test('computeVehicleTomtomReachableRange applies the bike speed factor from vehicleType, not from the label', async () => {
  const prev = {
    provider: process.env.TRAFFIC_PROVIDER,
    key: process.env.TOMTOM_API_KEY,
    baseUrl: process.env.TOMTOM_BASE_URL,
    cap: process.env.TOMTOM_MAX_CALLS_PER_MINUTE,
  };
  const realFetch = globalThis.fetch;

  process.env.TRAFFIC_PROVIDER = 'tomtom';
  process.env.TOMTOM_API_KEY = 'test-key';
  process.env.TOMTOM_BASE_URL = 'https://tomtom.invalid.example';
  process.env.TOMTOM_MAX_CALLS_PER_MINUTE = '100';

  const requestedBudgets: { travelMode: string | null; timeBudgetInSec: string | null }[] = [];
  globalThis.fetch = (async (url: any) => {
    const u = new URL(String(url));
    requestedBudgets.push({
      travelMode: u.searchParams.get('travelMode'),
      timeBudgetInSec: u.searchParams.get('timeBudgetInSec'),
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        reachableRange: {
          center: { latitude: 48.85, longitude: 2.35 },
          boundary: [
            { latitude: 48.86, longitude: 2.35 },
            { latitude: 48.85, longitude: 2.36 },
            { latitude: 48.84, longitude: 2.35 },
          ],
        },
      }),
    } as any;
  }) as any;

  try {
    const { computeVehicleTomtomReachableRange } = await import('./computeVehicleTomtomReachableRange.js');

    // Libellé volontairement absent / non "vélo" : seul vehicleType compte.
    const bike = await computeVehicleTomtomReachableRange({
      lng: 2.35,
      lat: 48.85,
      elapsedSeconds: 100,
      maxBudgetSeconds: 100,
      vehicleType: 'bike',
    });
    assert.equal(bike.meta?.travelMode, 'motorcycle');
    assert.equal(bike.meta?.budget?.factor, 0.45);
    assert.equal(requestedBudgets.at(-1)?.timeBudgetInSec, '45');

    // Contrôle: une vraie moto garde la portée pleine.
    const moto = await computeVehicleTomtomReachableRange({
      lng: 2.35,
      lat: 48.85,
      elapsedSeconds: 100,
      maxBudgetSeconds: 100,
      vehicleType: 'motorcycle',
    });
    assert.equal(moto.meta?.budget?.factor, 1);
    assert.equal(requestedBudgets.at(-1)?.timeBudgetInSec, '100');
  } finally {
    globalThis.fetch = realFetch;
    process.env.TRAFFIC_PROVIDER = prev.provider;
    process.env.TOMTOM_API_KEY = prev.key;
    process.env.TOMTOM_BASE_URL = prev.baseUrl;
    process.env.TOMTOM_MAX_CALLS_PER_MINUTE = prev.cap;
  }
});

test('computeVehicleTomtomReachableRange returns RATE_BUDGET_EXHAUSTED (no TomTom call attempted) when the per-minute cap is 0', async () => {
  const prev = {
    provider: process.env.TRAFFIC_PROVIDER,
    key: process.env.TOMTOM_API_KEY,
    baseUrl: process.env.TOMTOM_BASE_URL,
    cap: process.env.TOMTOM_MAX_CALLS_PER_MINUTE,
  };

  process.env.TRAFFIC_PROVIDER = 'tomtom';
  process.env.TOMTOM_API_KEY = 'test-key';
  // Deliberately unreachable: if a real fetch were attempted, this test would hang/fail
  // instead of silently passing, proving the budget check runs before any network call.
  process.env.TOMTOM_BASE_URL = 'https://tomtom.invalid.example';
  process.env.TOMTOM_MAX_CALLS_PER_MINUTE = '0';

  try {
    const { computeVehicleTomtomReachableRange } = await import('./computeVehicleTomtomReachableRange.js');
    const result = await computeVehicleTomtomReachableRange({
      lng: 2.35,
      lat: 48.85,
      elapsedSeconds: 60,
      vehicleType: 'car',
    });

    assert.deepEqual(result.geojson, { type: 'FeatureCollection', features: [] });
    assert.equal(result.meta?.reason, 'RATE_BUDGET_EXHAUSTED');
  } finally {
    process.env.TRAFFIC_PROVIDER = prev.provider;
    process.env.TOMTOM_API_KEY = prev.key;
    process.env.TOMTOM_BASE_URL = prev.baseUrl;
    process.env.TOMTOM_MAX_CALLS_PER_MINUTE = prev.cap;
  }
});

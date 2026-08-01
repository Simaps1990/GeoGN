import { test } from 'node:test';
import assert from 'node:assert/strict';

// NB: trafficConfig.ts reads TRAFFIC_PROVIDER into a module-level const at import time,
// so the env vars below must be set BEFORE the module (and its computeVehicleTomtomReachableRange
// dependency) is first loaded — hence the dynamic import inside the test instead of a static one.
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

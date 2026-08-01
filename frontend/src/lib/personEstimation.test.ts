import test from 'node:test';
import assert from 'node:assert/strict';
import type { ApiPersonCase } from './api.js';
import { computeEstimation } from './personEstimation.js';
import {
  computeIsNight,
  computeLocomotorInjuryFactor,
  computeNightFactor,
  computeWeatherFactor,
  cleanInjuries,
} from './estimationWalking.js';

const nowMs = Date.now();
const whenIso = new Date(nowMs - 3 * 3_600_000).toISOString();

const weather = { temperatureC: 3, windSpeedKmh: 30, precipitationMm: 1 };

const personCase: ApiPersonCase = {
  id: 'pc1',
  missionId: 'm1',
  createdBy: 'u1',
  lastKnown: { type: 'address' as const, query: 'quelque part', lng: 2.35, lat: 48.85, when: whenIso },
  nextClue: null,
  mobility: 'none' as const,
  age: 70,
  sex: 'unknown' as const,
  healthStatus: 'fragile' as const,
  diseases: ['diabete'],
  injuries: [{ id: 'fracture', locations: ['left_leg'] }],
  diseasesFreeText: '',
  injuriesFreeText: '',
  terrain: 'foret',
  medications: ['alcool'],
  createdAt: whenIso,
  updatedAt: whenIso,
};

test('the reasoning text quotes the exact speed the search radius is built from', () => {
  const est = computeEstimation(personCase, weather, nowMs);

  const quoted = /→ ~([\d.]+) km\/h/.exec(est.reasoning[0]);
  assert.ok(quoted, `no speed found in reasoning: ${est.reasoning[0]}`);
  // Le texte affiché et la vitesse utilisée pour le rayon sont le même nombre.
  assert.equal(quoted![1], est.effectiveKmh.toFixed(1));

  // …et le rayon probable est bien ce même nombre x le temps écoulé (3 h ici).
  assert.equal(est.hoursSince, 3);
  assert.ok(Math.abs(est.probableKm - est.effectiveKmh * 3) < 1e-9);
});

test('the reasoning text quotes the same locomotor / weather+night factors as estimationWalking', () => {
  const est = computeEstimation(personCase, weather, nowMs);

  const cleanInj = cleanInjuries(personCase.injuries);
  const isNight = computeIsNight(whenIso);
  const hasDeshydratation = false;
  const hasLocomotor = true;

  const locomotorPct = (computeLocomotorInjuryFactor(cleanInj) * 100).toFixed(0);
  const weatherNightPct = (
    computeWeatherFactor(weather, isNight, hasDeshydratation) *
    computeNightFactor(isNight, weather, hasLocomotor) *
    100
  ).toFixed(0);

  assert.ok(
    est.reasoning[0].includes(`blessures locomotrices ${locomotorPct}%`),
    est.reasoning[0]
  );
  assert.ok(est.reasoning[0].includes(`météo+nuit ${weatherNightPct}%`), est.reasoning[0]);
});

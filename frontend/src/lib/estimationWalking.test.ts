import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAgeFactor, computeMedicationFactor } from './estimationWalking.js';

test('computeAgeFactor returns neutral 1.0 for missing age', () => {
  assert.equal(computeAgeFactor(null), 1);
});

test('computeAgeFactor clamps an implausible age (130) into the oldest bucket instead of failing open to 1.0', () => {
  assert.equal(computeAgeFactor(130), 0.55);
});

test('computeAgeFactor clamps a negative age into the youngest bucket instead of failing open to 1.0', () => {
  assert.equal(computeAgeFactor(-5), 0.6);
});

test('computeAgeFactor truncates a non-integer age into its bucket', () => {
  assert.equal(computeAgeFactor(5.9), 0.6);
});

test('computeAgeFactor still returns 1.0 for a normal adult age', () => {
  assert.equal(computeAgeFactor(30), 1);
});

test('computeMedicationFactor returns the single factor for one medication', () => {
  assert.equal(computeMedicationFactor(['alcool']), 0.65);
});

test('computeMedicationFactor combines multiple medications more impairingly than the worst alone', () => {
  const single = computeMedicationFactor(['anxiolytique']);
  const combined = computeMedicationFactor(['anxiolytique', 'alcool']);
  assert.ok(combined < single, `expected combined (${combined}) < single (${single})`);
  // minF (0.65 alcool vs 0.7 anxiolytique -> min 0.65) * 0.97^(2-1)
  assert.ok(Math.abs(combined - 0.65 * 0.97) < 1e-9);
});

test('computeMedicationFactor clamps combined factor to the 0.35 floor', () => {
  const combined = computeMedicationFactor(['opioid', 'alcool', 'anxiolytique']);
  assert.ok(combined >= 0.35);
});

test('computeMedicationFactor returns 1.0 when no medications given', () => {
  assert.equal(computeMedicationFactor([]), 1);
  assert.equal(computeMedicationFactor(null), 1);
});

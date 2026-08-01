import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAgeFactor } from './estimationWalking.js';

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTraceInserts, type BufferedPosition } from './positionBatch.js';

function point(overrides: Partial<BufferedPosition> = {}): BufferedPosition {
  return {
    userId: 'user1',
    lng: 2.35,
    lat: 48.85,
    speed: null,
    heading: null,
    accuracy: null,
    t: 1000,
    color: '#3b82f6',
    retentionSeconds: 3600,
    ...overrides,
  };
}

test('selectTraceInserts inserts a point with no prior trace for that user/mission', () => {
  const last = new Map<string, number>();
  const inserts = selectTraceInserts([point({ t: 1000 })], 'mission1', last, 2000);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].userId, 'user1');
  assert.equal(inserts[0].missionId, 'mission1');
  assert.equal(inserts[0].createdAt, 1000);
  assert.equal(inserts[0].expiresAt, 1000 + 3600 * 1000);
});

test('selectTraceInserts skips a point within the throttle window of the last insert', () => {
  const last = new Map<string, number>([['mission1:user1', 1000]]);
  const inserts = selectTraceInserts([point({ t: 1500 })], 'mission1', last, 2000);
  assert.equal(inserts.length, 0);
});

test('selectTraceInserts keeps a point past the throttle window and updates the map', () => {
  const last = new Map<string, number>([['mission1:user1', 1000]]);
  const inserts = selectTraceInserts([point({ t: 3000 })], 'mission1', last, 2000);
  assert.equal(inserts.length, 1);
  assert.equal(last.get('mission1:user1'), 3000);
});

test('selectTraceInserts handles multiple users independently in the same tick', () => {
  const last = new Map<string, number>();
  const points = [point({ userId: 'user1', t: 1000 }), point({ userId: 'user2', t: 1000 })];
  const inserts = selectTraceInserts(points, 'mission1', last, 2000);
  assert.equal(inserts.length, 2);
  assert.deepEqual(
    inserts.map((i) => i.userId).sort(),
    ['user1', 'user2']
  );
});

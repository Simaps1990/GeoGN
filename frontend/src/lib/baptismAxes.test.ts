import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AXIS_PALETTE,
  isWayAllowed,
  distMeters,
  bearingDeg,
  destinationPoint,
  computeAxesFromWays,
  type OverpassWay,
} from './baptismAxes.js';

function way(id: number, nodes: number[], pts: [number, number][], tags: Record<string, string> = { highway: 'residential' }): OverpassWay {
  return { type: 'way', id, tags, nodes, geometry: pts.map(([lon, lat]) => ({ lat, lon })) };
}

const CROSS: OverpassWay[] = [
  way(1, [1, 100, 2], [[1.999, 48], [2, 48], [2.001, 48]], { highway: 'residential', name: 'Rue Est-Ouest' }),
  way(2, [3, 100, 4], [[2, 47.999], [2, 48], [2, 48.001]]),
];

test('bearingDeg et destinationPoint sont cohérents', () => {
  const north = bearingDeg([2, 48], [2, 48.001]);
  assert.ok(Math.abs(north - 0) < 1 || Math.abs(north - 360) < 1);
  const east = bearingDeg([2, 48], [2.001, 48]);
  assert.ok(Math.abs(east - 90) < 1);
  const d = destinationPoint([2, 48], 90, 100);
  assert.ok(Math.abs(distMeters([2, 48], d) - 100) < 1);
});

test('isWayAllowed filtre selon l’icône', () => {
  assert.equal(isWayAllowed('car', 'residential'), true);
  assert.equal(isWayAllowed('car', 'footway'), false);
  assert.equal(isWayAllowed('person', 'footway'), true);
  assert.equal(isWayAllowed('house', 'path'), true);
  assert.equal(isWayAllowed('person', undefined), false);
});

test('carrefour en X : 4 axes triés par azimut avec couleurs de la palette', () => {
  const { axes, walked } = computeAxesFromWays(CROSS, [2, 48.00001], 'car');
  assert.equal(axes.length, 4);
  const bearings = axes.map((a) => a.bearing);
  const expected = [0, 90, 180, 270];
  bearings.forEach((b, i) => {
    const diff = Math.min(Math.abs(b - expected[i]), 360 - Math.abs(b - expected[i]));
    assert.ok(diff < 5, `azimut ${b} attendu ~${expected[i]}`);
  });
  assert.deepEqual(axes.map((a) => a.color), AXIS_PALETTE.slice(0, 4));
  assert.ok(walked.every((w) => w.endType === 'deadend'));
  axes.forEach((a) => {
    assert.deepEqual(a.geometry.coordinates[0], [2, 48]);
    assert.equal(a.name, null);
  });
});

test('milieu de segment : 2 axes, l’un s’arrête à l’intersection', () => {
  const { axes, walked } = computeAxesFromWays(CROSS, [2.0005, 48.00003], 'car');
  assert.equal(axes.length, 2);
  const atIntersection = walked.find((w) => w.endType === 'intersection');
  const atDeadend = walked.find((w) => w.endType === 'deadend');
  assert.ok(atIntersection && atDeadend);
  assert.deepEqual(atIntersection.coords[atIntersection.coords.length - 1], [2, 48]);
  assert.deepEqual(atDeadend.coords[atDeadend.coords.length - 1], [2.001, 48]);
});

test('jonction en T : la branche vers la traversante s’arrête au nœud partagé', () => {
  const T: OverpassWay[] = [
    way(1, [1, 100, 2], [[1.999, 48], [2, 48], [2.001, 48]]),
    way(2, [100, 3], [[2, 48], [2, 47.999]]),
  ];
  const { walked } = computeAxesFromWays(T, [2, 47.9995], 'car');
  assert.equal(walked.length, 2);
  const north = walked.find((w) => w.endType === 'intersection');
  assert.ok(north);
  assert.deepEqual(north.coords[north.coords.length - 1], [2, 48]);
});

test('continuité de way scindée : l’axe traverse le nœud de degré 2', () => {
  const SPLIT: OverpassWay[] = [
    way(1, [1, 2], [[2, 48], [2.001, 48]]),
    way(2, [2, 3], [[2.001, 48], [2.002, 48]], { highway: 'residential', ref: 'D45' }),
  ];
  const { walked } = computeAxesFromWays(SPLIT, [2.0003, 48], 'car');
  const east = walked.find((w) => w.coords[w.coords.length - 1][0] > 2.0015);
  assert.ok(east, 'l’axe est doit continuer sur la seconde way');
  assert.deepEqual(east.coords[east.coords.length - 1], [2.002, 48]);
  assert.equal(east.endType, 'deadend');
});

test('garde-fou : un axe est coupé vers 1500 m', () => {
  const nodes: number[] = [];
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    nodes.push(1000 + i);
    pts.push([2 + i * 0.0007, 48]);
  }
  const LONG = [way(1, nodes, pts)];
  const { walked } = computeAxesFromWays(LONG, [2.00001, 48], 'car');
  const capped = walked.find((w) => w.endType === 'cap');
  assert.ok(capped, 'un axe doit être plafonné');
  assert.ok(capped.lengthMeters <= 1600 && capped.lengthMeters >= 1400, `longueur ${capped.lengthMeters}`);
});

test('rond-point : l’axe s’arrête à l’entrée du rond-point', () => {
  const RB: OverpassWay[] = [
    way(1, [1, 10], [[2, 48], [2.001, 48]]),
    way(2, [10, 11, 12, 13, 10], [[2.001, 48], [2.0012, 48.0002], [2.0014, 48], [2.0012, 47.9998], [2.001, 48]], {
      highway: 'residential',
      junction: 'roundabout',
    }),
  ];
  const { walked } = computeAxesFromWays(RB, [2.0004, 48], 'car');
  const east = walked.find((w) => w.endType === 'intersection');
  assert.ok(east);
  assert.deepEqual(east.coords[east.coords.length - 1], [2.001, 48]);
});

test('rond-point complet : un axe par branche accrochée à l’anneau, pas 2 arcs', () => {
  const CENTER: [number, number] = [2, 48];
  const n1 = destinationPoint(CENTER, 0, 20);
  const n2 = destinationPoint(CENTER, 60, 20);
  const n3 = destinationPoint(CENTER, 120, 20);
  const n4 = destinationPoint(CENTER, 180, 20);
  const n5 = destinationPoint(CENTER, 240, 20);
  const n6 = destinationPoint(CENTER, 300, 20);
  const ringTags = { highway: 'residential', junction: 'roundabout' };
  const HEX: OverpassWay[] = [
    way(100, [1, 2, 3, 4], [n1, n2, n3, n4], ringTags),
    way(101, [4, 5, 6, 1], [n4, n5, n6, n1], ringTags),
    way(1, [1, 11], [n1, destinationPoint(n1, 0, 150)]),
    way(2, [2, 12], [n2, destinationPoint(n2, 60, 150)]),
    way(4, [4, 14], [n4, destinationPoint(n4, 180, 150)]),
    way(5, [5, 15], [n5, destinationPoint(n5, 240, 150)]),
  ];
  const { axes, walked } = computeAxesFromWays(HEX, CENTER, 'car');
  assert.equal(axes.length, 4, 'un axe par branche (4), pas 2 arcs de l’anneau');
  const expectedBearings = [0, 60, 180, 240];
  const expectedOrigins = [n1, n2, n4, n5];
  axes.forEach((a, i) => {
    const diff = Math.min(Math.abs(a.bearing - expectedBearings[i]), 360 - Math.abs(a.bearing - expectedBearings[i]));
    assert.ok(diff < 15, `azimut ${a.bearing} attendu ~${expectedBearings[i]}`);
    assert.deepEqual(a.geometry.coordinates[0], expectedOrigins[i]);
  });
  assert.ok(walked.every((w) => w.endType === 'deadend'));
});

test('filtrage par icône sur un croisement route/sentier', () => {
  const MIX: OverpassWay[] = [
    way(1, [1, 100, 2], [[1.999, 48], [2, 48], [2.001, 48]]),
    way(2, [3, 100, 4], [[2, 47.999], [2, 48], [2, 48.001]], { highway: 'footway' }),
  ];
  assert.equal(computeAxesFromWays(MIX, [2, 48.00001], 'car').axes.length, 2);
  assert.equal(computeAxesFromWays(MIX, [2, 48.00001], 'person').axes.length, 4);
});

test('aucune route : résultat vide', () => {
  assert.equal(computeAxesFromWays([], [2, 48], 'car').axes.length, 0);
});

test('way dense (tracé GPS) : la géométrie renvoyée est décimée à 500 sommets max, et la liste d’axes plafonnée à 20', () => {
  const nodes: number[] = [];
  const pts: [number, number][] = [];
  for (let i = 0; i <= 550; i++) {
    nodes.push(5000 + i);
    pts.push([2 + i * 0.00002, 48]); // ~1.5 m entre sommets, ~825 m au total (< CAP_METERS)
  }
  const DENSE = [way(1, nodes, pts)];
  const { axes } = computeAxesFromWays(DENSE, [2.00001, 48], 'car');
  assert.ok(axes.length > 0, 'au moins un axe attendu');
  axes.forEach((a) => {
    assert.ok(a.geometry.coordinates.length <= 500, `${a.geometry.coordinates.length} sommets > 500`);
  });
  // Vérifie que la décimation a effectivement réduit un axe qui comptait >500 sommets bruts.
  assert.ok(axes.some((a) => a.geometry.coordinates.length === 500));
  assert.ok(axes.length <= 20);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatGridCellId,
  getZoneGridFrame,
  gridCellBounds,
  parseGridCellId,
  pickGridCell,
  type ZoneGridOrientation,
} from './zoneGeometry.js';
import type { ApiZone } from './api.js';

function squareZone(orientation: ZoneGridOrientation, rows = 4, cols = 4): ApiZone {
  // Carré ~1km de côté autour de (0, 0): à l'équateur la rotation de 45° d'un carré
  // reste un carré, ce qui rend les deux orientations directement comparables.
  const d = 0.005;
  return {
    id: 'z1',
    title: 'z',
    comment: '',
    color: '#ff0000',
    type: 'polygon',
    circle: null,
    polygon: {
      type: 'Polygon',
      coordinates: [[[-d, -d], [d, -d], [d, d], [-d, d], [-d, -d]]],
    },
    grid: { rows, cols, orientation },
    sectors: null,
  } as unknown as ApiZone;
}

test('formatGridCellId encode la convention canonique (A1 = row 0, col 0)', () => {
  assert.equal(formatGridCellId(0, 0), 'A1');
  assert.equal(formatGridCellId(2, 2), 'C3');
  assert.equal(formatGridCellId(11, 25), 'Z12');
});

test('parseGridCellId / formatGridCellId font un aller-retour', () => {
  for (let row = 0; row < 12; row++) {
    for (let col = 0; col < 26; col++) {
      const id = formatGridCellId(row, col);
      assert.deepEqual(parseGridCellId(id), { row, col });
    }
  }
});

test('parseGridCellId rejette les étiquettes hors format', () => {
  assert.equal(parseGridCellId('a1'), null);
  assert.equal(parseGridCellId('AA1'), null);
  assert.equal(parseGridCellId('A'), null);
  assert.equal(parseGridCellId('1A'), null);
  assert.equal(parseGridCellId(''), null);
});

test('une grille verticale numérote A1 au coin sud-ouest', () => {
  const frame = getZoneGridFrame(squareZone('vertical'))!;
  const a1 = gridCellBounds(frame, 0, 0)!;
  const d4 = gridCellBounds(frame, 3, 3)!;
  assert.ok(a1.center.lng < 0 && a1.center.lat < 0, 'A1 doit être au sud-ouest');
  assert.ok(d4.center.lng > 0 && d4.center.lat > 0, 'D4 doit être au nord-est');
});

test('diag45 suit la même convention que vertical (row croissant = même sens)', () => {
  const vertical = getZoneGridFrame(squareZone('vertical'))!;
  const diag = getZoneGridFrame(squareZone('diag45'))!;

  // Le long d'une colonne, la latitude doit croître avec `row` dans les deux
  // orientations: c'est exactement l'incohérence corrigée (diag45 numérotait
  // auparavant `rows - r`, donc à l'envers).
  for (const frame of [vertical, diag]) {
    let previous = -Infinity;
    for (let row = 0; row < frame.rows; row++) {
      const { center } = gridCellBounds(frame, row, 0)!;
      assert.ok(center.lat > previous, 'la latitude doit croître avec row');
      previous = center.lat;
    }
    // ...et la longitude doit croître avec `col`.
    let previousLng = -Infinity;
    for (let col = 0; col < frame.cols; col++) {
      const { center } = gridCellBounds(frame, 0, col)!;
      assert.ok(center.lng > previousLng, 'la longitude doit croître avec col');
      previousLng = center.lng;
    }
  }
});

test('la bbox diag45 d’un carré vaut sqrt(2) fois celle de vertical', () => {
  const vertical = getZoneGridFrame(squareZone('vertical'))!;
  const diag = getZoneGridFrame(squareZone('diag45'))!;
  // vertical raisonne en degrés, diag45 en mètres tournés: à l'équateur
  // 1° = 111320 m sur les deux axes, donc le rapport doit être exactement sqrt(2).
  const ratio = diag.cellU / (vertical.cellU * 111_320);
  assert.ok(Math.abs(ratio - Math.SQRT2) < 1e-9, `attendu sqrt(2), obtenu ${ratio}`);
});

test('le centre de la case centrale reste le centre de la zone (rows/cols impairs)', () => {
  for (const orientation of ['vertical', 'diag45'] as ZoneGridOrientation[]) {
    const frame = getZoneGridFrame(squareZone(orientation, 3, 3))!;
    const { center } = gridCellBounds(frame, 1, 1)!;
    assert.ok(Math.abs(center.lng) < 1e-12, `${orientation}: lng ${center.lng}`);
    assert.ok(Math.abs(center.lat) < 1e-12, `${orientation}: lat ${center.lat}`);
  }
});

test('pickGridCell est l’inverse de gridCellBounds pour les deux orientations', () => {
  for (const orientation of ['vertical', 'diag45'] as ZoneGridOrientation[]) {
    const frame = getZoneGridFrame(squareZone(orientation))!;
    for (let row = 0; row < frame.rows; row++) {
      for (let col = 0; col < frame.cols; col++) {
        const { center } = gridCellBounds(frame, row, col)!;
        assert.deepEqual(
          pickGridCell(frame, center.lng, center.lat),
          { row, col },
          `${orientation} ${formatGridCellId(row, col)}`
        );
      }
    }
  }
});

test('gridCellBounds renvoie null hors grille et un anneau fermé sinon', () => {
  const frame = getZoneGridFrame(squareZone('vertical', 3, 3))!;
  assert.equal(gridCellBounds(frame, 3, 0), null);
  assert.equal(gridCellBounds(frame, 0, -1), null);
  const ring = gridCellBounds(frame, 1, 1)!.ring;
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
});

test('getZoneGridFrame renvoie null sans grille', () => {
  const z = squareZone('vertical');
  assert.equal(getZoneGridFrame({ ...z, grid: null } as ApiZone), null);
});

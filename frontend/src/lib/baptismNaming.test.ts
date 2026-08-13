import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  angleDiffDeg,
  cardinalName,
  parseOverpassPois,
  rankAxisSuggestions,
  fallbackAxisName,
  type NamedCandidate,
} from './baptismNaming.js';

test('angleDiffDeg gère le passage par le nord', () => {
  assert.equal(angleDiffDeg(350, 10), 20);
  assert.equal(angleDiffDeg(10, 350), 20);
  assert.equal(angleDiffDeg(90, 90), 0);
  assert.equal(angleDiffDeg(0, 180), 180);
});

test('cardinalName découpe en 8 secteurs', () => {
  assert.equal(cardinalName(0), 'NORD');
  assert.equal(cardinalName(45), 'NORD-EST');
  assert.equal(cardinalName(90), 'EST');
  assert.equal(cardinalName(180), 'SUD');
  assert.equal(cardinalName(270), 'OUEST');
  assert.equal(cardinalName(337.6), 'NORD');
  assert.equal(cardinalName(292.5), 'NORD-OUEST');
});

test('rankAxisSuggestions filtre par cône ±35° et classe par niveau', () => {
  const origin: [number, number] = [2, 48];
  const candidates: NamedCandidate[] = [
    { name: 'Auchan', point: [2.005, 48.0001], tier: 1 },
    { name: 'Mairie', point: [2.004, 48.0002], tier: 2 },
    { name: 'Verneuil', point: [2.01, 48.0003], tier: 3 },
    { name: 'Hors cône', point: [2, 48.01], tier: 1 },
  ];
  const suggestions = rankAxisSuggestions(90, origin, candidates);
  assert.deepEqual(suggestions, ['AUCHAN', 'MAIRIE', 'VERNEUIL']);
});

test('rankAxisSuggestions préfère le plus proche dans un même niveau', () => {
  const origin: [number, number] = [2, 48];
  const candidates: NamedCandidate[] = [
    { name: 'Carrefour', point: [2.02, 48], tier: 1 },
    { name: 'Auchan', point: [2.005, 48], tier: 1 },
  ];
  assert.deepEqual(rankAxisSuggestions(90, origin, candidates), ['AUCHAN', 'CARREFOUR']);
});

test('parseOverpassPois classe par tags et lit le center des ways', () => {
  const json = {
    elements: [
      { type: 'node', id: 1, lat: 48.001, lon: 2.001, tags: { name: 'Auchan', shop: 'supermarket' } },
      { type: 'node', id: 2, lat: 48.002, lon: 2.002, tags: { name: 'Total', amenity: 'fuel' } },
      { type: 'way', id: 3, center: { lat: 48.003, lon: 2.003 }, tags: { name: 'Mairie', amenity: 'townhall' } },
      { type: 'node', id: 4, lat: 48.004, lon: 2.004, tags: { name: 'Verneuil', place: 'village' } },
      { type: 'node', id: 5, lat: 48.005, lon: 2.005, tags: { shop: 'bakery' } },
    ],
  };
  const c = parseOverpassPois(json);
  assert.equal(c.length, 4);
  assert.deepEqual(c.find((x) => x.name === 'Auchan')?.tier, 1);
  assert.deepEqual(c.find((x) => x.name === 'Total')?.tier, 1);
  assert.deepEqual(c.find((x) => x.name === 'Mairie')?.tier, 2);
  assert.deepEqual(c.find((x) => x.name === 'Verneuil')?.tier, 3);
  assert.deepEqual(c.find((x) => x.name === 'Mairie')?.point, [2.003, 48.003]);
});

test('fallbackAxisName : ref, puis name (débarrassé du type de voie), puis cardinal', () => {
  assert.equal(fallbackAxisName({ ref: 'D45', name: 'Rue des Lilas' }, 45), 'D45');
  assert.equal(fallbackAxisName({ name: 'Rue des Lilas' }, 45), 'LILAS');
  assert.equal(fallbackAxisName({}, 45), 'NORD-EST');
});

test('les noms trop longs sont tronqués à 40 caractères (limite backend)', () => {
  const origin: [number, number] = [2, 48];
  const candidates: NamedCandidate[] = [
    { name: 'Centre Hospitalier Universitaire de Poitiers', point: [2.005, 48.0001], tier: 1 },
  ];
  assert.deepEqual(rankAxisSuggestions(90, origin, candidates), [
    'CENTRE HOSPITALIER UNIVERSITAIRE DE POIT',
  ]);
  assert.equal(
    fallbackAxisName({ name: 'Avenue du General Leclerc de Hauteclocque' }, 45),
    'GENERAL LECLERC DE HAUTECLOCQUE'
  );
  // Un nom propre sans type de voie reste tronqué à 40 (limite backend).
  assert.equal(
    fallbackAxisName({ name: 'Lotissement Extraordinairement Long De Chez Long' }, 45),
    'LOTISSEMENT EXTRAORDINAIREMENT LONG DE C'
  );
});

test('stripRoadWords retire le type de voie et ses articles', async () => {
  const { stripRoadWords } = await import('./baptismNaming.js');
  assert.equal(stripRoadWords('Avenue du Trône'), 'TRÔNE');
  assert.equal(stripRoadWords('RUE DE LA ROQUETTE'), 'ROQUETTE');
  assert.equal(stripRoadWords('Boulevard Voltaire'), 'VOLTAIRE');
  assert.equal(stripRoadWords('Place de la Nation'), 'NATION');
  assert.equal(stripRoadWords("Avenue de l'Opéra"), 'OPÉRA');
  assert.equal(stripRoadWords('Avenue de la Grande Armée'), 'GRANDE ARMÉE');
  assert.equal(stripRoadWords('Hent Prad'), 'PRAD');
  assert.equal(stripRoadWords('Grande Armée'), 'GRANDE ARMÉE');
  assert.equal(stripRoadWords('Rue'), 'RUE');
});

test('fallbackAxisName applique stripRoadWords au nom de voie mais pas au ref', async () => {
  const { fallbackAxisName } = await import('./baptismNaming.js');
  assert.equal(fallbackAxisName({ name: 'Avenue du Trône' }, 0), 'TRÔNE');
  assert.equal(fallbackAxisName({ ref: 'D45', name: 'Rue des Lilas' }, 0), 'D45');
});

test('la voie d’origine ne baptise jamais un axe (exclusion nom + ref)', async () => {
  const { forbiddenOriginNames, fallbackAxisName, rankAxisSuggestions } = await import('./baptismNaming.js');
  const forbidden = forbiddenOriginNames({ name: 'Rue Pache', ref: 'D53' });
  assert.ok(forbidden.has('PACHE'));
  assert.ok(forbidden.has('D53'));

  // Repli : l'axe qui reste sur la voie d'origine bascule sur le cardinal…
  assert.equal(fallbackAxisName({ name: 'Rue Pache' }, 45, forbidden), 'NORD-EST');
  assert.equal(fallbackAxisName({ ref: 'D53' }, 90, forbidden), 'EST');
  // …mais une autre voie garde son nom.
  assert.equal(fallbackAxisName({ name: 'Boulevard Voltaire' }, 45, forbidden), 'VOLTAIRE');

  // Suggestions : un candidat homonyme de la voie d'origine est écarté.
  const origin = [2, 48] as [number, number];
  const candidates = [
    { name: 'Pache', point: [2.005, 48.0001] as [number, number], tier: 1 as const },
    { name: 'Auchan', point: [2.006, 48.0001] as [number, number], tier: 1 as const },
  ];
  assert.deepEqual(rankAxisSuggestions(90, origin, candidates, undefined, forbidden), ['AUCHAN']);
});

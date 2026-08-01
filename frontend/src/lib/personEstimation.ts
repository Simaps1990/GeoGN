import type { ApiPersonCase } from './api';
import {
  SimpleWeather,
  TerrainType,
  clamp,
  cleanDiseases,
  cleanInjuries,
  computeAgeFactor,
  computeDiseaseFactor,
  computeEffectiveWalkingKmh,
  computeHealthStatusFactor,
  computeIsNight,
  computeLocomotorInjuryFactor,
  computeMedicationFactor,
  computeNightFactor,
  computeSystemicInjuryFactor,
  computeTerrainFactor,
  computeWeatherFactor,
  isLocomotorLocation,
} from './estimationWalking.js';

export type EstimationResult = {
  hoursSince: number | null;
  effectiveKmh: number;
  probableKm: number;
  maxKm: number;
  risk: number;
  needs: string[];
  likelyPlaces: string[];
  reasoning: string[];
};

/**
 * Calcule en une seule passe TOUT ce que l'estimation de recherche affiche :
 * le rayon du disque tracé sur la carte (`probableKm` / `maxKm`), le score de
 * risque, les besoins, les lieux probables et le texte d'explication.
 *
 * Chacun des facteurs (âge, santé, blessures locomotrices, blessures
 * systémiques, pathologies, météo, nuit, terrain, médicaments) n'est calculé
 * qu'UNE fois ici : le texte d'explication et le rayon lisent les mêmes
 * variables locales. Ils ne peuvent donc plus diverger.
 */
export function computeEstimation(
  personCase: ApiPersonCase,
  weather: SimpleWeather | null,
  nowMs: number
): EstimationResult {
  const now = nowMs;
  const whenMs = personCase.lastKnown.when ? new Date(personCase.lastKnown.when).getTime() : NaN;
  const hoursSince = Number.isFinite(whenMs) ? Math.max(0, (now - whenMs) / 36e5) : null;

  const mobilityBaseKmh = (() => {
    switch (personCase.mobility) {
      case 'truck':
        return 40;
      case 'car':
        return 45;
      case 'motorcycle':
        return 35;
      case 'scooter':
        return 25;
      case 'bike':
        return 15;
      default:
        return 4.5;
    }
  })();

  const cleanDis = cleanDiseases(personCase.diseases ?? []);
  const cleanInj = cleanInjuries(personCase.injuries ?? []);

  // Non nul si et seulement si la mobilité est « à pied » : c'est l'unique
  // implémentation de la vitesse de marche (elle applique déjà terrain,
  // médicaments et fatigue).
  const walkingKmh = computeEffectiveWalkingKmh(
    personCase.mobility,
    personCase.age,
    personCase.healthStatus as any,
    personCase.diseases,
    personCase.injuries,
    weather,
    personCase.lastKnown.when,
    (personCase.terrain as TerrainType) ?? null,
    personCase.medications ?? [],
  );

  const ageFactor = computeAgeFactor(personCase.age);
  const healthFactor = computeHealthStatusFactor(personCase.healthStatus as any);
  const isNight = computeIsNight(personCase.lastKnown.when);
  const hasDeshydratation = cleanInj.some((inj) => inj.id === 'deshydratation');
  const hasLocomotor = cleanInj.some((inj) => inj.locations.some((loc) => isLocomotorLocation(loc)));
  const locomotorInjuryFactor = computeLocomotorInjuryFactor(cleanInj);
  const systemicInjuryFactor = computeSystemicInjuryFactor(cleanInj, weather);
  const diseaseFactor = computeDiseaseFactor(personCase.diseases, weather);
  const weatherFactor = computeWeatherFactor(weather, isNight, hasDeshydratation);
  const nightFactor = computeNightFactor(isNight, weather, hasLocomotor);
  const terrainFactor = computeTerrainFactor((personCase.terrain as TerrainType) ?? null);
  const medicationFactor = computeMedicationFactor(personCase.medications ?? []);

  const rawKmh =
    walkingKmh !== null
      ? walkingKmh
      : mobilityBaseKmh *
        ageFactor *
        healthFactor *
        systemicInjuryFactor *
        diseaseFactor *
        weatherFactor *
        nightFactor *
        terrainFactor *
        medicationFactor;

  const clampedKmh = (() => {
    const v = rawKmh;
    if (personCase.mobility === 'bike') {
      return clamp(v, 2, 25);
    }
    if (personCase.mobility !== 'none') {
      // car / motorcycle / scooter / truck
      return clamp(v, 15, 70);
    }
    return clamp(v, 0.2, 6.5);
  })();

  const effectiveHours = (() => {
    if (hoursSince === null) return 0;
    return clamp(hoursSince, 0, 72);
  })();

  const d50Km = effectiveHours === 0 ? 0 : Math.max(0, clampedKmh * effectiveHours);

  let kDisp = 2.2;
  if (hoursSince !== null) {
    const h = clamp(hoursSince, 0, 24);
    kDisp += Math.min(1.4, Math.log1p(h) / 1.2);
  }
  if (isNight) kDisp += 0.1;
  kDisp = clamp(kDisp, 1.6, 4.2);

  const radiusCapKm = personCase.mobility === 'none' ? 50
    : personCase.mobility === 'bike' ? 100
    : 300; // car/motorcycle/scooter/truck
  const probableKm = Math.min(d50Km, radiusCapKm);
  const maxKm = Math.min(d50Km * kDisp, radiusCapKm);

  const risk = (() => {
    let s = 0;
    if (personCase.healthStatus === 'fragile') s += 1;
    if (personCase.healthStatus === 'critique') s += 2;

    const locomotorFracture = cleanInj.some(
      (inj) => inj.id === 'fracture' && inj.locations.some((loc) => isLocomotorLocation(loc))
    );
    if (locomotorFracture) s += 2;

    if (diseaseFactor <= 0.75) s += 1;

    const t = weather?.temperatureC;
    if (typeof t === 'number' && t <= 5) s += 1;
    const r = weather?.precipitationMm;
    if (typeof r === 'number' && r >= 2) s += 1;

    const hasHypothermie = cleanInj.some((inj) => inj.id === 'hypothermie');
    if (hasHypothermie) s += 1;
    const hasDeshydratationNeed = cleanInj.some((inj) => inj.id === 'deshydratation');
    if (hasDeshydratationNeed) s += 1;

    return s;
  })();

  const needs: string[] = [];
  if (weather && typeof weather.temperatureC === 'number' && weather.temperatureC <= 5) {
    needs.push('Se protéger du froid (abri, vêtements secs)');
  }
  if (weather && typeof weather.precipitationMm === 'number' && weather.precipitationMm >= 2) {
    needs.push('Trouver un abri / se mettre au sec');
  }
  if (cleanInj.some((x) => x.id === 'deshydratation')) {
    needs.push('Hydratation urgente');
  }
  if (cleanInj.some((x) => x.id === 'hypothermie')) {
    needs.push('Réchauffement progressif + abri');
  }
  const locomotorFracture = cleanInj.some(
    (inj) => inj.id === 'fracture' && inj.locations.some((loc) => isLocomotorLocation(loc))
  );
  if (locomotorFracture) {
    needs.push('Limiter les déplacements (douleur/immobilisation)');
  }
  if (cleanDis.includes('diabete')) {
    needs.push('Sucre/prise alimentaire régulière');
  }
  if (cleanDis.includes('asthme')) {
    needs.push('Éviter effort + air froid/humide');
  }

  const likelyPlaces: string[] = [];
  likelyPlaces.push('Abris proches (bâtiments, hangars, porches, arrêts)');
  if (risk >= 3) {
    likelyPlaces.push('Points d’aide (pharmacie, médecin, pompiers, commerces)');
  }
  if (weather && typeof weather.precipitationMm === 'number' && weather.precipitationMm >= 2) {
    likelyPlaces.push('Zones couvertes (centres commerciaux, parkings couverts)');
  }
  if (cleanInj.some((x) => x.id === 'deshydratation')) {
    likelyPlaces.push('Points d’eau / commerces (si déshydratation / chaleur)');
  }

  const reasoning: string[] = [];
  reasoning.push(
    `Mobilité: ${personCase.mobility} (base ~${mobilityBaseKmh.toFixed(0)} km/h) x âge ${(ageFactor * 100).toFixed(
      0
    )}% x santé ${(healthFactor * 100).toFixed(0)}% x blessures locomotrices ${(
      locomotorInjuryFactor * 100
    ).toFixed(0)}% x pathologies ${(diseaseFactor * 100).toFixed(
      0
    )}% x météo+nuit ${(weatherFactor * nightFactor * 100).toFixed(0)}% → ~${clampedKmh.toFixed(1)} km/h.`
  );
  if (hoursSince === null) {
    reasoning.push(
      'Heure du dernier indice inconnue : distance non fiable (temps de marche nul).'
    );
  } else {
    reasoning.push(
      `Temps depuis le dernier indice: ${hoursSince.toFixed(
        1
      )} h → temps de marche effectif estimé ~${effectiveHours.toFixed(1)} h (pauses + fatigue).`
    );
  }
  if (personCase.mobility !== 'none' && personCase.mobility !== 'bike') {
    reasoning.push(
      "Attention: mode motorisé sans routage (OSRM / GraphHopper) – distance estimée très grossière à vol d'oiseau."
    );
  }
  if (weather && typeof weather.temperatureC === 'number') {
    reasoning.push(
      `Météo: ${weather.temperatureC.toFixed(1)}°C, vent ${weather.windSpeedKmh ?? '—'} km/h, pluie ${
        weather.precipitationMm ?? '—'
      } mm.`
    );
  }

  const effectiveKmh = clampedKmh;

  return {
    hoursSince,
    effectiveKmh,
    probableKm,
    maxKm,
    risk,
    needs,
    likelyPlaces,
    reasoning,
  };
}

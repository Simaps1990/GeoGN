export type DiseaseId =
  | 'diabete'
  | 'cardiaque'
  | 'asthme'
  | 'parkinson'
  | 'insuffisance_respiratoire'
  | 'insuffisance_renale'
  | 'grossesse'
  | 'handicap_moteur'
  | 'alzheimer';

export type TerrainType = 'route' | 'foret' | 'montagne' | 'marais';

export type MedicationType = 'anxiolytique' | 'opioid' | 'alcool';

export type InjuryId =
  | 'fracture'
  | 'entorse'
  | 'luxation'
  | 'plaie'
  | 'brulure'
  | 'hematome'
  | 'hypothermie'
  | 'deshydratation';

export type BodyPartId =
  | 'head'
  | 'face'
  | 'neck'
  | 'chest'
  | 'back'
  | 'abdomen'
  | 'pelvis'
  | 'left_arm'
  | 'right_arm'
  | 'left_hand'
  | 'right_hand'
  | 'left_leg'
  | 'right_leg'
  | 'left_foot'
  | 'right_foot';

export type HealthStatus = 'stable' | 'fragile' | 'critique';

export interface PersonInjury {
  id: string;
  locations: string[];
}

export interface SimpleWeather {
  temperatureC?: number | null;
  windSpeedKmh?: number | null;
  precipitationMm?: number | null;
  snowy?: boolean | null;
  icy?: boolean | null;
  foggy?: boolean | null;
}

export const FACTOR_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  age: {
    label: 'Âge',
    description:
      "L'âge influence la vitesse de marche naturelle. Un adulte actif (20-39 ans) marche à ~4,5 km/h. Un enfant de moins de 6 ans ou une personne de 80 ans et plus marche significativement moins vite.",
  },
  sex: {
    label: 'Sexe',
    description:
      "Le sexe est enregistré pour le dossier mais n'influence pas directement le calcul de vitesse dans ce modèle.",
  },
  healthStatus: {
    label: 'État de santé',
    description:
      "L'état général de la personne. « Fragile » réduit la vitesse de 15% (personne affaiblie, épuisée). « Critique » la réduit de 30% (personne en très mauvais état physique ou psychologique).",
  },
  diseases: {
    label: 'Maladies connues',
    description:
      "Certaines pathologies ralentissent le déplacement. Parkinson ou un handicap moteur peuvent réduire la vitesse jusqu'à 40%. Alzheimer : en plus d'un ralentissement (-25%), la personne tend à longer des limites (murs, chemins, cours d'eau) et à tourner en rond plutôt qu'à s'éloigner en ligne droite.",
  },
  injuries: {
    label: 'Blessures',
    description:
      "Les blessures aux jambes, pieds et bassin ralentissent directement la marche. Une fracture réduit la vitesse à ~40% du normal. Une plaie en zone locomotrice à ~93%. Les blessures aux bras, à la tête ou au torse n'affectent pas la locomotion directement.",
  },
  weather: {
    label: 'Météo',
    description:
      "La météo au dernier point connu. Froid + pluie + vent la nuit réduit la vitesse à 60%. La neige réduit à 55%, le verglas à 35%. La chaleur forte avec déshydratation réduit à 60%. Le brouillard ajoute une réduction de 30% par manque de visibilité.",
  },
  terrain: {
    label: 'Terrain',
    description:
      "Le type de terrain change radicalement la vitesse effective. En forêt dense ou en relief accidenté, la vitesse réelle est réduite de 30%. En montagne ou terrain très dense, de 50%. Dans les marais ou zones inondées, la progression est réduite à 35% de la vitesse normale.",
  },
  night: {
    label: 'Nuit',
    description:
      "Calculée automatiquement selon l'heure du dernier point connu (varie selon la saison). La nuit réduit la vitesse de 15 à 25%, davantage si la personne est blessée aux jambes ou par mauvais temps.",
  },
  fatigue: {
    label: 'Fatigue cumulée',
    description:
      "Calculée automatiquement selon le temps écoulé depuis la disparition. Après 4h de marche estimée, le rythme ralentit de 20%. Après 8h, de 35%. La fatigue ne s'applique qu'à la marche à pied.",
  },
  medications: {
    label: 'Médicaments / substances',
    description:
      "Les anxiolytiques (Lexomil, Xanax…) réduisent la vitesse de 30%, les opioïdes (morphine, codéine…) de 45%, l'alcool de 35%. Ces substances altèrent la coordination, les réflexes et le jugement, et peuvent modifier le comportement de déplacement.",
  },
};

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function computeIsNight(lastKnownWhen: string | null): boolean {
  if (!lastKnownWhen) return false;
  const d = new Date(lastKnownWhen);
  if (Number.isNaN(d.getTime())) return false;
  const h = d.getHours();
  const m = d.getMonth();

  if (m === 10 || m === 11 || m === 0 || m === 1) {
    return h >= 18 || h < 7;
  }
  if (m === 4 || m === 5 || m === 6 || m === 7) {
    return h >= 22 || h < 6;
  }
  return h >= 21 || h < 6;
}

export function computeAgeFactor(age: number | null): number {
  if (age == null || !Number.isFinite(age)) return 1;
  const table = [
    { min: 0, max: 5, factor: 0.6 },
    { min: 6, max: 12, factor: 0.7 },
    { min: 13, max: 15, factor: 0.85 },
    { min: 16, max: 19, factor: 0.95 },
    { min: 20, max: 39, factor: 1 },
    { min: 40, max: 49, factor: 0.98 },
    { min: 50, max: 59, factor: 0.92 },
    { min: 60, max: 69, factor: 0.85 },
    { min: 70, max: 79, factor: 0.78 },
    { min: 80, max: 89, factor: 0.68 },
    { min: 90, max: 120, factor: 0.55 },
  ];
  const row = table.find((r) => age >= r.min && age <= r.max);
  return row ? row.factor : 1;
}

export function computeHealthStatusFactor(healthStatus: HealthStatus | null | undefined): number {
  switch (healthStatus) {
    case 'fragile':
      return 0.85;
    case 'critique':
      return 0.7;
    case 'stable':
    default:
      return 1;
  }
}

export function isLocomotorLocation(loc: string): boolean {
  const locomotor: BodyPartId[] = ['left_leg', 'right_leg', 'left_foot', 'right_foot', 'pelvis'];
  return locomotor.includes(loc as BodyPartId);
}

export function cleanDiseases(diseases: string[] | null | undefined): DiseaseId[] {
  const allowed: DiseaseId[] = [
    'diabete',
    'cardiaque',
    'asthme',
    'parkinson',
    'insuffisance_respiratoire',
    'insuffisance_renale',
    'grossesse',
    'handicap_moteur',
    'alzheimer',
  ];
  if (!Array.isArray(diseases)) return [];
  return diseases.filter((id): id is DiseaseId => allowed.includes(id as DiseaseId));
}

export function cleanInjuries(injuries: PersonInjury[] | null | undefined): { id: InjuryId; locations: BodyPartId[] }[] {
  const allowedIds: InjuryId[] = [
    'fracture',
    'entorse',
    'luxation',
    'plaie',
    'brulure',
    'hematome',
    'hypothermie',
    'deshydratation',
  ];
  if (!Array.isArray(injuries)) return [];
  return injuries
    .filter((inj) => allowedIds.includes(inj.id as InjuryId))
    .map((inj) => ({
      id: inj.id as InjuryId,
      locations: Array.isArray(inj.locations)
        ? (inj.locations.filter((loc): loc is BodyPartId =>
            [
              'head',
              'face',
              'neck',
              'chest',
              'back',
              'abdomen',
              'pelvis',
              'left_arm',
              'right_arm',
              'left_hand',
              'right_hand',
              'left_leg',
              'right_leg',
              'left_foot',
              'right_foot',
            ].includes(loc as BodyPartId)
          ) as BodyPartId[])
        : [],
    }));
}

export function computeLocomotorInjuryFactor(
  injuries: { id: InjuryId; locations: BodyPartId[] }[]
): number {
  if (!Array.isArray(injuries) || injuries.length === 0) return 1;

  const factors: number[] = [];

  for (const inj of injuries) {
    const hasLocomotor = inj.locations.some(isLocomotorLocation);
    if (!hasLocomotor) continue;

    switch (inj.id) {
      case 'fracture':
        factors.push(0.4);
        break;
      case 'plaie':
        factors.push(0.93);
        break;
      default:
        break;
    }
  }

  if (!factors.length) return 1;

  const minF = Math.min(...factors);
  const n = factors.length;
  const combined = minF * Math.pow(0.95, n - 1);
  return clamp(combined, 0.2, 1);
}

export function computeDiseaseFactor(diseases: string[] | null | undefined, weather: SimpleWeather | null): number {
  const ids = cleanDiseases(diseases || []);
  if (!ids.length) return 1;

  const t = typeof weather?.temperatureC === 'number' ? weather!.temperatureC! : null;
  const r = typeof weather?.precipitationMm === 'number' ? weather!.precipitationMm! : null;

  const mapBase: Record<DiseaseId, number> = {
    diabete: 0.9,
    cardiaque: 0.75,
    asthme: 0.9,
    parkinson: 0.6,
    insuffisance_respiratoire: 0.6,
    insuffisance_renale: 0.9,
    grossesse: 0.9,
    handicap_moteur: 0.6,
    alzheimer: 0.75,
  };

  const factors: number[] = [];
  for (const id of ids) {
    let f = mapBase[id];
    if (id === 'asthme') {
      const cold = t !== null && t <= 10;
      const rain = r !== null && r > 0;
      if (cold || rain) {
        f = 0.75;
      }
    }
    factors.push(f);
  }

  if (!factors.length) return 1;

  const minF = Math.min(...factors);
  const n = factors.length;
  const combined = minF * Math.pow(0.97, n - 1);
  return clamp(combined, 0.35, 1);
}

export function computeWeatherFactor(
  weather: SimpleWeather | null,
  isNight: boolean,
  hasDeshydratation: boolean
): number {
  if (!weather) return 1;

  // Verglas et neige priment sur toute autre condition thermique
  if (weather.icy) return clamp(0.35 * (weather.foggy ? 0.7 : 1), 0.2, 1);
  if (weather.snowy) return clamp(0.55 * (weather.foggy ? 0.7 : 1), 0.2, 1);

  const t = weather.temperatureC;
  const w = weather.windSpeedKmh;
  const r = weather.precipitationMm;

  let factor = 1;

  if (typeof t === 'number') {
    if (t <= 10) {
      const rain = typeof r === 'number' && r > 0;
      const windy = typeof w === 'number' && w >= 25;
      if (rain && windy && isNight) factor = 0.6;
      else if (rain && windy) factor = 0.75;
      else if (rain || windy) factor = 0.9;
    } else if (t >= 32) {
      factor = hasDeshydratation ? 0.6 : 0.88;
    }
    // 26-32°C sans déshydratation : facteur 1.0 (corrigé depuis 0.9)
  }

  // Brouillard : réduction de visibilité supplémentaire
  if (weather.foggy) factor *= 0.7;

  return clamp(factor, 0.2, 1);
}

export function computeNightFactor(
  isNight: boolean,
  weather: SimpleWeather | null,
  hasLocomotorInjury: boolean
): number {
  if (!isNight) return 1;
  const r = weather?.precipitationMm;
  let f = typeof r === 'number' && r > 0 ? 0.75 : 0.85;
  if (hasLocomotorInjury) f *= 0.9;
  return f;
}

export function computeTerrainFactor(terrain: TerrainType | null | undefined): number {
  switch (terrain) {
    case 'route':
    case null:
    case undefined:
      return 1.0;
    case 'foret':
      return 0.7;
    case 'montagne':
      return 0.5;
    case 'marais':
      return 0.35;
    default:
      return 1.0;
  }
}

export function computeFatigueFactor(elapsedHours: number | null | undefined): number {
  if (elapsedHours == null || !Number.isFinite(elapsedHours) || elapsedHours < 4) return 1;
  if (elapsedHours < 8) return 0.8;
  return 0.65;
}

export function computeMedicationFactor(medications: string[] | null | undefined): number {
  if (!Array.isArray(medications) || medications.length === 0) return 1;

  const factors: Record<MedicationType, number> = {
    anxiolytique: 0.7,
    opioid: 0.55,
    alcool: 0.65,
  };

  const vals = medications
    .filter((m): m is MedicationType => m in factors)
    .map((m) => factors[m]);

  if (!vals.length) return 1;
  return Math.min(...vals);
}

export function computeEffectiveWalkingKmh(
  mobility: 'none' | 'bike' | 'scooter' | 'motorcycle' | 'car',
  age: number | null,
  healthStatus: HealthStatus | null | undefined,
  diseases: string[] | null | undefined,
  injuries: PersonInjury[] | null | undefined,
  weather: SimpleWeather | null,
  lastKnownWhen: string | null,
  terrain?: TerrainType | null,
  medications?: string[] | null,
): number | null {
  if (mobility !== 'none') return null;

  const baseWalkingKmh = 4.5;
  const isNight = computeIsNight(lastKnownWhen);

  const ageFactor = computeAgeFactor(age);
  const healthFactor = computeHealthStatusFactor(healthStatus);
  const cleanInjs = cleanInjuries(injuries);
  const locomotorFactor = computeLocomotorInjuryFactor(cleanInjs);
  const diseaseFactor = computeDiseaseFactor(diseases, weather);

  const hasDeshydratation = cleanInjs.some((inj) => inj.id === 'deshydratation');
  const hasLocomotorInjury = cleanInjs.some((inj) => inj.locations.some(isLocomotorLocation));

  const weatherFactor = computeWeatherFactor(weather, isNight, hasDeshydratation);
  const nightFactor = computeNightFactor(isNight, weather, hasLocomotorInjury);
  const terrainFactor = computeTerrainFactor(terrain ?? null);
  const medicationFactor = computeMedicationFactor(medications ?? []);

  const elapsedHours = lastKnownWhen
    ? (Date.now() - new Date(lastKnownWhen).getTime()) / 3_600_000
    : null;
  const fatigueFactor = computeFatigueFactor(elapsedHours);

  const raw =
    baseWalkingKmh *
    ageFactor *
    healthFactor *
    locomotorFactor *
    diseaseFactor *
    weatherFactor *
    nightFactor *
    terrainFactor *
    medicationFactor *
    fatigueFactor;

  return clamp(raw, 0.2, 6.5);
}

export type DiseaseId =
  | 'diabete'
  | 'cardiaque'
  | 'asthme'
  | 'parkinson'
  | 'insuffisance_respiratoire'
  | 'insuffisance_renale'
  | 'grossesse'
  | 'handicap_moteur';

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
}

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
    { min: 0, max: 5, factor: 0.45 },
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
        factors.push(0.8);
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
  const t = weather.temperatureC;
  const w = weather.windSpeedKmh;
  const r = weather.precipitationMm;

  if (typeof t !== 'number') return 1;

  if (t <= 10) {
    const rain = typeof r === 'number' && r > 0;
    const windy = typeof w === 'number' && w >= 25;
    if (!rain && !windy) return 1;
    if ((rain && !windy) || (!rain && windy)) return 0.9;
    if (rain && windy && !isNight) return 0.75;
    if (rain && windy && isNight) return 0.6;
    return 0.9;
  }

  if (t >= 26) {
    if (t < 32) return 0.9;
    if (t >= 32 && hasDeshydratation) return 0.6;
    return 0.75;
  }

  return 1;
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

export function computeEffectiveWalkingKmh(
  mobility: 'none' | 'bike' | 'scooter' | 'motorcycle' | 'car',
  age: number | null,
  healthStatus: HealthStatus | null | undefined,
  diseases: string[] | null | undefined,
  injuries: PersonInjury[] | null | undefined,
  weather: SimpleWeather | null,
  lastKnownWhen: string | null
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

  const raw =
    baseWalkingKmh *
    ageFactor *
    healthFactor *
    locomotorFactor *
    diseaseFactor *
    weatherFactor *
    nightFactor;

  return clamp(raw, 0.2, 6.5);
}

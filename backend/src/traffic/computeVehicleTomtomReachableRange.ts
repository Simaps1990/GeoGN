import type { FeatureCollection, Polygon } from 'geojson';
import { getTomtomApiKey, getTomtomBaseUrl, isTomtomEnabled } from './trafficConfig.js';
import type { VehicleTrackVehicleType } from '../models/vehicleTrack.js';

type TravelMode = 'car' | 'truck' | 'motorcycle' | string;

// Cache en mémoire : évite de retenter à chaque cycle un travelMode non supporté
// (souvent la cause des "2 requêtes" par isochrone quand on fait un fallback).
// Clé = profil logique (ex: scooter, truck, bike) ; valeur = modes rejetés.
const unsupportedTravelModesByProfile = new Map<string, Set<string>>();

export interface ComputeVehicleTomtomReachableRangeInput {
  lng?: number;
  lat?: number;
  elapsedSeconds: number;
  vehicleType: VehicleTrackVehicleType | string;
  maxBudgetSeconds?: number;
  label?: string;
}

function vehicleProfileKey(input: { vehicleType: VehicleTrackVehicleType | string; label?: string }): string {
  const label = typeof input.label === 'string' ? input.label : '';
  const isBike = /\bvelo\b|\bv[ée]lo\b/i.test(label);
  if (isBike) return 'bike';
  return String(input.vehicleType || 'unknown');
}

export interface ComputeVehicleTomtomReachableRangeResult {
  geojson: FeatureCollection;
  meta: any;
  budgetSec: number;
}

function clampBudget(elapsedSeconds: number, maxBudgetSeconds: number | undefined): number {
  const max = Number.isFinite(maxBudgetSeconds) && (maxBudgetSeconds as number) > 0 ? (maxBudgetSeconds as number) : 7200;
  const clampedElapsed = Math.max(0, Math.min(max, elapsedSeconds));
  return Math.max(1, clampedElapsed);
}

function clampBudgetFloor(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.max(1, Math.floor(seconds));
}

function computeBudgetForMode(args: {
  vehicleType: VehicleTrackVehicleType | string;
  baseBudgetSec: number;
  travelMode: string;
  label?: string;
}): { budgetSec: number; factor: number } {
  // Ajustements "métier" demandés :
  // - scooter : on tente motorcycle mais on réduit la portée via un facteur.
  // - truck : si fallback en car, on réduit aussi.
  // NB: ces facteurs sont volontairement simples et pourront être paramétrés plus tard.

  const vt = args.vehicleType;
  const mode = args.travelMode;
  const label = typeof args.label === 'string' ? args.label : '';
  const isBike = /\bvelo\b|\bv[ée]lo\b/i.test(label);

  if (isBike) {
    // Vélo TEST : on passe par motorcycle si possible, mais avec un facteur fort.
    // Si on tombe sur car (fallback), on réduit encore.
    const factor = mode === 'motorcycle' ? 0.45 : mode === 'car' ? 0.4 : 0.45;
    return { budgetSec: clampBudgetFloor(args.baseBudgetSec * factor), factor };
  }

  if (vt === 'scooter') {
    // scooter est plus lent qu'une moto/voiture.
    // - si on est en motorcycle (fallback), on réduit un peu.
    // - si on est en car (fallback ultime), on réduit davantage.
    const factor = mode === 'motorcycle' ? 0.7 : mode === 'car' ? 0.6 : 0.7;
    return { budgetSec: clampBudgetFloor(args.baseBudgetSec * factor), factor };
  }

  if (vt === 'truck' && mode === 'car') {
    // truck en mode car (fallback) : réduire la portée
    const factor = 0.85;
    return { budgetSec: clampBudgetFloor(args.baseBudgetSec * factor), factor };
  }

  return { budgetSec: clampBudgetFloor(args.baseBudgetSec), factor: 1 };
}

function toTomtomTravelModeCandidates(vehicleType: VehicleTrackVehicleType | string): string[] {
  switch (vehicleType) {
    case 'truck':
      return ['truck', 'car'];
    case 'motorcycle':
      // Certaines offres TomTom supportent "motorcycle". On tente d'abord,
      // puis fallback "car" si rejeté.
      return ['motorcycle', 'car'];
    case 'scooter':
      // Pas de mode dédié scooter : tenter motorcycle si dispo, sinon car.
      return ['motorcycle', 'car'];
    case 'car':
    default:
      return ['car'];
  }
}

export async function computeVehicleTomtomReachableRange(
  input: ComputeVehicleTomtomReachableRangeInput
): Promise<ComputeVehicleTomtomReachableRangeResult> {
  const { lng, lat } = input;

  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { provider: 'tomtom_reachable_range', reason: 'MISSING_COORDS' },
      budgetSec: 0,
    };
  }

  if (!isTomtomEnabled()) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { provider: 'tomtom_reachable_range', reason: 'TOMTOM_DISABLED' },
      budgetSec: 0,
    };
  }

  const apiKey = getTomtomApiKey();
  const baseUrl = getTomtomBaseUrl();

  if (!apiKey || !baseUrl) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { provider: 'tomtom_reachable_range', reason: 'MISSING_CONFIG' },
      budgetSec: 0,
    };
  }

  const budgetSec = clampBudget(input.elapsedSeconds, input.maxBudgetSeconds);

  const candidates = toTomtomTravelModeCandidates(input.vehicleType);
  const profileKey = vehicleProfileKey({ vehicleType: input.vehicleType, label: input.label });
  const rejected = unsupportedTravelModesByProfile.get(profileKey) ?? new Set<string>();

  const timeoutMs = (() => {
    const raw = process.env.TOMTOM_TIMEOUT_MS;
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n > 0) return Math.max(500, Math.min(30_000, Math.floor(n)));
    return 10_000;
  })();

  const trafficParam = (() => {
    const raw = (process.env.TOMTOM_TRAFFIC ?? '').toLowerCase();
    if (raw === 'false' || raw === '0' || raw === 'no') return 'false';
    if (raw === 'true' || raw === '1' || raw === 'yes') return 'true';
    return 'true';
  })();

  const fetchWithTimeout = async (url: string, timeoutMs: number) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  };

  try {
    let chosenMode: string | null = null;
    let chosenData: any = null;
    let lastHttpStatus: number | null = null;

    for (const travelMode of candidates) {
      if (rejected.has(travelMode)) {
        continue;
      }
      const scaled = computeBudgetForMode({
        vehicleType: input.vehicleType,
        baseBudgetSec: budgetSec,
        travelMode,
        label: input.label,
      });
      const url = new URL(
        '/routing/1/calculateReachableRange/' + encodeURIComponent(`${lat},${lng}`) + '/json',
        baseUrl
      );
      url.searchParams.set('key', apiKey);
      url.searchParams.set('timeBudgetInSec', String(scaled.budgetSec));
      url.searchParams.set('traffic', trafficParam);
      url.searchParams.set('routeType', 'fastest');
      url.searchParams.set('travelMode', travelMode);

      const res = await fetchWithTimeout(url.toString(), timeoutMs);
      lastHttpStatus = res.status;
      if (!res.ok) {
        // Si le mode est rejeté, on tente un fallback.
        if (candidates.length > 1 && (res.status === 400 || res.status === 403)) {
          rejected.add(travelMode);
          unsupportedTravelModesByProfile.set(profileKey, rejected);
          continue;
        }
        break;
      }

      chosenMode = travelMode;
      // on mémorise aussi le budget réellement envoyé
      // (utile pour l'historique et pour comprendre l'effet des facteurs).
      const raw = await res.json();
      // Stocker dans un wrapper pour récupérer plus bas.
      chosenData = { raw, appliedBudgetSec: scaled.budgetSec, appliedFactor: scaled.factor };
      break;
    }

    if (!chosenMode || !chosenData) {
      return {
        geojson: { type: 'FeatureCollection', features: [] },
        meta: {
          provider: 'tomtom_reachable_range',
          reason: 'HTTP_' + String(lastHttpStatus ?? 'UNKNOWN'),
          travelModeCandidates: candidates,
        },
        budgetSec,
      };
    }

    const data: any = chosenData?.raw;
    const appliedBudgetSec: number = typeof chosenData?.appliedBudgetSec === 'number' ? chosenData.appliedBudgetSec : budgetSec;
    const appliedFactor: number = typeof chosenData?.appliedFactor === 'number' ? chosenData.appliedFactor : 1;
    const boundary = data?.reachableRange?.boundary as { latitude: number; longitude: number }[] | undefined;
    const center = data?.reachableRange?.center as { latitude: number; longitude: number } | undefined;

    if (!Array.isArray(boundary) || boundary.length < 3) {
      return {
        geojson: { type: 'FeatureCollection', features: [] },
        meta: { provider: 'tomtom_reachable_range', reason: 'EMPTY_BOUNDARY', raw: data },
        budgetSec,
      };
    }

    const ring: [number, number][] = boundary.map((p) => [p.longitude, p.latitude]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }

    const polygon: Polygon = {
      type: 'Polygon',
      coordinates: [ring],
    };

    const geojson: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            provider: 'tomtom',
            mode: 'reachable_range',
            budgetSec: appliedBudgetSec,
            center: center
              ? { lng: center.longitude, lat: center.latitude }
              : { lng, lat },
          },
          geometry: polygon,
        },
      ],
    };

    return {
      geojson,
      meta: {
        provider: 'tomtom_reachable_range',
        travelMode: chosenMode,
        warning: chosenMode !== candidates[0] ? `travelMode fallback: ${candidates[0]} -> ${chosenMode}` : undefined,
        budget: {
          baseBudgetSec: budgetSec,
          appliedBudgetSec,
          factor: appliedFactor,
        },
        raw: data,
      },
      budgetSec: appliedBudgetSec,
    };
  } catch (e: any) {
    return {
      geojson: { type: 'FeatureCollection', features: [] },
      meta: { provider: 'tomtom_reachable_range', reason: 'ERROR', error: e?.message ?? String(e) },
      budgetSec,
    };
  }
}

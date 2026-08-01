import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMapInstance } from 'maplibre-gl';
import { getSocket } from '../lib/socket';
import {
  deletePersonCase,
  getPersonCase,
  type ApiMission,
  type ApiPersonCase,
  type ApiPoi,
} from '../lib/api';
import { DiseaseId, InjuryId, SimpleWeather, TerrainType } from '../lib/estimationWalking';
import { computeEstimation, type EstimationResult } from '../lib/personEstimation.js';

export type { EstimationResult };

/**
 * Le formulaire manipule directement les valeurs de `personCase.mobility` : chaque
 * choix de l'UI a désormais son équivalent 1:1 côté modèle (y compris 'truck'), et
 * `vehicleType` de la piste porte le même nom. L'ancien vocabulaire UI suffixé
 * `_test` (car_test, truck_test, …) n'existe plus : il ne servait qu'à ce mapping,
 * la cadence rapide du scheduler venant, elle, de `algorithm: 'road_graph'`.
 */
export function mobilityLabel(m: ApiPersonCase['mobility']) {
  switch (m) {
    case 'none':
      return 'À pied';
    case 'bike':
      return 'Vélo';
    case 'scooter':
      return 'Scooter';
    case 'motorcycle':
      return 'Moto';
    case 'car':
      return 'Voiture';
    case 'truck':
      return 'Camion';
    default:
      return 'Inconnu';
  }
}

export function sexLabel(s: ApiPersonCase['sex']) {
  if (s === 'female') return 'Femme';
  if (s === 'male') return 'Homme';
  return 'Inconnu';
}

export function weatherStatusLabel(code: number | null | undefined) {
  if (typeof code !== 'number') return 'Indisponible';
  if (code === 0) return 'Ensoleillé';
  if (code === 1) return 'Peu nuageux';
  if (code === 2) return 'Nuageux';
  if (code === 3) return 'Couvert';
  if (code === 45 || code === 48) return 'Brouillard';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Bruine';
  if ([61, 63, 65, 66, 67].includes(code)) return 'Pluie';
  if ([71, 73, 75, 77].includes(code)) return 'Neige';
  if ([80, 81, 82].includes(code)) return 'Averses';
  if ([85, 86].includes(code)) return 'Averses de neige';
  if (code === 95) return 'Orage';
  if (code === 96 || code === 99) return 'Orage (grêle)';
  return 'Météo variable';
}

export function formatHoursToHM(hours: number) {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m} min`;
  if (m <= 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function formatElapsedSince(iso: string | null | undefined): string {
  try {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const now = Date.now();
    let diffMs = now - t;
    if (diffMs < 0) diffMs = 0;
    const totalMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0 && minutes <= 0) return "il y a moins d'une minute";
    if (hours <= 0) return `il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
    if (minutes <= 0) return `il y a ${hours} heure${hours > 1 ? 's' : ''}`;
    return `il y a ${hours} heure${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`;
  } catch {
    return '';
  }
}

export type PersonDraft = {
  lastKnownQuery: string;
  lastKnownType: 'address' | 'poi';
  lastKnownPoiId?: string;
  lastKnownLng?: number;
  lastKnownLat?: number;
  lastKnownWhen: string;
  mobility: ApiPersonCase['mobility'];
  age: string;
  sex: 'unknown' | 'female' | 'male';
  healthStatus: 'stable' | 'fragile' | 'critique';
  diseases: string[];
  diseasesFreeText: string;
  injuries: { id: string; locations: string[] }[];
  injuriesFreeText: string;
  terrain: TerrainType;
  medications: string[];
};

/**
 * Unique initialisation d'un formulaire de fiche vide. Elle était recopiée à
 * l'identique à trois endroits (état initial, suppression de fiche, ouverture
 * du panneau sans fiche existante) : ajouter un champ en oubliait fatalement un.
 * Fabrique (et non constante partagée) pour que chaque reset reparte sur ses
 * propres tableaux.
 */
export function createEmptyPersonDraft(): PersonDraft {
  return {
    lastKnownQuery: '',
    lastKnownType: 'address',
    lastKnownPoiId: undefined,
    lastKnownLng: undefined,
    lastKnownLat: undefined,
    lastKnownWhen: '',
    mobility: 'none',
    age: '',
    sex: 'unknown',
    healthStatus: 'stable',
    diseases: [],
    diseasesFreeText: '',
    injuries: [],
    injuriesFreeText: '',
    terrain: 'route',
    medications: [],
  };
}

export type PersonWeather = {
  temperatureC: number | null;
  windSpeedKmh: number | null;
  precipitationMm: number | null;
  weatherCode: number | null;
  when: string;
  source: string;
};

export type UsePersonCaseParams = {
  mapInstanceRef: React.MutableRefObject<MapLibreMapInstance | null>;
  mapReady: boolean;
  styleVersion: number;
  selectedMissionId: string | null;
  mission: ApiMission | null;
  canEditPerson: boolean;
  /** POI de la mission : alimentent l'autocomplétion « dernière position connue ». */
  pois: ApiPoi[];
  /** Fourni par useVehicleTrack : la suppression d'une fiche purge aussi les pistes. */
  deleteAllVehicleTracks: (missionId: string) => Promise<void>;
  setActivityToast: (msg: string) => void;
  currentUserId: string | null;
  buildUserDisplayName: (userId: string) => string;
};

export function usePersonCase({
  mapInstanceRef,
  mapReady,
  styleVersion,
  selectedMissionId,
  mission,
  canEditPerson,
  pois,
  deleteAllVehicleTracks,
  setActivityToast,
  currentUserId,
  buildUserDisplayName,
}: UsePersonCaseParams) {
  const [personPanelOpen, setPersonPanelOpen] = useState(false);
  const [personPanelCollapsed, setPersonPanelCollapsed] = useState(false);
  const [personLoading, setPersonLoading] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);
  const [personCase, setPersonCase] = useState<ApiPersonCase | null>(null);
  const [personEdit, setPersonEdit] = useState(false);
  const [confirmDeletePersonCaseOpen, setConfirmDeletePersonCaseOpen] = useState(false);
  const [estimationNowMs, setEstimationNowMs] = useState<number>(() => Date.now());

  const onConfirmDeletePersonCase = async () => {
    if (!selectedMissionId || !personCase) return;
    setConfirmDeletePersonCaseOpen(false);
    setPersonLoading(true);
    setPersonError(null);
    try {
      await deletePersonCase(selectedMissionId);

      await deleteAllVehicleTracks(selectedMissionId);
      setPersonCase(null);
      setPersonEdit(true);
      setPersonDraft(createEmptyPersonDraft());
      setShowEstimationHeatmap(false);
      const map = mapInstanceRef.current;
      if (map && mapReady) applyHeatmapVisibility(map, false);
    } catch (e: any) {
      setPersonError(e?.message ?? 'Erreur');
    } finally {
      setPersonLoading(false);
    }
  };
  const [personDraft, setPersonDraft] = useState<PersonDraft>(createEmptyPersonDraft);

  const [diseasesOpen, setDiseasesOpen] = useState(false);
  const [injuriesOpen, setInjuriesOpen] = useState(false);

  const diseaseOptions = useMemo(
    () =>
      [
        'diabete',
        'cardiaque',
        'asthme',
        'parkinson',
        'insuffisance_respiratoire',
        'insuffisance_renale',
        'grossesse',
        'handicap_moteur',
        'alzheimer',
      ] as DiseaseId[],
    []
  );

  const injuryOptions = useMemo(
    () =>
      [
        'traumatisme_cranien',
        'plaie',
        'fracture',
        'brulure',
        'hemorragie',
        'autre',
      ] as InjuryId[],
    []
  );

  const [lastKnownSuggestionsOpen, setLastKnownSuggestionsOpen] = useState(false);
  const [lastKnownAddressSuggestions, setLastKnownAddressSuggestions] = useState<
    { label: string; lng: number; lat: number }[]
  >([]);

  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);
  const [weather, setWeather] = useState<PersonWeather | null>(null);
  // Ancien toggle de heatmap conservé uniquement pour compatibilité, mais la visibilité
  // est désormais pilotée uniquement par l'état de suivi (panneau activité ouvert + fiche existante).
  const [showEstimationHeatmap, setShowEstimationHeatmap] = useState<boolean>(true);
  const showEstimationHeatmapRef = useRef(true);
  const personPanelOpenRef = useRef(false);
  const lastKnownWhenInputRef = useRef<HTMLInputElement | null>(null);

  // Notification "patte" (projection) : dépend uniquement de la fiche + du panneau.
  const [projectionNotification, setProjectionNotification] = useState(false);

  // Lus depuis les écouteurs socket, qui ne sont (ré)enregistrés qu'au changement
  // de mission : sans ref ils captureraient la valeur du premier rendu.
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const buildUserDisplayNameRef = useRef(buildUserDisplayName);
  buildUserDisplayNameRef.current = buildUserDisplayName;
  const setActivityToastRef = useRef(setActivityToast);
  setActivityToastRef.current = setActivityToast;

  let pendingHeatmapUpdate = false;
  function applyHeatmapVisibility(map: MapLibreMapInstance, visible: boolean) {
    if (pendingHeatmapUpdate) return;
    pendingHeatmapUpdate = true;
    requestAnimationFrame(() => {
      pendingHeatmapUpdate = false;
      const layerIds = [
        'person-estimation-heatmap',
        'person-estimation-outer-fill',
        'person-estimation-inner-fill',
      ];
      const visibility = visible ? 'visible' : 'none';
      for (const id of layerIds) {
        try {
          const layer = map.getLayer(id as any);
          if (!layer) continue;
          map.setLayoutProperty(id, 'visibility', visibility as any);
        } catch {
          // ignore
        }
      }
    });
  }

  /** Visibilité déduite de l'état courant, pour les callbacks MapLibre (load / styledata). */
  function syncHeatmapVisibility(map: MapLibreMapInstance) {
    applyHeatmapVisibility(map, showEstimationHeatmapRef.current && personPanelOpenRef.current);
  }

  /** À appeler depuis `ensureOverlays`: crée les sources/couches MapLibre de l'estimation. */
  const ensurePersonEstimationLayers = useCallback((map: MapLibreMapInstance) => {
    if (!map.getSource('person-estimation')) {
      map.addSource('person-estimation', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('person-estimation-corridor')) {
      map.addSource('person-estimation-corridor', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!map.getLayer('person-estimation-heatmap')) {
      map.addLayer({
        id: 'person-estimation-heatmap',
        type: 'heatmap',
        source: 'person-estimation',
        paint: {
          // Heatmap conservée pour l'avenir mais n'est plus la visualisation principale.
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            10,
            18,
            12,
            28,
            14,
            40,
            16,
            60,
          ],
          'heatmap-weight': ['coalesce', ['get', 'weight'], 0.0],
          'heatmap-intensity': 1.25,
          'heatmap-opacity': 0.0,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,0)'],
        },
      });
    }

    // Zone d'estimation en dégradé radial : une seule couche de remplissage, alpha + couleur portés par chaque feature
    if (!map.getLayer('person-estimation-inner-fill')) {
      map.addLayer({
        id: 'person-estimation-inner-fill',
        type: 'fill',
        source: 'person-estimation',
        paint: {
          // Couleur en dégradé radial: rouge (centre) -> orange -> jaune vers l'extérieur
          'fill-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 't'], 0],
            0.0,
            '#dc2626', // rouge
            0.5,
            '#f97316', // orange
            1.0,
            '#eab308', // jaune
          ],
          'fill-opacity': ['coalesce', ['get', 'alpha'], 0.0],
        },
      });
    }

    if (!map.getLayer('person-estimation-corridor-fill')) {
      map.addLayer({
        id: 'person-estimation-corridor-fill',
        type: 'fill',
        source: 'person-estimation-corridor',
        paint: {
          'fill-color': '#3b82f6',
          'fill-opacity': 0.18,
        },
      });
    }
    if (!map.getLayer('person-estimation-corridor-outline')) {
      map.addLayer({
        id: 'person-estimation-corridor-outline',
        type: 'line',
        source: 'person-estimation-corridor',
        paint: {
          'line-color': '#2563eb',
          'line-width': 1.5,
          'line-opacity': 0.6,
        },
      });
    }
  }, []);

  useEffect(() => {
    showEstimationHeatmapRef.current = showEstimationHeatmap;
  }, [showEstimationHeatmap]);

  useEffect(() => {
    personPanelOpenRef.current = personPanelOpen;

    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    const isPedestrian = (personCase?.mobility ?? 'none') === 'none';
    // Heatmap/zone visible seulement si le panneau est ouvert, qu'une fiche existe,
    // que la mobilité est piétonne et que le toggle utilisateur est à true.
    applyHeatmapVisibility(
      map,
      personPanelOpen && !!personCase && isPedestrian && showEstimationHeatmapRef.current
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personPanelOpen, personCase, mapReady]);

  const lastKnownPoiSuggestions = useMemo(() => {
    const q = (personDraft.lastKnownQuery ?? '').trim().toLowerCase();
    if (!q) return [] as ApiPoi[];
    const out: ApiPoi[] = [];
    const seen = new Set<string>();
    for (const p of pois) {
      if (!p?.id || seen.has(p.id)) continue;
      if (!((p.title ?? '').toLowerCase().includes(q))) continue;
      seen.add(p.id);
      out.push(p);
      if (out.length >= 5) break;
    }
    return out;
  }, [personDraft.lastKnownQuery, pois]);

  useEffect(() => {
    if (personDraft.mobility === 'none') return;
    setDiseasesOpen(false);
    setInjuriesOpen(false);
  }, [personDraft.mobility]);

  useEffect(() => {
    const q = (personDraft.lastKnownQuery ?? '').trim();
    if (!lastKnownSuggestionsOpen) return;
    if (!q) {
      setLastKnownAddressSuggestions([]);
      return;
    }

    // If POIs already match, we still allow address suggestions, but we can keep it lighter.
    let cancelled = false;
    const t = window.setTimeout(() => {
      (async () => {
        try {
          const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=5`;
          const res = await fetch(url);
          if (!res.ok) return;
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          const feats = Array.isArray(data?.features) ? data.features : [];
          const next = feats
            .map((f: any) => {
              const label = f?.properties?.label;
              const coords = f?.geometry?.coordinates;
              const lng = Array.isArray(coords) ? Number(coords[0]) : NaN;
              const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;
              if (!label || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
              return { label: String(label), lng, lat };
            })
            .filter(Boolean);
          setLastKnownAddressSuggestions(next as any);
        } catch {
          if (!cancelled) setLastKnownAddressSuggestions([]);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      // Ne toucher qu'au debounce de cette autocomplétion: `flushTimerRef` (côté
      // MapLibreMap) est le timer de flush des positions GPS en attente
      // (geogn.pendingPos), le purger ici annulait l'envoi différé des positions
      // hors-ligne à chaque frappe dans le champ adresse.
      window.clearTimeout(t);
    };
  }, [personDraft.lastKnownQuery, lastKnownSuggestionsOpen]);

  useEffect(() => {
    if (!personPanelOpen) return;
    if (!personCase) {
      setWeather(null);
      setWeatherError(null);
      setWeatherLoading(false);
      return;
    }

    const lng = typeof personCase.lastKnown.lng === 'number' ? personCase.lastKnown.lng : null;
    const lat = typeof personCase.lastKnown.lat === 'number' ? personCase.lastKnown.lat : null;
    if (lng === null || lat === null) {
      setWeather(null);
      return;
    }

    let cancelled = false;
    setWeatherLoading(true);
    setWeatherError(null);
    (async () => {
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(lat))}` +
          `&longitude=${encodeURIComponent(String(lng))}` +
          `&current=temperature_2m,precipitation,weather_code,wind_speed_10m`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('METEO_FAILED');
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const cur = data?.current;
        setWeather({
          temperatureC: typeof cur?.temperature_2m === 'number' ? cur.temperature_2m : null,
          windSpeedKmh: typeof cur?.wind_speed_10m === 'number' ? cur.wind_speed_10m : null,
          precipitationMm: typeof cur?.precipitation === 'number' ? cur.precipitation : null,
          weatherCode: typeof cur?.weather_code === 'number' ? cur.weather_code : null,
          when: typeof cur?.time === 'string' ? cur.time : new Date().toISOString(),
          source: 'open-meteo',
        });
      } catch (e: any) {
        if (cancelled) return;
        setWeather(null);
        setWeatherError(e?.message ?? 'METEO_FAILED');
      } finally {
        if (!cancelled) setWeatherLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personPanelOpen, personCase?.lastKnown?.lng, personCase?.lastKnown?.lat, personCase?.lastKnown?.when]);

  useEffect(() => {
    if (!personPanelOpen) return;
    // Force a recalculation on open, then every 10 seconds while open.
    setEstimationNowMs(Date.now());
    const t = window.setInterval(() => {
      setEstimationNowMs(Date.now());
    }, 10_000);
    return () => window.clearInterval(t);
  }, [personPanelOpen]);

  // Source de vérité unique de l'estimation : le disque tracé sur la carte, le
  // score de risque, les besoins et le texte d'explication en sortent tous.
  // Exclusivité stricte des deux visualisations : « À pied » → uniquement ce
  // disque (facteurs santé/blessures) ; tout véhicule → uniquement l'isochrone
  // TomTom (routes réelles + trafic), donc aucune estimation n'est calculée.
  const estimation = useMemo<EstimationResult | null>(() => {
    if (!personCase) return null;
    if (personCase.mobility !== 'none') return null;
    return computeEstimation(personCase, weather as SimpleWeather | null, estimationNowMs);
  }, [personCase, weather, estimationNowMs]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const src = map.getSource('person-estimation') as GeoJSONSource | undefined;
    if (!src) return;

    const est = estimation;

    // Règle métier : le disque d'estimation n'existe QUE pour la mobilité
    // piétonne. Dès qu'un véhicule est choisi, seule l'isochrone TomTom est
    // affichée — on vide donc activement la source (et pas seulement au
    // prochain rendu) pour ne jamais superposer les deux visualisations.
    const isPedestrian = (personCase?.mobility ?? 'none') === 'none';

    if (!est || !personCase || !isPedestrian) {
      src.setData({ type: 'FeatureCollection', features: [] } as any);
      return;
    }

    const lng = typeof personCase.lastKnown.lng === 'number' ? personCase.lastKnown.lng : null;
    const lat = typeof personCase.lastKnown.lat === 'number' ? personCase.lastKnown.lat : null;
    if (lng === null || lat === null) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const earthRadiusKm = 6371;
    const centerLatRad = (lat * Math.PI) / 180;
    const centerLonRad = (lng * Math.PI) / 180;

    function offsetPoint(distanceKm: number, bearingDeg: number): [number, number] {
      const dByR = distanceKm / earthRadiusKm;
      const bearing = (bearingDeg * Math.PI) / 180;
      const lat2 =
        Math.asin(
          Math.sin(centerLatRad) * Math.cos(dByR) +
            Math.cos(centerLatRad) * Math.sin(dByR) * Math.cos(bearing)
        );
      const lon1 = centerLonRad;
      const lon2 =
        lon1 +
        Math.atan2(
          Math.sin(bearing) * Math.sin(dByR) * Math.cos(centerLatRad),
          Math.cos(dByR) - Math.sin(centerLatRad) * Math.sin(lat2)
        );
      return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
    }

    function buildCircle(distanceKm: number, steps = 180): [number, number][] {
      const coords: [number, number][] = [];
      for (let i = 0; i < steps; i += 1) {
        const bearing = (360 / steps) * i;
        coords.push(offsetPoint(distanceKm, bearing));
      }
      // fermer le polygone
      if (coords.length) coords.push(coords[0]);
      return coords;
    }

    const inner = Math.max(0, est.probableKm || 0);
    const outer = Math.max(inner, est.maxKm || 0);

    const features: any[] = [];

    if (outer > 0) {
      const outerRing = buildCircle(outer);

      if (inner > 0) {
        const innerRing = buildCircle(inner);

        // Disque intérieur plein (zone probable) : opacité fixe 50%
        features.push({
          type: 'Feature',
          properties: { kind: 'inner', alpha: 0.5, t: 0 },
          geometry: { type: 'Polygon', coordinates: [innerRing] },
        });

        // Anneaux extérieurs entre inner et outer avec alpha décroissant de ~0.5 vers ~0.1
        const bands = 8;
        for (let i = 0; i < bands; i += 1) {
          const t0 = i / bands;
          const t1 = (i + 1) / bands;
          const r0 = inner + (outer - inner) * t0;
          const r1 = inner + (outer - inner) * t1;
          const ringInner = buildCircle(r0);
          const ringOuter = buildCircle(r1);

          // tFrac mesure la position relative entre inner (0) et outer (1)
          const tFrac = (i + 1) / bands;
          // alpha diminue progressivement de 0.5 (au contact de inner) vers 0.1 à l'extrémité
          const alpha = 0.5 - (0.5 - 0.1) * tFrac;

          features.push({
            type: 'Feature',
            properties: { kind: 'band', alpha, t: tFrac },
            geometry: { type: 'Polygon', coordinates: [ringOuter, ringInner] },
          });
        }
      } else {
        // Pas de rayon probable défini: un seul disque jusqu'au max avec alpha 50% au centre
        features.push({
          type: 'Feature',
          properties: { kind: 'inner', alpha: 0.5, t: 0 },
          geometry: { type: 'Polygon', coordinates: [outerRing] },
        });
      }
    }

    src.setData({ type: 'FeatureCollection', features });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, personCase, estimation, styleVersion]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const src = map.getSource('person-estimation-corridor') as GeoJSONSource | undefined;
    if (!src) return;

    src.setData({ type: 'FeatureCollection', features: [] } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, personCase?.lastKnown?.lng, personCase?.lastKnown?.lat]);

  // Notification paw dynamique — visible quand la fiche existe et le panneau est fermé,
  // cohérent avec la logique grid (contenu caché → notification, contenu visible → pas de notification).
  useEffect(() => {
    setProjectionNotification(!!personCase && !personPanelOpen);
  }, [personCase, personPanelOpen]);

  // Précharger la fiche personne pour tous les rôles afin que les non-admin puissent voir le suivi actif
  // (pastilles + ouverture Paw + heatmap) sans devoir ouvrir le panneau.
  useEffect(() => {
    if (!selectedMissionId) {
      if (!personPanelOpen) setPersonCase(null);
      return;
    }
    if (!mission) return;
    if (personPanelOpen) return;
    if (personEdit) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await getPersonCase(selectedMissionId);
        if (cancelled) return;
        setPersonCase(res.case);
      } catch {
        if (cancelled) return;
        setPersonCase(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMissionId, mission?.id, personPanelOpen, personEdit]);

  useEffect(() => {
    if (!personPanelOpen) return;
    if (!selectedMissionId) return;
    if (!mission) return;

    let cancelled = false;
    setPersonLoading(true);
    setPersonError(null);
    (async () => {
      try {
        const res = await getPersonCase(selectedMissionId);
        if (cancelled) return;
        const c = res.case;
        setPersonCase(c);
        if (!c) {
          // Pas encore de fiche : seuls les admins peuvent en créer, les visualisateurs restent en lecture seule.
          if (canEditPerson) {
            setPersonEdit(true);
            // Ne pas écraser un draft pré-rempli depuis un POI (ex: clic sur Paw dans un popup POI)
            // pendant que le panneau charge la fiche.
            setPersonDraft((prev) => {
              const hasPrefill =
                prev.lastKnownType === 'poi' &&
                typeof prev.lastKnownPoiId === 'string' &&
                prev.lastKnownPoiId !== '' &&
                typeof prev.lastKnownLng === 'number' &&
                typeof prev.lastKnownLat === 'number';
              if (hasPrefill) return prev;
              return createEmptyPersonDraft();
            });
          } else {
            setPersonEdit(false);
          }
          return;
        }
        setPersonEdit(false);
        setPersonDraft({
          lastKnownQuery: c.lastKnown.query,
          lastKnownType: c.lastKnown.type,
          lastKnownPoiId: c.lastKnown.poiId,
          lastKnownLng: typeof c.lastKnown.lng === 'number' ? c.lastKnown.lng : undefined,
          lastKnownLat: typeof c.lastKnown.lat === 'number' ? c.lastKnown.lat : undefined,
          lastKnownWhen: c.lastKnown.when ? c.lastKnown.when.slice(0, 16) : '',
          mobility: c.mobility,
          age: c.age === null || typeof c.age !== 'number' ? '' : String(c.age),
          sex: c.sex,
          healthStatus: c.healthStatus,
          diseases: Array.isArray(c.diseases) ? c.diseases : [],
          diseasesFreeText: c.diseasesFreeText ?? '',
          injuries: Array.isArray(c.injuries)
            ? c.injuries.map((x) => ({ id: x.id, locations: Array.isArray(x.locations) ? x.locations : [] }))
            : [],
          injuriesFreeText: c.injuriesFreeText ?? '',
          terrain: (c.terrain as TerrainType) ?? 'route',
          medications: Array.isArray(c.medications) ? c.medications : [],
        });
      } catch (e: any) {
        if (cancelled) return;
        setPersonError(e?.message ?? 'Erreur');
        if (canEditPerson) setPersonEdit(true);
      } finally {
        if (!cancelled) setPersonLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [personPanelOpen, selectedMissionId, mission, canEditPerson]);

  // Écouteurs socket propres à la fiche personne.
  // NOTE: dépendances volontairement limitées à `selectedMissionId`, comme dans le composant
  // d'origine (les handlers sont (ré)enregistrés uniquement au changement de mission).
  useEffect(() => {
    if (!selectedMissionId) return;
    const socket = getSocket();

    const onPersonCaseUpserted = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.case?.id) return;

      setPersonCase(msg.case as ApiPersonCase);

      const created = msg?.created === true;
      // Une nouvelle fiche repart avec la heatmap visible : la suppression de la fiche
      // précédente a mis le toggle à false (cf. onConfirmDeletePersonCase) et rien ne le
      // remettait à true, la heatmap restait donc invisible pour le reste de la session.
      if (created) setShowEstimationHeatmap(true);
      const actorUserId = typeof msg?.actorUserId === 'string' ? msg.actorUserId : null;
      if (created && actorUserId) {
        const rawName = typeof msg.actorDisplayName === 'string' ? msg.actorDisplayName : null;
        const name = (rawName && rawName.trim()) || buildUserDisplayNameRef.current(actorUserId);
        // Ne pas afficher la bulle à l'utilisateur qui a créé la piste.
        const me = currentUserIdRef.current;
        if (!me || me !== actorUserId) {
          setActivityToastRef.current(`${name} vient de créer une piste`);
        }
      }
    };

    const onPersonCaseDeleted = (msg: any) => {
      if (msg?.missionId && msg.missionId !== selectedMissionId) return;
      setPersonCase(null);
      setProjectionNotification(false);
    };

    socket.on('person-case:upserted', onPersonCaseUpserted);
    socket.on('person-case:deleted', onPersonCaseDeleted);

    return () => {
      socket.off('person-case:upserted', onPersonCaseUpserted);
      socket.off('person-case:deleted', onPersonCaseDeleted);
    };
  }, [selectedMissionId]);

  const onExpandPersonPanel = useCallback(() => {
    setPersonPanelCollapsed(false);
  }, []);

  const onCancelDeletePersonCase = useCallback(() => {
    setConfirmDeletePersonCaseOpen(false);
  }, []);

  const onConfirmDeletePersonCaseClick = useCallback(() => {
    void onConfirmDeletePersonCase();
  }, [onConfirmDeletePersonCase]);

  const nowLocalMinute = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  const minLiveTrackWhenLocalMinute = useMemo(() => {
    const d = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  return {
    // Fiche + formulaire
    personCase,
    setPersonCase,
    personDraft,
    setPersonDraft,
    personLoading,
    setPersonLoading,
    personError,
    setPersonError,
    personEdit,
    setPersonEdit,
    personPanelOpen,
    setPersonPanelOpen,
    personPanelCollapsed,
    setPersonPanelCollapsed,
    confirmDeletePersonCaseOpen,
    setConfirmDeletePersonCaseOpen,
    projectionNotification,

    // Champs du formulaire
    diseasesOpen,
    setDiseasesOpen,
    diseaseOptions,
    injuriesOpen,
    setInjuriesOpen,
    injuryOptions,
    lastKnownSuggestionsOpen,
    setLastKnownSuggestionsOpen,
    lastKnownPoiSuggestions,
    lastKnownAddressSuggestions,
    lastKnownWhenInputRef,
    nowLocalMinute,
    minLiveTrackWhenLocalMinute,

    // Météo + estimation
    weather,
    weatherLoading,
    weatherError,
    estimation,

    // Heatmap / couches MapLibre
    showEstimationHeatmap,
    applyHeatmapVisibility,
    syncHeatmapVisibility,
    ensurePersonEstimationLayers,

    // Handlers
    onExpandPersonPanel,
    onCancelDeletePersonCase,
    onConfirmDeletePersonCaseClick,
  };
}

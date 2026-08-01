import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMapInstance } from 'maplibre-gl';
import { getSocket } from '../lib/socket';
import {
  listVehicleTracks,
  deleteVehicleTrack,
  getVehicleTrackState,
  type ApiVehicleTrack,
  type ApiVehicleTrackStatus,
} from '../lib/api';

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const ts = () => {
  try {
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const p3 = (n: number) => String(n).padStart(3, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
  } catch {
    return '';
  }
};

export const isTestTrack = (track: ApiVehicleTrack | null | undefined): boolean => {
  if (!track) return false;
  if (track.algorithm === 'road_graph') return true;
  return !!track.label && /TEST/i.test(track.label);
};

export type UseVehicleTrackParams = {
  mapInstanceRef: React.MutableRefObject<MapLibreMapInstance | null>;
  mapReady: boolean;
  styleVersion: number;
  selectedMissionId: string | null;
  setActivityToast: (msg: string) => void;
};

export type UseVehicleTrackResult = {
  hasActiveTestVehicleTrack: boolean;
  setActiveVehicleTrackId: React.Dispatch<React.SetStateAction<string | null>>;
  setShowActiveVehicleTrack: React.Dispatch<React.SetStateAction<boolean>>;
  setVehicleTrackGeojsonById: React.Dispatch<React.SetStateAction<Record<string, GeoJSON.FeatureCollection>>>;
  /** Supprime côté API toutes les pistes de la mission puis remet à zéro l'état local + la carte. */
  deleteAllVehicleTracks: (missionId: string) => Promise<void>;
  /** À appeler depuis `ensureOverlays`: crée les sources/couches MapLibre du suivi véhicule. */
  ensureVehicleTrackLayers: (map: MapLibreMapInstance) => void;
  /** À appeler après un rebuild de style: réinjecte la dernière géométrie connue. */
  reinjectVehicleTrackData: (map: MapLibreMapInstance) => void;
};

export function useVehicleTrack({
  mapInstanceRef,
  mapReady,
  styleVersion,
  selectedMissionId,
  setActivityToast,
}: UseVehicleTrackParams): UseVehicleTrackResult {
  const vehicleTrackAnimFrameRef = useRef<number | null>(null);
  const vehicleTrackPrevGeojsonRef = useRef<any>(null);
  const vehicleTrackPrevKeyRef = useRef<string | null>(null);
  const vehicleTrackPendingGeojsonRef = useRef<any>(null);
  const vehicleTrackPendingKeyRef = useRef<string | null>(null);
  const vehicleTrackPendingAttemptsRef = useRef<number>(0);
  const vehicleTrackPendingTimerRef = useRef<number | null>(null);
  const vehicleTrackLastAppliedGeojsonRef = useRef<any>(null);
  const vehicleTrackMorphFrameRef = useRef<number | null>(null);
  const vehicleTrackMorphDelayTimerRef = useRef<number | null>(null);
  const vehicleTrackMorphKeyRef = useRef<string | null>(null);

  const showActiveVehicleTrackRef = useRef<boolean>(true);
  const activeVehicleTrackIdRef = useRef<string | null>(null);
  const vehicleTrackGeojsonByIdRef = useRef<Record<string, GeoJSON.FeatureCollection>>({});

  const reapplyVehicleTrackIfPending = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!showActiveVehicleTrackRef.current) return;
    if (!vehicleTrackPendingGeojsonRef.current || !vehicleTrackPendingKeyRef.current) return;
    const src = map.getSource('vehicle-track-reached') as GeoJSONSource | undefined;
    if (!src) return;
    try {
      src.setData(vehicleTrackPendingGeojsonRef.current as any);
    } catch {
      // ignore
    }
  };

  const clearPendingVehicleTrack = () => {
    vehicleTrackPendingGeojsonRef.current = null;
    vehicleTrackPendingKeyRef.current = null;
    vehicleTrackPendingAttemptsRef.current = 0;
    if (vehicleTrackPendingTimerRef.current != null) {
      try {
        window.clearTimeout(vehicleTrackPendingTimerRef.current);
      } catch {
        // ignore
      }
      vehicleTrackPendingTimerRef.current = null;
    }
  };

  const clearVehicleTrackVisual = (_reason: string) => {
    clearPendingVehicleTrack();
    if (vehicleTrackMorphFrameRef.current != null) {
      try {
        cancelAnimationFrame(vehicleTrackMorphFrameRef.current);
      } catch {
        // ignore
      }
      vehicleTrackMorphFrameRef.current = null;
    }
    if (vehicleTrackMorphDelayTimerRef.current != null) {
      try {
        window.clearTimeout(vehicleTrackMorphDelayTimerRef.current);
      } catch {
        // ignore
      }
      vehicleTrackMorphDelayTimerRef.current = null;
    }
    vehicleTrackMorphKeyRef.current = null;
    vehicleTrackPrevGeojsonRef.current = null;
    vehicleTrackPrevKeyRef.current = null;
    vehicleTrackLastAppliedGeojsonRef.current = null;

    try {
      const map = mapInstanceRef.current;
      if (map) {
        const src = map.getSource('vehicle-track-reached') as GeoJSONSource | undefined;
        if (src) {
          src.setData(EMPTY_FC as any);
        }
      }
    } catch {
      // ignore
    }
  };

  const [vehicleTracks, setVehicleTracks] = useState<ApiVehicleTrack[]>([]);
  const [, setVehicleTracksTotal] = useState(0);
  // Indique si la liste des pistes véhicule a déjà été chargée au moins une fois
  // pour la mission courante durant cette session.
  const [vehicleTracksLoaded, setVehicleTracksLoaded] = useState(false);

  // ID de la piste véhicule actuellement affichée sur la carte (persistée pour survivre aux rechargements).
  const [activeVehicleTrackId, setActiveVehicleTrackId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = window.localStorage.getItem('gtc_activeVehicleTrackId');
      return stored && stored !== '' ? stored : null;
    } catch {
      return null;
    }
  });

  // Contrôle de visibilité du tracé actif (lié au bouton Paw, persisté).
  const [showActiveVehicleTrack, setShowActiveVehicleTrack] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      const stored = window.localStorage.getItem('gtc_showActiveVehicleTrack');
      if (stored === 'false') return false;
      if (stored === 'true') return true;
      return true;
    } catch {
      return true;
    }
  });
  const [vehicleTrackGeojsonById, setVehicleTrackGeojsonById] = useState<Record<string, GeoJSON.FeatureCollection>>({});

  useEffect(() => {
    showActiveVehicleTrackRef.current = showActiveVehicleTrack;
  }, [showActiveVehicleTrack]);

  // Quand l'utilisateur réactive l'affichage via le bouton Paw, réappliquer
  // immédiatement la dernière géométrie connue (sans attendre un tick).
  useEffect(() => {
    if (!mapReady) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('vehicle-track-reached') as GeoJSONSource | undefined;
    if (!src) return;
    if (!showActiveVehicleTrack) return;

    try {
      const id = activeVehicleTrackIdRef.current;
      const byId = vehicleTrackGeojsonByIdRef.current;
      const raw = id && (byId as any)?.[id] ? (byId as any)[id] : null;
      const fc = (raw ?? vehicleTrackPrevGeojsonRef.current ?? EMPTY_FC) as any;
      src.setData(fc);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showActiveVehicleTrack, mapReady]);

  useEffect(() => {
    activeVehicleTrackIdRef.current = activeVehicleTrackId;
  }, [activeVehicleTrackId]);

  useEffect(() => {
    vehicleTrackGeojsonByIdRef.current = vehicleTrackGeojsonById;
  }, [vehicleTrackGeojsonById]);

  const filterAllowedVehicleTracks = (tracks: ApiVehicleTrack[]): ApiVehicleTrack[] => tracks.filter((t) => isTestTrack(t));

  const activeVehicleTrack = useMemo(() => {
    if (!activeVehicleTrackId) return null;
    const found = vehicleTracks.find((t) => t.id === activeVehicleTrackId) ?? null;
    if (!found) {
      try {
        // eslint-disable-next-line no-console
        console.log('[vehicle-track] active track not found in list', {
          activeVehicleTrackId,
          totalTracks: vehicleTracks.length,
        });
      } catch {
        // ignore
      }
    }
    return found;
  }, [activeVehicleTrackId, vehicleTracks]);

  const hasActiveTestVehicleTrack = !!(activeVehicleTrack && isTestTrack(activeVehicleTrack));

  // Persiste les changements d'ID actif / visibilité dans localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (activeVehicleTrackId) {
        window.localStorage.setItem('gtc_activeVehicleTrackId', activeVehicleTrackId);
      } else {
        window.localStorage.removeItem('gtc_activeVehicleTrackId');
      }
    } catch {
      // ignore
    }
  }, [activeVehicleTrackId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('gtc_showActiveVehicleTrack', showActiveVehicleTrack ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [showActiveVehicleTrack]);

  useEffect(() => {
    return () => {
      if (vehicleTrackAnimFrameRef.current != null) {
        cancelAnimationFrame(vehicleTrackAnimFrameRef.current);
        vehicleTrackAnimFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedMissionId) {
      setVehicleTracks([]);
      setVehicleTracksTotal(0);
      setActiveVehicleTrackId(null);
      setVehicleTracksLoaded(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const missionIdAtCall = selectedMissionId;
        // L'API sait filtrer (status / vehicleType / q / pagination) mais aucun
        // écran ne l'expose : on demande simplement la première page. Passer des
        // filtres ici sans UI pour les changer ne créait que de l'état mort.
        const { tracks, total: _total } = await listVehicleTracks(missionIdAtCall, { limit: 20, offset: 0 });
        if (cancelled) return;

        setVehicleTracksLoaded(true);
        const filtered = filterAllowedVehicleTracks(tracks);
        setVehicleTracks(filtered);
        setVehicleTracksTotal(filtered.length);

        // Si la mission n'a plus aucune piste, on nettoie complètement l'état
        // associé aux suivis pour éviter qu'une géométrie ancienne reste
        // accrochée dans la carte ou dans la mémoire React.
        if (!filtered.length) {
          if (activeVehicleTrackIdRef.current) {
            setActiveVehicleTrackId(null);
          }
          if (Object.keys(vehicleTrackGeojsonByIdRef.current).length > 0) {
            setVehicleTrackGeojsonById({});
          }
          return;
        }

        const currentId = activeVehicleTrackIdRef.current;
        // Ne pas "perdre" la piste active entre deux refresh : tant que la piste
        // existe encore côté API, on conserve l'ID. (Le status peut transiter,
        // et un reset à null fait disparaître la forme avant le prochain isochrone.)
        const stillExists = currentId ? tracks.some((t) => t.id === currentId) : false;
        let nextActiveId = currentId && stillExists ? currentId : null;

        if (!nextActiveId) {
          // Fallback : on prend la première piste autorisée (TEST) si aucune piste
          // n'est marquée explicitement "active".
          const active = tracks.find((t) => t.status === 'active');
          nextActiveId = active?.id ?? (filtered[0]?.id ?? null);
        }

        if (!nextActiveId) {
          // Aucune piste active trouvée : on s'assure de bien
          // réinitialiser l'ID actif pour éviter qu'une ancienne
          // piste supprimée ou stoppée ne revienne par erreur.
          if (activeVehicleTrackIdRef.current) {
            setActiveVehicleTrackId(null);
          }
        } else {
          if (nextActiveId !== activeVehicleTrackIdRef.current) {
            setActiveVehicleTrackId(nextActiveId);
          }

          if (!vehicleTrackGeojsonByIdRef.current[nextActiveId]) {
            try {
              const state = await getVehicleTrackState(missionIdAtCall, nextActiveId);
              if (cancelled) return;
              if (missionIdAtCall !== selectedMissionId) return;

              const cacheGeo = state.cache?.payloadGeojson;
              const provider = (state.cache?.meta as any)?.provider as string | undefined;
              const track = tracks.find((t) => t.id === nextActiveId) ?? null;
              const isTest = isTestTrack(track as any);
              const allowTomtom =
                provider === 'tomtom_reachable_range' || provider === 'tomtom_reachable_range_fallback_circle';

              if (cacheGeo && (!isTest || allowTomtom)) {
                setVehicleTrackGeojsonById((prev) => ({
                  ...prev,
                  [nextActiveId!]: cacheGeo as any,
                }));
              }
            } catch {
              if (cancelled) return;
              // non bloquant
            }
          }
        }
      } catch {
        if (cancelled) return;
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedMissionId,
    // activeVehicleTrackId / vehicleTrackGeojsonById sont *écrits* par cet effet et mis à
    // jour par les événements socket à chaque tick d'isochrone: les garder en dépendances
    // relançait un listVehicleTracks complet en boucle. Ils sont lus via leurs refs.
  ]);

  // Écouteurs socket propres au suivi véhicule.
  // NOTE: dépendances volontairement limitées à `selectedMissionId`, comme dans le composant
  // d'origine (les handlers sont (ré)enregistrés uniquement au changement de mission).
  useEffect(() => {
    if (!selectedMissionId) return;
    const socket = getSocket();

    const upsertVehicleTrackKeepOrder = (prev: ApiVehicleTrack[], track: ApiVehicleTrack) => {
      const idx = prev.findIndex((t) => t.id === track.id);
      if (idx === -1) return [track, ...prev];
      const next = prev.slice();
      next[idx] = track;
      return next;
    };

    function onVehicleTrackCreated(msg: any) {
      if (!selectedMissionId || msg?.missionId !== selectedMissionId) return;
      const track = msg?.track as ApiVehicleTrack | undefined;
      if (!track || !track.id) return;

      // Ne garder que les pistes TEST.
      if (!isTestTrack(track)) return;

      try {
        const provider = (track.cache?.meta as any)?.provider as string | undefined;
        const metaBudget = (track.cache?.meta as any)?.budgetSec as number | undefined;
        const f0 = (track.cache?.payloadGeojson as any)?.features?.[0];
        const b = f0?.properties?.budgetSec;
        const ringLen = Array.isArray(f0?.geometry?.coordinates?.[0]) ? f0.geometry.coordinates[0].length : null;
        // eslint-disable-next-line no-console
        console.log('[vehicle-track] created', {
          ts: ts(),
          trackId: track.id,
          provider: provider ?? null,
          metaBudgetSec: typeof metaBudget === 'number' ? metaBudget : null,
          geojsonBudgetSec: typeof b === 'number' ? b : null,
          ringLen,
        });
      } catch {
        // ignore logging errors
      }

      setVehicleTracks((prev) => upsertVehicleTrackKeepOrder(prev, track));

      if (!activeVehicleTrackId) {
        setActiveVehicleTrackId(track.id);
      }

      const cacheGeo = track.cache?.payloadGeojson;
      const provider = (track.cache?.meta as any)?.provider as string | undefined;
      const allowTomtom =
        provider === 'tomtom_reachable_range' || provider === 'tomtom_reachable_range_fallback_circle';
      if (cacheGeo && allowTomtom) {
        setVehicleTrackGeojsonById((prev) => ({ ...prev, [track.id]: cacheGeo as any }));
      }
    }

    function onVehicleTrackUpdated(msg: any) {
      if (!selectedMissionId || msg?.missionId !== selectedMissionId) return;

      const full = msg?.track as ApiVehicleTrack | undefined;
      if (full && full.id) {
        // Ne garder que les pistes TEST.
        if (!isTestTrack(full)) {
          setVehicleTracks((prev) => prev.filter((t) => t.id !== full.id));
          setVehicleTrackGeojsonById((prev) => {
            if (!prev[full.id]) return prev;
            const next = { ...prev };
            delete next[full.id];
            return next;
          });
          setActiveVehicleTrackId((currentId) => (currentId === full.id ? null : currentId));
          return;
        }
        setVehicleTracks((prev) => upsertVehicleTrackKeepOrder(prev, full));
        const cacheGeo = full.cache?.payloadGeojson;
        const provider = (full.cache?.meta as any)?.provider as string | undefined;
        const isTest = isTestTrack(full);
        const allowTomtom =
          provider === 'tomtom_reachable_range' || provider === 'tomtom_reachable_range_fallback_circle';

        // Si la piste n'est plus active, on coupe immédiatement tout affichage
        // éventuel lié à cette piste (ID actif + GeoJSON), afin d'éviter que
        // Paw puisse faire réapparaître un ancien carroyage.
        if (full.status !== 'active') {
          setActiveVehicleTrackId((currentId) => (currentId === full.id ? null : currentId));
          setVehicleTrackGeojsonById((prev) => {
            if (!prev[full.id]) return prev;
            const next = { ...prev };
            delete next[full.id];
            return next;
          });
          return;
        }

        if (cacheGeo && (!isTest || allowTomtom)) {
          try {
            const budget = (full.cache?.meta as any)?.budgetSec;
            // Trace les mises à jour d'isochrone côté front (branche full.track)
            // pour comprendre la fréquence et le provider utilisé.
            // eslint-disable-next-line no-console
            console.log('[vehicle-track] update (full)', {
              ts: ts(),
              trackId: full.id,
              provider,
              budgetSec: budget,
              receivedAt: new Date().toISOString(),
            });
          } catch {
            // ignore logging errors
          }
          setVehicleTrackGeojsonById((prev) => ({ ...prev, [full.id]: cacheGeo as any }));
        }
        return;
      }

      const trackId = typeof msg?.trackId === 'string' ? msg.trackId : undefined;
      if (!trackId) return;

      setVehicleTracks((prev) =>
        prev.map((t) => {
          if (t.id !== trackId) return t;
          const next: ApiVehicleTrack = { ...t };
          if (typeof msg.status === 'string') {
            next.status = msg.status as ApiVehicleTrackStatus;
          }
          if (msg.cache) {
            next.cache = {
              computedAt: msg.cache.computedAt ?? next.cache?.computedAt ?? null,
              elapsedSeconds: typeof msg.cache.elapsedSeconds === 'number'
                ? msg.cache.elapsedSeconds
                : next.cache?.elapsedSeconds ?? 0,
              payloadGeojson: msg.cache.payloadGeojson ?? next.cache?.payloadGeojson ?? null,
              meta: msg.cache.meta ?? next.cache?.meta ?? null,
            } as any;
          }
          if (typeof msg.lastComputedAt === 'string') {
            next.lastComputedAt = msg.lastComputedAt;
          }
          return next;
        })
      );

      const cacheGeo = msg?.cache?.payloadGeojson;
      const provider = (msg?.cache?.meta as any)?.provider as string | undefined;
      const track = vehicleTracks.find((t) => t.id === trackId);
      const isTest = isTestTrack(track);
      const allowTomtom =
        provider === 'tomtom_reachable_range' || provider === 'tomtom_reachable_range_fallback_circle';
      if (cacheGeo && (!isTest || allowTomtom)) {
        try {
          const budget = (msg?.cache?.meta as any)?.budgetSec;
          const f0 = (cacheGeo as any)?.features?.[0];
          const geoBudget = (f0?.properties as any)?.budgetSec;
          const ringLen = Array.isArray(f0?.geometry?.coordinates?.[0]) ? f0.geometry.coordinates[0].length : null;
          // Trace les mises à jour d'isochrone côté front (branche diff)
          // pour suivre la fréquence réelle et le provider.
          // eslint-disable-next-line no-console
          console.log('[vehicle-track] update (delta)', {
            ts: ts(),
            trackId,
            provider,
            budgetSec: budget,
            geojsonBudgetSec: geoBudget,
            ringLen,
            receivedAt: new Date().toISOString(),
          });
        } catch {
          // ignore logging errors
        }
        setVehicleTrackGeojsonById((prev) => ({ ...prev, [trackId]: cacheGeo as any }));
      }
    }

    function onVehicleTrackDeleted(msg: any) {
      if (!selectedMissionId || msg?.missionId !== selectedMissionId) return;
      const trackId = typeof msg?.trackId === 'string' ? msg.trackId : undefined;
      if (!trackId) return;

      // Supprime la piste côté liste
      setVehicleTracks((prev) => prev.filter((t) => t.id !== trackId));

      // Vide le GeoJSON associé
      setVehicleTrackGeojsonById((prev) => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });

      // Et désactive toute piste active pour masquer complètement la forme.
      setActiveVehicleTrackId((currentId) => (currentId === trackId ? null : currentId));

      // IMPORTANT: on nettoie aussi l'état "prev"/"pending" et on vide la source MapLibre,
      // sinon le mode "render kept previous" peut conserver la géométrie supprimée.
      try {
        const prevKey = vehicleTrackPrevKeyRef.current;
        const pendingKey = vehicleTrackPendingKeyRef.current;
        const wasDisplayed =
          (typeof prevKey === 'string' && prevKey.startsWith(`${trackId}:`)) ||
          (typeof pendingKey === 'string' && pendingKey.startsWith(`${trackId}:`)) ||
          activeVehicleTrackIdRef.current === trackId;
        if (wasDisplayed) {
          clearVehicleTrackVisual('track-deleted');
        }
      } catch {
        // ignore
      }
    }

    function onVehicleTrackExpired(msg: any) {
      onVehicleTrackUpdated(msg);

      // Quand une piste arrive à expiration, informer l'utilisateur que la portée
      // maximum de l'isochrone a été atteinte.
      setActivityToast('portée maximum atteinte');
    }

    socket.on('vehicle-track:created', onVehicleTrackCreated);
    socket.on('vehicle-track:updated', onVehicleTrackUpdated);
    socket.on('vehicle-track:deleted', onVehicleTrackDeleted);
    socket.on('vehicle-track:expired', onVehicleTrackExpired);

    return () => {
      socket.off('vehicle-track:created', onVehicleTrackCreated);
      socket.off('vehicle-track:updated', onVehicleTrackUpdated);
      socket.off('vehicle-track:deleted', onVehicleTrackDeleted);
      socket.off('vehicle-track:expired', onVehicleTrackExpired);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMissionId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const src = map.getSource('vehicle-track-reached') as GeoJSONSource | undefined;
    if (!src) {
      try {
        // eslint-disable-next-line no-console
        console.log('[vehicle-track] render skip (no source)', { ts: ts(), sourceId: 'vehicle-track-reached' });
      } catch {
        // ignore
      }
      return;
    }

    // Tant que la liste des pistes n'a pas été chargée au moins une fois pour
    // cette mission, on force la source à rester vide pour éviter tout
    // affichage résiduel basé uniquement sur un ancien ID persistant.
    if (!vehicleTracksLoaded) {
      // IMPORTANT: si Paw est activé et qu'on a déjà une géométrie affichée,
      // ne pas créer de "trou" lors d'un état transitoire (refresh/401/etc.).
      if (showActiveVehicleTrack && vehicleTrackPrevGeojsonRef.current && vehicleTrackPrevKeyRef.current) {
        try {
          // eslint-disable-next-line no-console
          console.log('[vehicle-track] render kept previous (tracks not loaded)', {
            ts: ts(),
            prevKey: vehicleTrackPrevKeyRef.current,
          });
        } catch {
          // ignore
        }
        return;
      }
      try {
        src.setData(EMPTY_FC as any);
      } catch {
        // ignore
      }
      return;
    }

    // On n'affiche le carroyage que s'il existe réellement une piste active
    // correspondante dans la liste (status === 'active') ET que la visibilité
    // est activée via le bouton Paw. Si activeVehicleTrack est null ou non-active,
    // on envoie systématiquement un FeatureCollection vide à la source.
    // IMPORTANT: ne pas créer de "trou" : tant que l'utilisateur a une piste sélectionnée,
    // on la considère comme effective, même si le status est transitoire.
    const fallbackTrackId = (() => {
      if (activeVehicleTrackId) return activeVehicleTrackId;
      const keys = Object.keys(vehicleTrackGeojsonById ?? {});
      if (keys.length === 1) return keys[0];
      return null;
    })();

    const effectiveTrack = (() => {
      if (activeVehicleTrackId) return activeVehicleTrack;
      if (!fallbackTrackId) return null;
      return vehicleTracks.find((t) => t.id === fallbackTrackId) ?? null;
    })();
    const isTestEffective = effectiveTrack ? isTestTrack(effectiveTrack as any) : false;

    let data =
      showActiveVehicleTrack && effectiveTrack && fallbackTrackId
        ? vehicleTrackGeojsonById[fallbackTrackId]
        : null;

    const key = (() => {
      const f0 = (data as any)?.features?.[0];
      const p = f0?.properties;
      const budgetSec = typeof p?.budgetSec === 'number' ? String(p.budgetSec) : '';
      return fallbackTrackId ? `${fallbackTrackId}:${budgetSec}` : null;
    })();

    if (!data || !key) {
      // Si Paw est activé, on évite de "vider" la couche lors d'un état transitoire
      // (refresh API/filtre/socket en retard). On garde la dernière géométrie affichée.
      if (showActiveVehicleTrack && vehicleTrackPrevGeojsonRef.current && vehicleTrackPrevKeyRef.current) {
        try {
          // eslint-disable-next-line no-console
          console.log('[vehicle-track] render kept previous (transient missing)', {
            ts: ts(),
            reason: !data ? 'no-data' : 'no-key',
            activeVehicleTrackId,
            hasEffectiveTrack: Boolean(effectiveTrack),
            prevKey: vehicleTrackPrevKeyRef.current,
          });
        } catch {
          // ignore
        }
        return;
      }

      try {
        src.setData(EMPTY_FC as any);
      } catch {
        // ignore
      }
      try {
        // eslint-disable-next-line no-console
        console.log('[vehicle-track]', ts(), 'render cleared', {
          reason: !data ? 'no-data' : 'no-key',
          showActiveVehicleTrack,
          hasEffectiveTrack: Boolean(effectiveTrack),
          activeVehicleTrackId,
          isTestEffective,
        });
      } catch {
        // ignore
      }

      try {
        const map2 = mapInstanceRef.current;
        if (map2) {
          requestAnimationFrame(() => {
            try {
              const layerIds = ['vehicle-track-reached-fill', 'vehicle-track-reached-outline'];
              const layersPresent = layerIds.map((id) => ({ id, present: Boolean(map2.getLayer(id as any)) }));
              const vis = layerIds.map((id) => {
                try {
                  return {
                    id,
                    visibility: (map2.getLayoutProperty(id as any, 'visibility') as any) ?? 'visible',
                  };
                } catch {
                  return { id, visibility: 'unknown' };
                }
              });
              const rendered = map2.queryRenderedFeatures(undefined, { layers: layerIds as any });
              // eslint-disable-next-line no-console
              console.log('[vehicle-track]', ts(), 'VISUAL', {
                phase: 'cleared',
                displayed: rendered.length > 0,
                renderedCount: rendered.length,
                paw: showActiveVehicleTrackRef.current,
                activeVehicleTrackId: activeVehicleTrackIdRef.current,
                layersPresent,
                vis,
              });
            } catch {
              // ignore
            }
          });
        }
      } catch {
        // ignore
      }

      // Ne pas effacer les refs "prev" : elles servent justement à éviter un trou
      // quand l'état revient à la normale juste après.
      return;
    }

    const prevKey = vehicleTrackPrevKeyRef.current;
    const prevGeo = vehicleTrackPrevGeojsonRef.current;

    const normalizeVehicleTrackFc = (fc: any): any => {
      try {
        const f0 = fc?.features?.[0];
        const g = f0?.geometry;
        if (!g || g.type !== 'Polygon') return fc;
        const ring = g.coordinates?.[0];
        if (!Array.isArray(ring) || ring.length < 3) return fc;
        const first = ring[0];
        const last = ring[ring.length - 1];
        const eps = 1e-12;
        const isClosed =
          Array.isArray(first) &&
          Array.isArray(last) &&
          first.length >= 2 &&
          last.length >= 2 &&
          Math.abs(first[0] - last[0]) <= eps &&
          Math.abs(first[1] - last[1]) <= eps;
        if (isClosed) return fc;
        const closedRing = [...ring, first];
        return {
          ...fc,
          features: [
            {
              ...f0,
              geometry: {
                ...g,
                coordinates: [closedRing, ...(Array.isArray(g.coordinates) ? g.coordinates.slice(1) : [])],
              },
            },
            ...(Array.isArray(fc?.features) ? fc.features.slice(1) : []),
          ],
        };
      } catch {
        return fc;
      }
    };

    const getRing = (fc: any): [number, number][] | null => {
      const f0 = fc?.features?.[0];
      const g = f0?.geometry;
      if (!g || g.type !== 'Polygon') return null;
      const ring = g.coordinates?.[0];
      if (!Array.isArray(ring) || ring.length < 4) return null;
      return ring as [number, number][];
    };

    const haversineMeters = (a: [number, number], b: [number, number]): number => {
      const toRad = (d: number) => (d * Math.PI) / 180;
      const R = 6371000;
      const lat1 = toRad(a[1]);
      const lat2 = toRad(b[1]);
      const dLat = toRad(b[1] - a[1]);
      const dLng = toRad(b[0] - a[0]);
      const s1 = Math.sin(dLat / 2);
      const s2 = Math.sin(dLng / 2);
      const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    };

    const ensureClosed = (ring: [number, number][]): [number, number][] => {
      if (!ring.length) return ring;
      const a = ring[0];
      const b = ring[ring.length - 1];
      if (a[0] === b[0] && a[1] === b[1]) return ring;
      return [...ring, [a[0], a[1]]];
    };


    const smoothRing = (ringIn: [number, number][], passes: number): [number, number][] => {
      let ring = ensureClosed(ringIn);
      if (ring.length < 4) return ring;
      const n = ring.length - 1; // last equals first
      for (let p = 0; p < passes; p += 1) {
        const next: [number, number][] = [];
        for (let i = 0; i < n; i += 1) {
          const prev = ring[(i - 1 + n) % n];
          const cur = ring[i];
          const nxt = ring[(i + 1) % n];
          const lng = (prev[0] + 2 * cur[0] + nxt[0]) / 4;
          const lat = (prev[1] + 2 * cur[1] + nxt[1]) / 4;
          next.push([lng, lat]);
        }
        next.push(next[0]);
        ring = next;
      }
      return ring;
    };

    const resampleRing = (ringIn: [number, number][], points: number): [number, number][] => {
      const ring = ensureClosed(ringIn);
      if (ring.length < 2) return ring;

      const cum: number[] = [0];
      for (let i = 1; i < ring.length; i += 1) {
        cum.push(cum[i - 1] + haversineMeters(ring[i - 1], ring[i]));
      }
      const total = cum[cum.length - 1];
      if (!Number.isFinite(total) || total <= 0) return ring;

      const out: [number, number][] = [];
      for (let k = 0; k < points; k += 1) {
        const dist = (total * k) / (points - 1);
        let i = 1;
        while (i < cum.length && cum[i] < dist) i += 1;
        if (i >= cum.length) {
          out.push([ring[ring.length - 1][0], ring[ring.length - 1][1]]);
          continue;
        }
        const d0 = cum[i - 1];
        const d1 = cum[i];
        const t = d1 === d0 ? 0 : (dist - d0) / (d1 - d0);
        const p0 = ring[i - 1];
        const p1 = ring[i];
        out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]);
      }
      return ensureClosed(out);
    };

    const summarizeFc = (fc: any) => {
      try {
        const f0 = fc?.features?.[0];
        const p = f0?.properties;
        const g = f0?.geometry;
        const ring = g?.type === 'Polygon' ? g?.coordinates?.[0] : null;
        const ringLen = Array.isArray(ring) ? ring.length : null;
        let bbox: [number, number, number, number] | null = null;
        if (Array.isArray(ring) && ring.length) {
          let minLng = Infinity;
          let minLat = Infinity;
          let maxLng = -Infinity;
          let maxLat = -Infinity;
          for (const pt of ring) {
            if (!Array.isArray(pt) || pt.length < 2) continue;
            const lng = pt[0];
            const lat = pt[1];
            if (typeof lng !== 'number' || typeof lat !== 'number') continue;
            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;
          }
          if (Number.isFinite(minLng) && Number.isFinite(minLat) && Number.isFinite(maxLng) && Number.isFinite(maxLat)) {
            bbox = [minLng, minLat, maxLng, maxLat];
          }
        }
        const budgetSec = typeof p?.budgetSec === 'number' ? p.budgetSec : null;
        return {
          type: fc?.type,
          features: Array.isArray(fc?.features) ? fc.features.length : null,
          geomType: g?.type ?? null,
          budgetSec,
          ringLen,
          bbox,
        };
      } catch {
        return { error: 'summarize_failed' };
      }
    };

    // IMPORTANT: MapLibre ne rend pas toujours les polygons non fermés.
    // On normalise donc la géométrie avant setData (notamment pour le tout premier budget 20).
    data = normalizeVehicleTrackFc(data);
    const toFeature = (data as any)?.features?.[0];
    const props = toFeature?.properties ?? {};

    const getBudgetSec = (fc: any): number | null => {
      const f0 = fc?.features?.[0];
      const p = f0?.properties;
      const v = p?.budgetSec;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };

    const cloneFcWithRing = (fc: any, ring: [number, number][]) => {
      try {
        const f0 = fc?.features?.[0];
        const g = f0?.geometry;
        if (!f0 || !g || g.type !== 'Polygon') return fc;
        return {
          ...fc,
          features: [
            {
              ...f0,
              geometry: {
                ...g,
                coordinates: [ring, ...(Array.isArray(g.coordinates) ? g.coordinates.slice(1) : [])],
              },
            },
            ...(Array.isArray(fc?.features) ? fc.features.slice(1) : []),
          ],
        };
      } catch {
        return fc;
      }
    };

    const cancelMorph = () => {
      if (vehicleTrackMorphFrameRef.current != null) {
        try {
          cancelAnimationFrame(vehicleTrackMorphFrameRef.current);
        } catch {
          // ignore
        }
        vehicleTrackMorphFrameRef.current = null;
      }
      if (vehicleTrackMorphDelayTimerRef.current != null) {
        try {
          window.clearTimeout(vehicleTrackMorphDelayTimerRef.current);
        } catch {
          // ignore
        }
        vehicleTrackMorphDelayTimerRef.current = null;
      }
      vehicleTrackMorphKeyRef.current = null;
    };

    const applySmoothing = (fc: any): any => {
      try {
        const raw = getRing(fc);
        if (!raw) return fc;
        const points = Math.max(72, Math.min(160, Math.floor(raw.length * 1.35)));
        const ring = smoothRing(resampleRing(raw, points), 2);
        return normalizeVehicleTrackFc(cloneFcWithRing(fc, ring));
      } catch {
        return fc;
      }
    };

    try {
      const budgetLog = typeof props?.budgetSec === 'number' ? props.budgetSec : null;
      // eslint-disable-next-line no-console
      const nextSummary = summarizeFc(data);
      const prevSummary = prevGeo ? summarizeFc(prevGeo) : null;
      console.log('[vehicle-track] render decision', {
        ts: ts(),
        activeVehicleTrackId,
        showActiveVehicleTrack,
        isTestEffective,
        budgetSec: budgetLog,
        hasGeojson: Boolean(data),
        prevKey,
        nextKey: key,
        nextBudgetSec: (nextSummary as any)?.budgetSec ?? null,
        nextRingLen: (nextSummary as any)?.ringLen ?? null,
        nextBbox: (nextSummary as any)?.bbox ?? null,
        prevBudgetSec: (prevSummary as any)?.budgetSec ?? null,
        prevRingLen: (prevSummary as any)?.ringLen ?? null,
        prevBbox: (prevSummary as any)?.bbox ?? null,
        next: nextSummary,
        prev: prevSummary,
      });
    } catch {
      // ignore logging errors
    }

    // Animation morph : on décale l'affichage du prochain isochrone puis on interpole le ring.
    // Objectif: une transition douce et dynamique, même si cela retarde la visualisation.
    const delayMs = 2000;
    const durationMs = 1200;
    const shouldAnimate = (() => {
      if (!prevGeo || !prevKey) return false;
      if (!key || prevKey === key) return false;
      const prevBudget = getBudgetSec(prevGeo);
      const nextBudget = getBudgetSec(data);
      if (typeof prevBudget !== 'number' || typeof nextBudget !== 'number') return false;
      if (nextBudget <= prevBudget) return false;
      return true;
    })();

    if (!showActiveVehicleTrackRef.current) {
      cancelMorph();
      // IMPORTANT: on ne vide pas l'état interne quand l'utilisateur masque la piste.
      // On continue de "rattraper" la forme en mémoire pour pouvoir la réafficher
      // instantanément à la réactivation.
      try {
        vehicleTrackPrevGeojsonRef.current = data;
        vehicleTrackPrevKeyRef.current = key;
      } catch {
        // ignore
      }
      try {
        src.setData(EMPTY_FC as any);
        vehicleTrackLastAppliedGeojsonRef.current = EMPTY_FC;
      } catch {
        // ignore
      }
    } else if (!shouldAnimate) {
      cancelMorph();
      try {
        const smoothed = applySmoothing(data);
        src.setData(smoothed as any);
        vehicleTrackLastAppliedGeojsonRef.current = smoothed;
      } catch {
        // ignore
      }
    } else {
      // Keep previous geometry during delay, then animate to the next one.
      cancelMorph();
      vehicleTrackMorphKeyRef.current = key;

      const prevRingRaw = getRing(prevGeo);
      const nextRingRaw = getRing(data);

      if (!prevRingRaw || !nextRingRaw) {
        try {
          src.setData(data as any);
        } catch {
          // ignore
        }
      } else {
        // Normalize point counts + smooth corners.
        const points = Math.max(72, Math.min(160, Math.floor(Math.max(prevRingRaw.length, nextRingRaw.length) * 1.35)));
        const prevRing = smoothRing(resampleRing(prevRingRaw, points), 2);
        const nextRing = smoothRing(resampleRing(nextRingRaw, points), 2);

        const startFc = normalizeVehicleTrackFc(cloneFcWithRing(data, prevRing));
        try {
          src.setData(startFc as any);
          vehicleTrackLastAppliedGeojsonRef.current = startFc;
        } catch {
          // ignore
        }

        const t0 = performance.now();
        const startAfterDelay = () => {
          const startAnimAt = performance.now();
          const step = () => {
            if (!mapReady) return;
            if (!showActiveVehicleTrackRef.current) return;
            if (vehicleTrackMorphKeyRef.current !== key) return;
            const nowMs = performance.now();
            const p = Math.min(1, Math.max(0, (nowMs - startAnimAt) / durationMs));
            const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
            const out: [number, number][] = [];
            const len = Math.min(prevRing.length, nextRing.length);
            for (let i = 0; i < len; i += 1) {
              const a = prevRing[i];
              const b = nextRing[i];
              out.push([a[0] + (b[0] - a[0]) * eased, a[1] + (b[1] - a[1]) * eased]);
            }
            const ringOut = ensureClosed(out);
            const fcOut = normalizeVehicleTrackFc(cloneFcWithRing(data, ringOut));
            try {
              src.setData(fcOut as any);
              vehicleTrackLastAppliedGeojsonRef.current = fcOut;
            } catch {
              // ignore
            }
            if (p >= 1) {
              vehicleTrackMorphFrameRef.current = null;
              vehicleTrackMorphKeyRef.current = null;
              // La forme affichée est désormais la nouvelle : on met à jour les refs "prev".
              vehicleTrackPrevGeojsonRef.current = data;
              vehicleTrackPrevKeyRef.current = key;
              return;
            }
            vehicleTrackMorphFrameRef.current = requestAnimationFrame(step);
          };
          vehicleTrackMorphFrameRef.current = requestAnimationFrame(step);
        };

        const delayLeft = Math.max(0, delayMs - (performance.now() - t0));
        try {
          vehicleTrackMorphDelayTimerRef.current = window.setTimeout(startAfterDelay, delayLeft);
        } catch {
          // ignore
        }
      }
    }
    try {
      const appliedSummary = summarizeFc(data);
      // eslint-disable-next-line no-console
      console.log('[vehicle-track] render applied', {
        ts: ts(),
        activeVehicleTrackId,
        key,
        appliedBudgetSec: (appliedSummary as any)?.budgetSec ?? null,
        appliedRingLen: (appliedSummary as any)?.ringLen ?? null,
        appliedBbox: (appliedSummary as any)?.bbox ?? null,
        applied: appliedSummary,
      });
    } catch {
      // ignore
    }

    try {
      const map2 = mapInstanceRef.current;
      if (map2) {
        requestAnimationFrame(() => {
          try {
            const layerIds = ['vehicle-track-reached-fill', 'vehicle-track-reached-outline'];
            const layersPresent = layerIds.map((id) => ({ id, present: Boolean(map2.getLayer(id as any)) }));
            const vis = layerIds.map((id) => {
              try {
                return {
                  id,
                  visibility: (map2.getLayoutProperty(id as any, 'visibility') as any) ?? 'visible',
                };
              } catch {
                return { id, visibility: 'unknown' };
              }
            });
            const rendered = map2.queryRenderedFeatures(undefined, { layers: layerIds as any });
            const displayed = rendered.length > 0;
            // IMPORTANT: the retry loop must reapply the exact GeoJSON we actually set on the source.
            // Otherwise, a transient renderedCount=0 (common right after Paw toggle / style rebuild)
            // can cause the retry to push the raw (angular) geometry back onto the map.
            vehicleTrackPendingGeojsonRef.current = vehicleTrackLastAppliedGeojsonRef.current ?? data;
            vehicleTrackPendingKeyRef.current = key;
            vehicleTrackPendingAttemptsRef.current = 0;
            const diag = (() => {
              try {
                const s = summarizeFc(data);
                const bbox = (s as any)?.bbox as [number, number, number, number] | null;
                const f0 = (data as any)?.features?.[0];
                const ring = f0?.geometry?.coordinates?.[0];
                const first = Array.isArray(ring) ? ring[0] : null;
                const last = Array.isArray(ring) ? ring[ring.length - 1] : null;
                const eps2 = 1e-12;
                const closed =
                  Array.isArray(first) &&
                  Array.isArray(last) &&
                  first.length >= 2 &&
                  last.length >= 2 &&
                  Math.abs(first[0] - last[0]) <= eps2 &&
                  Math.abs(first[1] - last[1]) <= eps2;

                const bboxSizeMeters = (() => {
                  if (!bbox) return null;
                  const [minLng, minLat, maxLng, maxLat] = bbox;
                  const midLat = (minLat + maxLat) / 2;
                  // approx meters: use existing haversine util
                  const width = haversineMeters([minLng, midLat], [maxLng, midLat]);
                  const height = haversineMeters([minLng, minLat], [minLng, maxLat]);
                  return { width, height };
                })();

                return {
                  ringLen: (s as any)?.ringLen ?? null,
                  bbox,
                  closed,
                  bboxSizeMeters,
                  zoom: typeof map2?.getZoom === 'function' ? map2.getZoom() : null,
                };
              } catch {
                return { ringLen: null, bbox: null, closed: null };
              }
            })();
            // eslint-disable-next-line no-console
            console.log('[vehicle-track]', ts(), 'VISUAL', {
              phase: 'applied',
              displayed,
              renderedCount: rendered.length,
              paw: showActiveVehicleTrackRef.current,
              activeVehicleTrackId: activeVehicleTrackIdRef.current,
              key,
              diagRingLen: (diag as any)?.ringLen ?? null,
              diagClosed: (diag as any)?.closed ?? null,
              diagBbox: (diag as any)?.bbox ?? null,
              diagBboxSizeMeters: (diag as any)?.bboxSizeMeters ?? null,
              diagZoom: (diag as any)?.zoom ?? null,
              diag,
              layersPresent,
              vis,
            });

            if (!displayed) {
              const scheduleRetry = () => {
                if (!map2 || !showActiveVehicleTrackRef.current) return;
                if (vehicleTrackPendingKeyRef.current !== key) return;
                if (vehicleTrackPendingAttemptsRef.current >= 10) return;

                vehicleTrackPendingAttemptsRef.current += 1;
                reapplyVehicleTrackIfPending();

                requestAnimationFrame(() => {
                  try {
                    const rendered2 = map2.queryRenderedFeatures(undefined, { layers: layerIds as any });
                    const displayed2 = rendered2.length > 0;
                    const diag2 = (() => {
                      try {
                        const s = summarizeFc(vehicleTrackPendingGeojsonRef.current);
                        const bbox = (s as any)?.bbox as [number, number, number, number] | null;
                        const f0 = (vehicleTrackPendingGeojsonRef.current as any)?.features?.[0];
                        const ring = f0?.geometry?.coordinates?.[0];
                        const first = Array.isArray(ring) ? ring[0] : null;
                        const last = Array.isArray(ring) ? ring[ring.length - 1] : null;
                        const eps2 = 1e-12;
                        const closed =
                          Array.isArray(first) &&
                          Array.isArray(last) &&
                          first.length >= 2 &&
                          last.length >= 2 &&
                          Math.abs(first[0] - last[0]) <= eps2 &&
                          Math.abs(first[1] - last[1]) <= eps2;

                        const bboxSizeMeters = (() => {
                          if (!bbox) return null;
                          const [minLng, minLat, maxLng, maxLat] = bbox;
                          const midLat = (minLat + maxLat) / 2;
                          const width = haversineMeters([minLng, midLat], [maxLng, midLat]);
                          const height = haversineMeters([minLng, minLat], [minLng, maxLat]);
                          return { width, height };
                        })();

                        return {
                          ringLen: (s as any)?.ringLen ?? null,
                          bbox,
                          closed,
                          bboxSizeMeters,
                          zoom: typeof map2?.getZoom === 'function' ? map2.getZoom() : null,
                        };
                      } catch {
                        return { ringLen: null, bbox: null, closed: null };
                      }
                    })();
                    // eslint-disable-next-line no-console
                    console.log('[vehicle-track]', ts(), 'VISUAL', {
                      phase: 'retry-reapply',
                      displayed: displayed2,
                      renderedCount: rendered2.length,
                      paw: showActiveVehicleTrackRef.current,
                      activeVehicleTrackId: activeVehicleTrackIdRef.current,
                      key,
                      attempt: vehicleTrackPendingAttemptsRef.current,
                      diagRingLen: (diag2 as any)?.ringLen ?? null,
                      diagClosed: (diag2 as any)?.closed ?? null,
                      diagBbox: (diag2 as any)?.bbox ?? null,
                      diagBboxSizeMeters: (diag2 as any)?.bboxSizeMeters ?? null,
                      diagZoom: (diag2 as any)?.zoom ?? null,
                      diag: diag2,
                    });

                    if (displayed2) {
                      clearPendingVehicleTrack();
                      return;
                    }

                    // Retry again shortly, even if 'idle' never fires (map busy).
                    try {
                      if (vehicleTrackPendingTimerRef.current != null) {
                        window.clearTimeout(vehicleTrackPendingTimerRef.current);
                      }
                      vehicleTrackPendingTimerRef.current = window.setTimeout(scheduleRetry, 200);
                    } catch {
                      // ignore
                    }
                  } catch {
                    // ignore
                  }
                });
              };

              // Try on idle once, plus a timed retry fallback.
              try {
                map2.once('idle', scheduleRetry);
              } catch {
                // ignore
              }
              try {
                if (vehicleTrackPendingTimerRef.current != null) {
                  window.clearTimeout(vehicleTrackPendingTimerRef.current);
                }
                vehicleTrackPendingTimerRef.current = window.setTimeout(scheduleRetry, 200);
              } catch {
                // ignore
              }
            } else {
              clearPendingVehicleTrack();
            }
          } catch {
            // ignore
          }
        });
      }
    } catch {
      // ignore
    }

    // IMPORTANT: ne pas écraser les refs prev pendant une animation en cours,
    // sinon un rerender applique immédiatement la nouvelle géométrie et annule l'effet "delay".
    if (!vehicleTrackMorphKeyRef.current) {
      vehicleTrackPrevGeojsonRef.current = data;
      vehicleTrackPrevKeyRef.current = key;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mapReady,
    styleVersion,
    showActiveVehicleTrack,
    activeVehicleTrackId,
    activeVehicleTrack,
    vehicleTracksLoaded,
    vehicleTrackGeojsonById,
  ]);

  const deleteAllVehicleTracks = async (missionId: string) => {
    try {
      const { tracks } = await listVehicleTracks(missionId, {
        limit: 200,
        offset: 0,
      });
      for (const t of tracks) {
        try {
          await deleteVehicleTrack(missionId, t.id);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    setVehicleTracks([]);
    setVehicleTracksTotal(0);
    setVehicleTrackGeojsonById({});
    setActiveVehicleTrackId(null);
    clearVehicleTrackVisual('person-case-deleted');
  };

  const ensureVehicleTrackLayers = useCallback((map: MapLibreMapInstance) => {
    if (!map.getSource('vehicle-track-reached')) {
      const fromAnyState = (() => {
        const paw = showActiveVehicleTrackRef.current;
        if (!paw) return null;
        const id = activeVehicleTrackIdRef.current;
        const byId = vehicleTrackGeojsonByIdRef.current;
        if (id && (byId as any)?.[id]) return (byId as any)[id] as any;
        const anyId = Object.keys(byId ?? {}).find((k) => Boolean((byId as any)?.[k]));
        return anyId ? ((byId as any)[anyId] as any) : null;
      })();
      const initial =
        fromAnyState ??
        (showActiveVehicleTrackRef.current && vehicleTrackPrevGeojsonRef.current
          ? (vehicleTrackPrevGeojsonRef.current as any)
          : (EMPTY_FC as any));
      map.addSource('vehicle-track-reached', { type: 'geojson', data: initial });
      try {
        const src = map.getSource('vehicle-track-reached') as GeoJSONSource | undefined;
        if (src && showActiveVehicleTrackRef.current) {
          if (fromAnyState) {
            src.setData(fromAnyState as any);
          } else if (vehicleTrackPrevGeojsonRef.current) {
            src.setData(vehicleTrackPrevGeojsonRef.current as any);
          }
        }
      } catch {
        // ignore
      }
    }
    if (!map.getSource('vehicle-track-reached-prev')) {
      map.addSource('vehicle-track-reached-prev', { type: 'geojson', data: EMPTY_FC });
    }
    if (!map.getLayer('vehicle-track-reached-prev-fill')) {
      map.addLayer({
        id: 'vehicle-track-reached-prev-fill',
        type: 'fill',
        source: 'vehicle-track-reached-prev',
        paint: {
          'fill-color': [
            'case',
            ['==', ['get', 'status'], 'DONE'],
            '#eab308',
            '#ef4444',
          ],
          'fill-opacity': 0,
        },
      });
    }
    if (!map.getLayer('vehicle-track-reached-fill')) {
      map.addLayer({
        id: 'vehicle-track-reached-fill',
        type: 'fill',
        source: 'vehicle-track-reached',
        paint: {
          // Rouge pour les tuiles encore en calcul (status !== 'DONE'),
          // jaune pour les tuiles stabilisées (status === 'DONE').
          'fill-color': [
            'case',
            ['==', ['get', 'status'], 'DONE'],
            '#eab308', // jaune pour anciennes tuiles non recalculées
            '#ef4444', // rouge pour nouvelles tuiles / frontière
          ],
          'fill-opacity': 0.18,
        },
      });
    }
    // Affiche la vitesse TomTom moyenne au centre de chaque tuile (si disponible).
    if (!map.getLayer('vehicle-track-reached-speed')) {
      map.addLayer({
        id: 'vehicle-track-reached-speed',
        type: 'symbol',
        source: 'vehicle-track-reached',
        layout: {
          'text-field': [
            'case',
            ['has', 'avgSpeedKmh'],
            ['to-string', ['round', ['coalesce', ['get', 'avgSpeedKmh'], 0]]],
            '',
          ],
          'text-size': 10,
        },
        paint: {
          'text-color': '#111827',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1,
        },
      });
    }
    if (!map.getLayer('vehicle-track-reached-outline')) {
      map.addLayer({
        id: 'vehicle-track-reached-outline',
        type: 'line',
        source: 'vehicle-track-reached',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ef4444',
          'line-width': 2,
        },
      });
    }
    if (!map.getLayer('vehicle-track-reached-prev-outline')) {
      map.addLayer({
        id: 'vehicle-track-reached-prev-outline',
        type: 'line',
        source: 'vehicle-track-reached-prev',
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': '#ef4444',
          'line-width': 2,
          'line-opacity': 0,
        },
      });
    }
  }, []);

  const reinjectVehicleTrackData = useCallback((map: MapLibreMapInstance) => {
    // IMPORTANT: après un rebuild de style, MapLibre recrée les sources.
    // On réinjecte immédiatement la dernière géométrie vehicle-track disponible
    // en utilisant des refs (pas des closures React potentiellement obsolètes).
    try {
      const paw = showActiveVehicleTrackRef.current;
      const src = map.getSource('vehicle-track-reached') as GeoJSONSource | undefined;
      if (paw && src) {
        const byId = vehicleTrackGeojsonByIdRef.current;
        const id = activeVehicleTrackIdRef.current;
        const fromState = id && (byId as any)?.[id] ? (byId as any)[id] : null;
        const anyId = !fromState ? Object.keys(byId ?? {}).find((k) => Boolean((byId as any)?.[k])) : null;
        const fallback = anyId ? (byId as any)[anyId] : null;
        const data = (fromState ?? fallback ?? vehicleTrackPrevGeojsonRef.current ?? EMPTY_FC) as any;
        src.setData(data);
      }
    } catch {
      // ignore
    }
  }, []);

  return {
    hasActiveTestVehicleTrack,
    setActiveVehicleTrackId,
    setShowActiveVehicleTrack,
    setVehicleTrackGeojsonById,
    deleteAllVehicleTracks,
    ensureVehicleTrackLayers,
    reinjectVehicleTrackData,
  };
}

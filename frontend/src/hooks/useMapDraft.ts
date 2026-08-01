import { useEffect, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMapInstance, StyleSpecification } from 'maplibre-gl';
import { haversineMeters } from '../lib/gpsFilter.js';
import { circleToPolygon, closeRing } from '../lib/zoneGeometry.js';
import { createPoi, createZone, updatePoi, type ApiPoi, type ApiZone } from '../lib/api';

// Brouillon d'objet en cours de placement sur la carte.
//
// Le sous-système est un seul et même bloc pour les POI et les zones: `activeTool`
// est un état unique à quatre valeurs, `draftLngLat` / `draftColor` / le formulaire
// de validation et `submitDraft` sont partagés. Découper "zone" de "POI" ici
// obligerait à dupliquer l'outil actif, le handler de clic carte et la validation:
// le hook prend donc les deux, comme le composant le faisait.

export type DraftTool = 'none' | 'poi' | 'zone_circle' | 'zone_polygon';

export type UseMapDraftParams = {
  mapInstanceRef: React.MutableRefObject<MapLibreMapInstance | null>;
  mapReady: boolean;
  /** Fond de carte courant: dépendance des effets qui réinjectent le brouillon après un rebuild de style. */
  currentBaseStyle: StyleSpecification | undefined;
  selectedMissionId: string | null;
  pois: ApiPoi[];
  setPois: React.Dispatch<React.SetStateAction<ApiPoi[]>>;
  zones: ApiZone[];
  setZones: React.Dispatch<React.SetStateAction<ApiZone[]>>;
  /** Socket de la mission: sert à distinguer une panne réseau d'une erreur serveur. */
  socketRef: { readonly current: { connected: boolean } | null };
  enqueueAction: (missionId: string, action: any) => void;
  currentUserId: string | null;
};

export type UseMapDraftResult = {
  activeTool: DraftTool;
  setActiveTool: React.Dispatch<React.SetStateAction<DraftTool>>;
  /** Miroir de `activeTool` lisible depuis les closures longue durée (clic sur un marqueur POI). */
  activeToolRef: React.MutableRefObject<DraftTool>;
  setDraftLngLat: React.Dispatch<React.SetStateAction<{ lng: number; lat: number } | null>>;
  draftTitle: string;
  setDraftTitle: React.Dispatch<React.SetStateAction<string>>;
  draftComment: string;
  setDraftComment: React.Dispatch<React.SetStateAction<string>>;
  draftColor: string;
  setDraftColor: React.Dispatch<React.SetStateAction<string>>;
  draftIcon: string;
  setDraftIcon: React.Dispatch<React.SetStateAction<string>>;
  showValidation: boolean;
  setShowValidation: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingPoiId: React.Dispatch<React.SetStateAction<string | null>>;
  actionBusy: boolean;
  setActionBusy: React.Dispatch<React.SetStateAction<boolean>>;
  actionError: string | null;
  setActionError: React.Dispatch<React.SetStateAction<string | null>>;
  cancelDraft: () => void;
  submitDraft: () => Promise<void>;
  /** À appeler depuis `ensureOverlays`: crée les sources/couches MapLibre du brouillon. */
  ensureDraftLayers: (map: MapLibreMapInstance) => void;
  /** À appeler quand la carte vient d'être créée ou son style reconstruit: réinjecte le brouillon. */
  resyncDraftOverlays: (map: MapLibreMapInstance) => void;
};

export function useMapDraft({
  mapInstanceRef,
  mapReady,
  currentBaseStyle,
  selectedMissionId,
  pois,
  setPois,
  zones,
  setZones,
  socketRef,
  enqueueAction,
  currentUserId,
}: UseMapDraftParams): UseMapDraftResult {
  const polygonDraftRef = useRef<[number, number][]>([]);

  const [editingPoiId, setEditingPoiId] = useState<string | null>(null);

  const [activeTool, setActiveTool] = useState<DraftTool>('none');
  const [draftLngLat, setDraftLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [draftCircleRadius, setDraftCircleRadius] = useState(250);
  const [draftCircleEdgeLngLat, setDraftCircleEdgeLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [circleRadiusReady, setCircleRadiusReady] = useState(false);
  const [polygonDraftCount, setPolygonDraftCount] = useState(0);

  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const draftLngLatRef = useRef(draftLngLat);
  useEffect(() => {
    draftLngLatRef.current = draftLngLat;
  }, [draftLngLat]);

  const draftCircleEdgeLngLatRef = useRef(draftCircleEdgeLngLat);
  useEffect(() => {
    draftCircleEdgeLngLatRef.current = draftCircleEdgeLngLat;
  }, [draftCircleEdgeLngLat]);

  const draftCircleRadiusRef = useRef(draftCircleRadius);
  useEffect(() => {
    draftCircleRadiusRef.current = draftCircleRadius;
  }, [draftCircleRadius]);

  const [showValidation, setShowValidation] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftComment, setDraftComment] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [draftIcon, setDraftIcon] = useState('');

  const draftColorRef = useRef(draftColor);
  useEffect(() => {
    draftColorRef.current = draftColor;
  }, [draftColor]);

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function ensureDraftLayers(map: MapLibreMapInstance) {
    if (!map.getSource('draft-zone')) {
      map.addSource('draft-zone', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('draft-poi')) {
      map.addSource('draft-poi', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('draft-poi')) {
      map.addLayer({
        id: 'draft-poi',
        type: 'circle',
        source: 'draft-poi',
        paint: {
          'circle-radius': 9,
          'circle-color': ['coalesce', ['get', 'color'], '#f97316'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
    }
    if (!map.getLayer('draft-zone-fill')) {
      map.addLayer({
        id: 'draft-zone-fill',
        type: 'fill',
        source: 'draft-zone',
        filter: ['==', ['get', 'kind'], 'fill'],
        paint: { 'fill-color': ['coalesce', ['get', 'color'], '#2563eb'], 'fill-opacity': 0.18 },
      });
    }
    if (!map.getLayer('draft-zone-outline')) {
      map.addLayer({
        id: 'draft-zone-outline',
        type: 'line',
        source: 'draft-zone',
        filter: ['any', ['==', ['get', 'kind'], 'fill'], ['==', ['get', 'kind'], 'line']],
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#2563eb'], 'line-width': 3, 'line-dasharray': [2, 1] },
      });
    }
    if (!map.getLayer('draft-zone-points')) {
      map.addLayer({
        id: 'draft-zone-points',
        type: 'circle',
        source: 'draft-zone',
        filter: ['==', ['get', 'kind'], 'point'],
        paint: { 'circle-radius': 6, 'circle-color': ['coalesce', ['get', 'color'], '#2563eb'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
    }
  }

  // Les valeurs sont lues via les refs: cette fonction est appelée depuis des closures
  // MapLibre longue durée (`load`, `styledata`) qui capturent un rendu ancien.
  function resyncDraftOverlays(map: MapLibreMapInstance) {
    const draftZoneSource = map.getSource('draft-zone') as GeoJSONSource | undefined;
    const draftPoiSource = map.getSource('draft-poi') as GeoJSONSource | undefined;

    if (draftPoiSource) {
      const tool = activeToolRef.current;
      const d = draftLngLatRef.current;
      const color = draftColorRef.current;
      if (tool === 'poi' && d) {
        draftPoiSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: { color },
              geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
            },
          ],
        } as any);
      } else {
        draftPoiSource.setData({ type: 'FeatureCollection', features: [] } as any);
      }
    }

    if (draftZoneSource) {
      const features: any[] = [];

      const tool = activeToolRef.current;
      const d = draftLngLatRef.current;
      const edge = draftCircleEdgeLngLatRef.current;
      const radius = draftCircleRadiusRef.current;
      const color = draftColorRef.current;

      if (tool === 'zone_circle' && d) {
        features.push({
          type: 'Feature',
          properties: { kind: 'point', color },
          geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
        });

        if (edge) {
          features.push({
            type: 'Feature',
            properties: { kind: 'fill', color },
            geometry: circleToPolygon({ lng: d.lng, lat: d.lat }, radius),
          });
          features.push({
            type: 'Feature',
            properties: { kind: 'line', color },
            geometry: {
              type: 'LineString',
              coordinates: [
                [d.lng, d.lat],
                [edge.lng, edge.lat],
              ],
            },
          });
          features.push({
            type: 'Feature',
            properties: { kind: 'point', color },
            geometry: { type: 'Point', coordinates: [edge.lng, edge.lat] },
          });
        }
      }

      if (tool === 'zone_polygon') {
        const coords = polygonDraftRef.current;
        for (const c of coords) {
          features.push({
            type: 'Feature',
            properties: { kind: 'point', color },
            geometry: { type: 'Point', coordinates: c },
          });
        }

        if (coords.length >= 2) {
          features.push({
            type: 'Feature',
            properties: { kind: 'line', color },
            geometry: { type: 'LineString', coordinates: coords },
          });
        }

        if (coords.length >= 3) {
          features.push({
            type: 'Feature',
            properties: { kind: 'fill', color },
            geometry: { type: 'Polygon', coordinates: [closeRing(coords)] },
          });
        }
      }

      draftZoneSource.setData({ type: 'FeatureCollection', features } as any);
    }
  }

  function openValidation() {
    setActionError(null);
    setShowValidation(true);
  }

  function undoPolygonPoint() {
    if (activeTool !== 'zone_polygon') return;
    const coords = polygonDraftRef.current;
    if (coords.length === 0) return;
    polygonDraftRef.current = coords.slice(0, -1);
    setPolygonDraftCount(polygonDraftRef.current.length);
    const next = polygonDraftRef.current;
    if (next.length === 0) {
      setDraftLngLat(null);
    } else {
      const last = next[next.length - 1];
      setDraftLngLat({ lng: last[0], lat: last[1] });
    }
  }

  function validatePolygon() {
    if (activeTool !== 'zone_polygon') return;
    if (polygonDraftRef.current.length < 3) {
      setActionError('Polygone: au moins 3 points');
      return;
    }
    openValidation();
  }

  function validateCircleDraft() {
    if (activeTool !== 'zone_circle') return;
    if (!draftLngLat) {
      setActionError('Centre requis');
      return;
    }
    if (!circleRadiusReady) {
      setActionError('Rayon requis');
      return;
    }
    openValidation();
  }

  function cancelDraft() {
    setActiveTool('none');
    setDraftLngLat(null);
    setDraftCircleEdgeLngLat(null);
    setCircleRadiusReady(false);
    polygonDraftRef.current = [];
    setPolygonDraftCount(0);
    setShowValidation(false);
    setEditingPoiId(null);
    setActionError(null);
  }

  useEffect(() => {
    const mode = activeTool === 'zone_circle' || activeTool === 'zone_polygon';
    try {
      window.dispatchEvent(
        new CustomEvent('geogn:zone:draftState', {
          detail: {
            activeTool,
            active: mode,
            circleRadiusReady,
            polygonPoints: polygonDraftCount,
            hasCenter: !!draftLngLat,
          },
        })
      );
    } catch {
      // ignore
    }
  }, [activeTool, circleRadiusReady, polygonDraftCount, draftLngLat]);

  useEffect(() => {
    const onCancel = () => {
      if (activeTool !== 'zone_circle' && activeTool !== 'zone_polygon') return;

      if (activeTool === 'zone_polygon') {
        if (polygonDraftRef.current.length > 0) {
          undoPolygonPoint();
          return;
        }
        cancelDraft();
        return;
      }

      cancelDraft();
    };
    const onValidate = () => {
      if (activeTool === 'zone_polygon') {
        validatePolygon();
      } else if (activeTool === 'zone_circle') {
        validateCircleDraft();
      }
    };

    window.addEventListener('geogn:zone:draftCancel', onCancel as any);
    window.addEventListener('geogn:zone:draftValidate', onValidate as any);
    return () => {
      window.removeEventListener('geogn:zone:draftCancel', onCancel as any);
      window.removeEventListener('geogn:zone:draftValidate', onValidate as any);
    };
  }, [activeTool, circleRadiusReady, polygonDraftCount, draftLngLat]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    const src = map.getSource('draft-zone') as GeoJSONSource | undefined;
    if (!src) return;

    const features: any[] = [];

    if (activeTool === 'zone_circle' && draftLngLat) {
      // Toujours afficher le point central dès le premier clic.
      features.push({
        type: 'Feature',
        properties: { kind: 'point', color: draftColor },
        geometry: { type: 'Point', coordinates: [draftLngLat.lng, draftLngLat.lat] },
      });

      // Ne dessiner le cercle et le rayon qu'une fois le deuxième point posé.
      if (draftCircleEdgeLngLat) {
        features.push({
          type: 'Feature',
          properties: { kind: 'fill', color: draftColor },
          geometry: circleToPolygon({ lng: draftLngLat.lng, lat: draftLngLat.lat }, draftCircleRadius),
        });

        features.push({
          type: 'Feature',
          properties: { kind: 'line', color: draftColor },
          geometry: {
            type: 'LineString',
            coordinates: [
              [draftLngLat.lng, draftLngLat.lat],
              [draftCircleEdgeLngLat.lng, draftCircleEdgeLngLat.lat],
            ],
          },
        });
        features.push({
          type: 'Feature',
          properties: { kind: 'point', color: draftColor },
          geometry: { type: 'Point', coordinates: [draftCircleEdgeLngLat.lng, draftCircleEdgeLngLat.lat] },
        });
      }
    }

    if (activeTool === 'zone_polygon') {
      const coords = polygonDraftRef.current;
      for (const c of coords) {
        features.push({
          type: 'Feature',
          properties: { kind: 'point', color: draftColor },
          geometry: { type: 'Point', coordinates: c },
        });
      }

      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { kind: 'line', color: draftColor },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }

      if (coords.length >= 3) {
        features.push({
          type: 'Feature',
          properties: { kind: 'fill', color: draftColor },
          geometry: { type: 'Polygon', coordinates: [closeRing(coords)] },
        });
      }
    }

    src.setData({ type: 'FeatureCollection', features });
  }, [activeTool, draftLngLat, draftCircleRadius, draftColor, draftCircleEdgeLngLat, mapReady, currentBaseStyle]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    const src = map.getSource('draft-zone') as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({ type: 'FeatureCollection', features: [] });
  }, [selectedMissionId, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const onClick = (e: any) => {
      if (activeTool === 'none') return;
      const lng = e.lngLat.lng;
      const lat = e.lngLat.lat;

      if (activeTool === 'poi') {
        setDraftLngLat({ lng, lat });
        openValidation();
        return;
      }

      if (activeTool === 'zone_circle') {
        if (!draftLngLat) {
          setDraftLngLat({ lng, lat });
          setDraftCircleEdgeLngLat(null);
          setCircleRadiusReady(false);
          return;
        }

        const center = draftLngLat;
        const edge = { lng, lat };
        const computed = haversineMeters(center, edge);
        const nextRadius = Math.max(0, Math.round(computed));
        setDraftCircleRadius(nextRadius);
        setDraftCircleEdgeLngLat(edge);
        setCircleRadiusReady(true);
        return;
      }

      if (activeTool === 'zone_polygon') {
        polygonDraftRef.current = [...polygonDraftRef.current, [lng, lat]];
        setPolygonDraftCount(polygonDraftRef.current.length);
        setDraftLngLat({ lng, lat });
      }
    };

    map.on('click', onClick);

    return () => {
      map.off('click', onClick);
    };
  }, [activeTool, mapReady, draftLngLat]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    const src = map.getSource('draft-zone') as GeoJSONSource | undefined;
    if (!src) return;
    if (activeTool === 'none' || activeTool === 'poi') {
      src.setData({ type: 'FeatureCollection', features: [] });
    }
  }, [activeTool, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    const src = map.getSource('draft-poi') as GeoJSONSource | undefined;
    if (!src) return;

    if (activeTool === 'poi' && draftLngLat) {
      src.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { color: draftColor },
            geometry: { type: 'Point', coordinates: [draftLngLat.lng, draftLngLat.lat] },
          },
        ],
      } as any);
    } else {
      src.setData({ type: 'FeatureCollection', features: [] } as any);
    }
  }, [activeTool, draftLngLat, draftColor, mapReady, currentBaseStyle]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    // Zone creation UX:
    // - In normal mode: 1 finger drag to pan.
    // - While creating a zone: require 2 fingers to pan so a single tap places points.
    const coop: any = (map as any).cooperativeGestures;
    if (activeTool === 'zone_circle' || activeTool === 'zone_polygon') {
      if (coop?.enable) coop.enable();
    } else {
      if (coop?.disable) coop.disable();
    }

    if (activeTool === 'zone_polygon') {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }

    // Keep dragPan enabled; cooperativeGestures will handle the 2-finger requirement in zone modes.
    map.dragPan.enable();
  }, [activeTool, mapReady]);

  async function submitDraft() {
    if (!selectedMissionId) return;
    if (!draftLngLat) {
      setActionError('Position requise');
      return;
    }
    if (!draftTitle.trim()) {
      setActionError('Titre requis');
      return;
    }

    if (activeTool === 'poi') {
      if (!draftColor.trim()) {
        setActionError('Couleur requise');
        return;
      }
      if (!draftIcon.trim()) {
        setActionError('Icône requise');
        return;
      }
    }

    const nextTitle = draftTitle.trim();
    const nextKey = nextTitle.toLowerCase();
    if (activeTool === 'poi') {
      const dup = pois.some((p) => p.id !== editingPoiId && p.title.trim().toLowerCase() === nextKey);
      if (dup) {
        setActionError('Ce titre est déjà utilisé');
        return;
      }
    }
    if (activeTool === 'zone_circle' || activeTool === 'zone_polygon') {
      const dup = zones.some((z) => z.title.trim().toLowerCase() === nextKey);
      if (dup) {
        setActionError('Ce titre est déjà utilisé');
        return;
      }
    }

    setActionBusy(true);
    setActionError(null);
    try {
      if (activeTool === 'poi') {
        if (editingPoiId) {
          const updated = await updatePoi(selectedMissionId, editingPoiId, {
            title: nextTitle,
            icon: draftIcon,
            color: draftColor,
            comment: draftComment.trim() || '-',
            lng: draftLngLat.lng,
            lat: draftLngLat.lat,
          });
          setPois((prev: ApiPoi[]) => prev.map((p) => (p.id === editingPoiId ? updated : p)));
        } else {
          const created = await createPoi(selectedMissionId, {
            type: 'autre',
            title: nextTitle,
            icon: draftIcon,
            color: draftColor,
            comment: draftComment.trim() || '-',
            lng: draftLngLat.lng,
            lat: draftLngLat.lat,
          });
          setPois((prev: ApiPoi[]) => [created, ...prev]);
        }
      }

      if (activeTool === 'zone_circle') {
        const created = await createZone(selectedMissionId, {
          type: 'circle',
          title: nextTitle,
          comment: draftComment.trim() || '',
          color: draftColor,
          circle: { center: { lng: draftLngLat.lng, lat: draftLngLat.lat }, radiusMeters: draftCircleRadius },
        });
        setZones((prev: ApiZone[]) => [created, ...prev]);
      }

      if (activeTool === 'zone_polygon') {
        const coords = polygonDraftRef.current;
        if (coords.length < 3) {
          setActionError('Polygone: au moins 3 points');
          setActionBusy(false);
          return;
        }
        const created = await createZone(selectedMissionId, {
          type: 'polygon',
          title: nextTitle,
          comment: draftComment.trim() || '',
          color: draftColor,
          polygon: { type: 'Polygon', coordinates: [closeRing(coords)] },
        });
        setZones((prev: ApiZone[]) => [created, ...prev]);
      }

      setDraftTitle('');
      setDraftComment('');
      setDraftColor('');
      setDraftIcon('');
      setEditingPoiId(null);
      setShowValidation(false);
      setActiveTool('none');
      setDraftLngLat(null);
      polygonDraftRef.current = [];
    } catch (e: any) {
      // Offline fallback: queue the action and apply optimistic update locally.
      const offline = !navigator.onLine || !socketRef.current?.connected;
      if (offline && selectedMissionId) {
        try {
          if (activeTool === 'poi') {
            if (editingPoiId) {
              const payload = {
                title: nextTitle,
                icon: draftIcon,
                color: draftColor,
                comment: draftComment.trim() || '-',
                lng: draftLngLat!.lng,
                lat: draftLngLat!.lat,
              };
              // optimistic
              setPois((prev) => prev.map((p) => (p.id === editingPoiId ? { ...p, ...payload } : p)));
              enqueueAction(selectedMissionId, { entity: 'poi', op: 'update', id: editingPoiId, payload, t: Date.now() });
            } else {
              const localId = `local-${Date.now()}`;
              const payload = {
                type: 'autre',
                title: nextTitle,
                icon: draftIcon,
                color: draftColor,
                comment: draftComment.trim() || '-',
                lng: draftLngLat!.lng,
                lat: draftLngLat!.lat,
              };
              const optimistic: ApiPoi = {
                id: localId,
                type: 'autre',
                title: payload.title,
                icon: payload.icon,
                color: payload.color,
                comment: payload.comment,
                lng: payload.lng,
                lat: payload.lat,
                createdBy: currentUserId ?? 'offline',
                createdAt: new Date().toISOString(),
              };
              setPois((prev) => [optimistic, ...prev]);
              enqueueAction(selectedMissionId, { entity: 'poi', op: 'create', localId, payload, t: Date.now() });
            }
          }

          if (activeTool === 'zone_circle' || activeTool === 'zone_polygon') {
            const localId = `local-${Date.now()}`;
            const payload: any = (activeTool === 'zone_circle')
              ? {
                  type: 'circle',
                  title: nextTitle,
                  comment: draftComment.trim() || '',
                  color: draftColor,
                  circle: { center: { lng: draftLngLat!.lng, lat: draftLngLat!.lat }, radiusMeters: draftCircleRadius },
                }
              : {
                  type: 'polygon',
                  title: nextTitle,
                  comment: draftComment.trim() || '',
                  color: draftColor,
                  polygon: { type: 'Polygon', coordinates: [closeRing(polygonDraftRef.current)] },
                };
            const optimistic: ApiZone = {
              id: localId,
              title: payload.title,
              comment: payload.comment,
              color: payload.color,
              type: payload.type,
              circle: null,
              polygon: payload.polygon,
              grid: null,
              sectors: null,
              assignments: [],
              createdBy: currentUserId ?? '',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            // TODO: use optimistic update
            void optimistic;

          // close modal as success
          setDraftTitle('');
          setDraftComment('');
          setDraftColor('');
          setDraftIcon('');
          setEditingPoiId(null);
          setShowValidation(false);
          setActiveTool('none');
          setDraftLngLat(null);
          polygonDraftRef.current = [];
          return;
        }
        } catch {
          // fallthrough
        }
      }
      setActionError(e?.message ?? 'Erreur');
    } finally {
      setActionBusy(false);
    }
  }

  return {
    activeTool,
    setActiveTool,
    activeToolRef,
    setDraftLngLat,
    draftTitle,
    setDraftTitle,
    draftComment,
    setDraftComment,
    draftColor,
    setDraftColor,
    draftIcon,
    setDraftIcon,
    showValidation,
    setShowValidation,
    setEditingPoiId,
    actionBusy,
    setActionBusy,
    actionError,
    setActionError,
    cancelDraft,
    submitDraft,
    ensureDraftLayers,
    resyncDraftOverlays,
  };
}

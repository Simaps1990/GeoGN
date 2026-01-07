import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMapInstance, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertTriangle, Circle, Compass, Crosshair, Flag, HelpCircle, Layers, MapPin, Minus, Pencil, Plus, Skull, Target, X } from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAuth } from '../contexts/AuthContext';
import { useMission } from '../contexts/MissionContext';
import { getSocket } from '../lib/socket';
import { createPoi, createZone, listPois, listZones, type ApiPoi, type ApiZone } from '../lib/api';

function getRasterStyle(tiles: string[], attribution: string) {
  const style: StyleSpecification = {
    version: 8,
    sources: {
      raster: {
        type: 'raster',
        tiles,
        tileSize: 256,
        attribution,
      },
    },
    layers: [
      {
        id: 'raster',
        type: 'raster',
        source: 'raster',
      },
    ],
  };

  return style;
}

function circleToPolygon(center: { lng: number; lat: number }, radiusMeters: number, steps = 64) {
  const latRad = (center.lat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos(latRad);

  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dx = Math.cos(a) * radiusMeters;
    const dy = Math.sin(a) * radiusMeters;
    const lng = center.lng + dx / metersPerDegLng;
    const lat = center.lat + dy / metersPerDegLat;
    coords.push([lng, lat]);
  }

  return { type: 'Polygon' as const, coordinates: [coords] };
}

export default function MapLibreMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapLibreMapInstance | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  const poiMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const polygonDraftRef = useRef<[number, number][]>([]);

  const [lastPos, setLastPos] = useState<{ lng: number; lat: number } | null>(null);
  const [tracePoints, setTracePoints] = useState<{ lng: number; lat: number; t: number }[]>([]);
  const [otherPositions, setOtherPositions] = useState<Record<string, { lng: number; lat: number; t: string }>>({});
  const [pois, setPois] = useState<ApiPoi[]>([]);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const [baseStyleIndex, setBaseStyleIndex] = useState(0);

  const [zoneMenuOpen, setZoneMenuOpen] = useState(false);

  const [activeTool, setActiveTool] = useState<'none' | 'poi' | 'zone_circle' | 'zone_polygon'>('none');
  const [draftLngLat, setDraftLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [draftCircleRadius, setDraftCircleRadius] = useState(250);

  const [showValidation, setShowValidation] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftComment, setDraftComment] = useState('');
  const [draftColor, setDraftColor] = useState('#f97316');
  const [draftIcon, setDraftIcon] = useState('target');

  const poiColorOptions = useMemo(
    () => ['#3b82f6', '#22c55e', '#f97316', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#64748b'],
    []
  );

  const poiIconOptions = useMemo(
    () => [
      { id: 'target', Icon: Target, label: 'Target' },
      { id: 'flag', Icon: Flag, label: 'Flag' },
      { id: 'alert', Icon: AlertTriangle, label: 'Alert' },
      { id: 'help', Icon: HelpCircle, label: 'Help' },
      { id: 'skull', Icon: Skull, label: 'Skull' },
    ],
    []
  );

  function getPoiIconComponent(iconId: string) {
    return poiIconOptions.find((x) => x.id === iconId)?.Icon ?? MapPin;
  }

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { user } = useAuth();
  const { selectedMissionId } = useMission();

  const mapViewKey = selectedMissionId ? `geotacops.mapView.${selectedMissionId}` : null;

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!mapViewKey) return;

    const saved = localStorage.getItem(mapViewKey);
    if (!saved) return;
    try {
      const v = JSON.parse(saved) as any;
      if (v && typeof v.lng === 'number' && typeof v.lat === 'number') {
        map.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom ?? map.getZoom(), bearing: v.bearing ?? 0, pitch: v.pitch ?? 0 });
      }
    } catch {
      // ignore
    }
  }, [mapReady, mapViewKey]);

  function centerOnMe() {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (lastPos) {
      map.easeTo({ center: [lastPos.lng, lastPos.lat], zoom: Math.max(map.getZoom(), 16) });
      return;
    }
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map.easeTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: Math.max(map.getZoom(), 16) });
      },
      () => {}
    );
  }

  const baseStyles = useMemo(
    () => [
      {
        id: 'plan',
        style: getRasterStyle(
          [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          '© OpenStreetMap contributors'
        ),
      },
      {
        id: 'topo',
        style: getRasterStyle(
          [
            'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
            'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
            'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
          ],
          '© OpenTopoMap (CC-BY-SA) / © OpenStreetMap contributors'
        ),
      },
      {
        id: 'light',
        style: getRasterStyle(
          [
            'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
            'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          ],
          '© OpenStreetMap contributors © CARTO'
        ),
      },
      {
        id: 'sat',
        style: getRasterStyle(
          ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          'Tiles © Esri'
        ),
      },
    ],
    []
  );

  const currentBaseStyle = baseStyles[baseStyleIndex]?.style;

  function toggleMapStyle() {
    setBaseStyleIndex((i) => (i + 1) % baseStyles.length);
  }

  function zoomIn() {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.zoomIn();
  }

  function zoomOut() {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.zoomOut();
  }

  function resetNorth() {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.easeTo({ bearing: 0, pitch: 0 });
  }

  function ensureOverlays(map: MapLibreMapInstance) {
    if (!map.getSource('me')) {
      map.addSource('me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('me-dot')) {
      map.addLayer({
        id: 'me-dot',
        type: 'circle',
        source: 'me',
        paint: {
          'circle-radius': 7,
          'circle-color': '#3B82F6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    if (!map.getSource('trace')) {
      map.addSource('trace', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('trace-line')) {
      map.addLayer({
        id: 'trace-line',
        type: 'line',
        source: 'trace',
        paint: { 'line-color': '#00ff00', 'line-width': 4 },
      });
    }

    if (!map.getSource('others')) {
      map.addSource('others', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('others-points')) {
      map.addLayer({
        id: 'others-points',
        type: 'circle',
        source: 'others',
        paint: { 'circle-radius': 6, 'circle-color': '#2563eb', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
    }

    if (!map.getSource('pois')) {
      map.addSource('pois', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('pois')) {
      map.addLayer({
        id: 'pois',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': 7,
          'circle-color': ['coalesce', ['get', 'color'], '#f97316'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0,
        },
      });
    }

    if (!map.getSource('zones')) {
      map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('zones-fill')) {
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: { 'fill-color': ['coalesce', ['get', 'color'], '#22c55e'], 'fill-opacity': 0.12 },
      });
    }
    if (!map.getLayer('zones-outline')) {
      map.addLayer({
        id: 'zones-outline',
        type: 'line',
        source: 'zones',
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#16a34a'], 'line-width': 2 },
      });
    }

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
        paint: { 'fill-color': ['coalesce', ['get', 'color'], '#22c55e'], 'fill-opacity': 0.18 },
      });
    }
    if (!map.getLayer('draft-zone-outline')) {
      map.addLayer({
        id: 'draft-zone-outline',
        type: 'line',
        source: 'draft-zone',
        filter: ['any', ['==', ['get', 'kind'], 'fill'], ['==', ['get', 'kind'], 'line']],
        paint: { 'line-color': ['coalesce', ['get', 'color'], '#22c55e'], 'line-width': 3, 'line-dasharray': [2, 1] },
      });
    }
    if (!map.getLayer('draft-zone-points')) {
      map.addLayer({
        id: 'draft-zone-points',
        type: 'circle',
        source: 'draft-zone',
        filter: ['==', ['get', 'kind'], 'point'],
        paint: { 'circle-radius': 6, 'circle-color': ['coalesce', ['get', 'color'], '#22c55e'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
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

  function cancelDraft() {
    setActiveTool('none');
    setDraftLngLat(null);
    polygonDraftRef.current = [];
    setShowValidation(false);
    setActionError(null);
  }

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    const src = map.getSource('draft-zone') as GeoJSONSource | undefined;
    if (!src) return;

    const features: any[] = [];

    if (activeTool === 'zone_circle' && draftLngLat) {
      features.push({
        type: 'Feature',
        properties: { kind: 'fill', color: draftColor },
        geometry: circleToPolygon({ lng: draftLngLat.lng, lat: draftLngLat.lat }, draftCircleRadius),
      });
      features.push({
        type: 'Feature',
        properties: { kind: 'point', color: draftColor },
        geometry: { type: 'Point', coordinates: [draftLngLat.lng, draftLngLat.lat] },
      });
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
        const ring = [...coords, coords[0]];
        features.push({
          type: 'Feature',
          properties: { kind: 'fill', color: draftColor },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      }
    }

    src.setData({ type: 'FeatureCollection', features });
  }, [activeTool, draftLngLat, draftCircleRadius, draftColor, mapReady]);

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

      if (activeTool === 'poi' || activeTool === 'zone_circle') {
        setDraftLngLat({ lng, lat });
        openValidation();
        return;
      }

      if (activeTool === 'zone_polygon') {
        polygonDraftRef.current = [...polygonDraftRef.current, [lng, lat]];
        setDraftLngLat({ lng, lat });
      }
    };

    map.on('click', onClick);

    return () => {
      map.off('click', onClick);
    };
  }, [activeTool, mapReady]);

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

  async function confirmCreate() {
    if (!selectedMissionId) return;
    if (!draftLngLat) {
      setActionError('Position requise');
      return;
    }
    if (!draftTitle.trim()) {
      setActionError('Titre requis');
      return;
    }

    const nextTitle = draftTitle.trim();
    const nextKey = nextTitle.toLowerCase();
    if (activeTool === 'poi') {
      const dup = pois.some((p) => p.title.trim().toLowerCase() === nextKey);
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

      if (activeTool === 'zone_circle') {
        const created = await createZone(selectedMissionId, {
          type: 'circle',
          title: nextTitle,
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
        const ring = [...coords, coords[0]];
        const created = await createZone(selectedMissionId, {
          type: 'polygon',
          title: nextTitle,
          color: draftColor,
          polygon: { type: 'Polygon', coordinates: [ring] },
        });
        setZones((prev: ApiZone[]) => [created, ...prev]);
      }

      setDraftTitle('');
      setDraftComment('');
      setDraftColor('#f97316');
      setDraftIcon('target');
      setShowValidation(false);
      setActiveTool('none');
      setDraftLngLat(null);
      polygonDraftRef.current = [];
    } catch (e: any) {
      setActionError(e?.message ?? 'Erreur');
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current) return;

    setMapReady(false);

    if (!currentBaseStyle) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: currentBaseStyle,
      center: [2.3522, 48.8566],
      zoom: 13,
    });

    const onLoad = () => {
      ensureOverlays(map);
      setMapReady(true);
    };

    const onStyleLoad = () => {
      ensureOverlays(map);
      setMapReady(true);
    };

    map.on('load', onLoad);
    map.on('style.load', onStyleLoad);

    mapInstanceRef.current = map;

    return () => {
      map.off('load', onLoad);
      map.off('style.load', onStyleLoad);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!currentBaseStyle) return;
    setMapReady(false);
    map.setStyle(currentBaseStyle);
  }, [currentBaseStyle]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!mapViewKey) return;

    const save = () => {
      const c = map.getCenter();
      const payload = { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
      localStorage.setItem(mapViewKey, JSON.stringify(payload));
    };

    map.on('moveend', save);
    map.on('zoomend', save);
    map.on('rotateend', save);
    map.on('pitchend', save);

    return () => {
      map.off('moveend', save);
      map.off('zoomend', save);
      map.off('rotateend', save);
      map.off('pitchend', save);
    };
  }, [mapReady, mapViewKey]);

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
  }, [activeTool, draftLngLat, draftColor, mapReady]);

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

  useEffect(() => {
    if (!selectedMissionId) return;

    const socket = getSocket();
    socketRef.current = socket;

    socket.emit('mission:join', { missionId: selectedMissionId });

    const onPos = (msg: any) => {
      if (!msg?.userId || typeof msg.lng !== 'number' || typeof msg.lat !== 'number') return;
      if (user?.id && msg.userId === user.id) return;
      setOtherPositions((prev) => ({
        ...prev,
        [msg.userId]: { lng: msg.lng, lat: msg.lat, t: msg.t },
      }));
    };

    socket.on('position:update', onPos);

    const onPoiCreated = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.poi?.id) return;
      setPois((prev) => {
        const exists = prev.some((p) => p.id === msg.poi.id);
        if (exists) return prev;
        return [msg.poi as ApiPoi, ...prev];
      });
    };
    const onPoiUpdated = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.poi?.id) return;
      setPois((prev) => prev.map((p) => (p.id === msg.poi.id ? (msg.poi as ApiPoi) : p)));
    };
    const onPoiDeleted = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.poiId) return;
      setPois((prev) => prev.filter((p) => p.id !== msg.poiId));
    };

    const onZoneCreated = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.zone?.id) return;
      setZones((prev) => {
        const exists = prev.some((z) => z.id === msg.zone.id);
        if (exists) return prev;
        return [msg.zone as ApiZone, ...prev];
      });
    };
    const onZoneUpdated = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.zone?.id) return;
      setZones((prev) => prev.map((z) => (z.id === msg.zone.id ? (msg.zone as ApiZone) : z)));
    };
    const onZoneDeleted = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.zoneId) return;
      setZones((prev) => prev.filter((z) => z.id !== msg.zoneId));
    };

    socket.on('poi:created', onPoiCreated);
    socket.on('poi:updated', onPoiUpdated);
    socket.on('poi:deleted', onPoiDeleted);
    socket.on('zone:created', onZoneCreated);
    socket.on('zone:updated', onZoneUpdated);
    socket.on('zone:deleted', onZoneDeleted);

    return () => {
      socket.off('position:update', onPos);
      socket.off('poi:created', onPoiCreated);
      socket.off('poi:updated', onPoiUpdated);
      socket.off('poi:deleted', onPoiDeleted);
      socket.off('zone:created', onZoneCreated);
      socket.off('zone:updated', onZoneUpdated);
      socket.off('zone:deleted', onZoneDeleted);
      socket.emit('mission:leave');
    };
  }, [selectedMissionId, user?.id]);

  useEffect(() => {
    if (!selectedMissionId) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, z] = await Promise.all([listPois(selectedMissionId), listZones(selectedMissionId)]);
        if (cancelled) return;
        setPois(p);
        setZones(z);
      } catch (e) {
        // non-blocking for map
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMissionId]);

  useEffect(() => {
    if (!selectedMissionId) return;
    if (!navigator.geolocation) return;

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        const t = Date.now();

        setLastPos({ lng, lat });
        setTracePoints((prev) => {
          const next = [...prev, { lng, lat, t }];
          return next.slice(-200);
        });

        const socket = socketRef.current;
        if (socket && selectedMissionId) {
          socket.emit('position:update', {
            lng,
            lat,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            accuracy: pos.coords.accuracy ?? undefined,
            t,
          });
        }
      },
      () => {},
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000,
      }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [selectedMissionId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('pois') as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: pois.map((p) => ({
        type: 'Feature',
        properties: { id: p.id, type: p.type, title: p.title, icon: p.icon, color: p.color, comment: p.comment },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })) as any,
    });
  }, [pois, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const markers = poiMarkersRef.current;
    const nextIds = new Set(pois.map((p) => p.id));

    // remove stale markers
    for (const [id, marker] of markers.entries()) {
      if (!nextIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    for (const p of pois) {
      const Icon = getPoiIconComponent(p.icon);
      const svg = renderToStaticMarkup(<Icon size={16} color="#ffffff" strokeWidth={2.5} />);

      const el = document.createElement('div');
      el.style.width = '28px';
      el.style.height = '28px';
      el.style.borderRadius = '9999px';
      el.style.background = p.color || '#f97316';
      el.style.border = '2px solid #ffffff';
      el.style.boxShadow = '0 1px 2px rgba(0,0,0,0.25)';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.cursor = 'pointer';
      el.innerHTML = svg;
      el.title = p.title;

      const existing = markers.get(p.id);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
        const oldEl = existing.getElement();
        oldEl.replaceWith(el);
        (existing as any)._element = el;
      } else {
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map);
        markers.set(p.id, marker);
      }
    }
  }, [pois, mapReady, poiIconOptions]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('zones') as GeoJSONSource | undefined;
    if (!src) return;

    const features: any[] = [];
    for (const z of zones) {
      if (z.type === 'circle' && z.circle) {
        features.push({
          type: 'Feature',
          properties: { id: z.id, title: z.title, color: z.color },
          geometry: circleToPolygon(z.circle.center, z.circle.radiusMeters),
        });
      }
      if (z.type === 'polygon' && z.polygon) {
        features.push({ type: 'Feature', properties: { id: z.id, title: z.title, color: z.color }, geometry: z.polygon });
      }
      if (Array.isArray(z.sectors)) {
        for (const s of z.sectors) {
          features.push({
            type: 'Feature',
            properties: { id: z.id, title: z.title, sectorId: s.sectorId, color: s.color },
            geometry: s.geometry,
          });
        }
      }
    }

    src.setData({ type: 'FeatureCollection', features });
  }, [zones, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('others') as GeoJSONSource | undefined;
    if (!src) return;

    const features = Object.entries(otherPositions).map(([userId, p]) => ({
      type: 'Feature',
      properties: { userId, t: p.t },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    }));

    src.setData({
      type: 'FeatureCollection',
      features: features as any,
    });
  }, [otherPositions, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const update = () => {
      const meSource = map.getSource('me') as GeoJSONSource | undefined;
      const traceSource = map.getSource('trace') as GeoJSONSource | undefined;
      if (!meSource || !traceSource) return;

      if (lastPos) {
        meSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [lastPos.lng, lastPos.lat] },
              properties: {},
            },
          ],
        });
      }

      const retentionMs = 60 * 60 * 1000;
      const now = Date.now();
      const filtered = tracePoints.filter((p) => now - p.t <= retentionMs);
      if (filtered.length !== tracePoints.length) setTracePoints(filtered);

      if (filtered.length >= 2) {
        traceSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: filtered.map((p) => [p.lng, p.lat]),
              },
              properties: {},
            },
          ],
        });
      } else {
        traceSource.setData({ type: 'FeatureCollection', features: [] });
      }
    };

    update();
  }, [lastPos, tracePoints]);

  return (
    <div className="relative w-full h-screen">
      <div ref={mapRef} className="w-full h-full" />

      <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-3">
        <button
          type="button"
          onClick={centerOnMe}
          className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Centrer sur moi"
        >
          <Crosshair className="mx-auto" size={22} />
        </button>

        <button
          type="button"
          onClick={toggleMapStyle}
          className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Changer le fond de carte"
        >
          <Layers className="mx-auto" size={22} />
        </button>

        <button
          type="button"
          onClick={() => {
            if (activeTool === 'poi') {
              cancelDraft();
              return;
            }
            cancelDraft();
            setZoneMenuOpen(false);
            setActiveTool('poi');
          }}
          className={`h-14 w-14 rounded-2xl border shadow backdrop-blur ${
            activeTool === 'poi' ? 'bg-blue-600 text-white' : 'bg-white/90 hover:bg-white'
          }`}
          title="Ajouter un POI"
        >
          <MapPin className="mx-auto" size={22} />
        </button>

        <button
          type="button"
          onClick={() => {
            setZoneMenuOpen((v) => !v);
          }}
          className={`h-14 w-14 rounded-2xl border shadow backdrop-blur ${
            activeTool === 'zone_circle' || activeTool === 'zone_polygon'
              ? 'bg-blue-600 text-white'
              : 'bg-white/90 hover:bg-white'
          }`}
          title="Zones"
        >
          <Circle className="mx-auto" size={22} />
        </button>

        {zoneMenuOpen ? (
          <div className="flex flex-col gap-2 rounded-2xl border bg-white/90 p-2 shadow backdrop-blur">
            <button
              type="button"
              onClick={() => {
                if (activeTool === 'zone_circle') {
                  cancelDraft();
                  setZoneMenuOpen(false);
                  return;
                }
                cancelDraft();
                setDraftColor('#22c55e');
                setActiveTool('zone_circle');
              }}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border ${
                activeTool === 'zone_circle' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50'
              }`}
              title="Zone cercle"
            >
              <Circle size={20} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeTool === 'zone_polygon') {
                  cancelDraft();
                  setZoneMenuOpen(false);
                  return;
                }
                cancelDraft();
                setDraftColor('#22c55e');
                setActiveTool('zone_polygon');
              }}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl border ${
                activeTool === 'zone_polygon' ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-50'
              }`}
              title="Zone à la main"
            >
              <Pencil size={20} />
            </button>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 pt-1">
          <button
            type="button"
            onClick={zoomIn}
            className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
            title="Zoom +"
          >
            <Plus className="mx-auto" size={22} />
          </button>
          <button
            type="button"
            onClick={zoomOut}
            className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
            title="Zoom -"
          >
            <Minus className="mx-auto" size={22} />
          </button>
          <button
            type="button"
            onClick={resetNorth}
            className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
            title="Boussole"
          >
            <Compass className="mx-auto" size={22} />
          </button>
        </div>
      </div>

      {activeTool !== 'none' && !showValidation ? (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 z-[1000] rounded-2xl border bg-white/90 px-4 py-2 text-sm shadow backdrop-blur">
          {activeTool === 'poi'
            ? 'Mode POI: clique sur la carte'
            : activeTool === 'zone_circle'
              ? 'Zone ronde: clique sur le centre'
              : 'Zone libre: clique pour poser des points'}
        </div>
      ) : null}

      {activeTool === 'zone_polygon' && !showValidation ? (
        <div className="absolute left-1/2 bottom-24 -translate-x-1/2 z-[1100] flex gap-2">
          <button
            type="button"
            onClick={undoPolygonPoint}
            className="h-11 rounded-2xl border bg-white/90 px-4 text-sm font-semibold text-gray-800 shadow backdrop-blur hover:bg-white"
          >
            Précédent
          </button>
          <button
            type="button"
            onClick={validatePolygon}
            className="h-11 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white shadow disabled:opacity-50"
          >
            Valider
          </button>
        </div>
      ) : null}

      {showValidation ? (
        <div className="absolute inset-0 z-[1200] flex items-end justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-base font-bold text-gray-900">Validation</div>
              <button type="button" onClick={cancelDraft} className="h-10 w-10 rounded-2xl border bg-white">
                <X className="mx-auto" size={18} />
              </button>
            </div>

            <div className="mt-3 grid gap-2">
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder={activeTool === 'poi' ? 'Titre du POI' : 'Titre de la zone'}
                className="h-11 w-full rounded-2xl border px-3 text-sm"
              />

              {activeTool === 'poi' ? (
                <>
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs font-semibold text-gray-700">Couleur</div>
                    <div className="mt-2 grid grid-cols-8 gap-2">
                      {poiColorOptions.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setDraftColor(c)}
                          className={`h-8 w-8 rounded-xl border ${draftColor === c ? 'ring-2 ring-blue-500' : ''}`}
                          style={{ backgroundColor: c }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                    <div className="mt-2 text-xs font-mono text-gray-600">{draftColor}</div>
                  </div>

                  <div className="rounded-2xl border p-3">
                    <div className="text-xs font-semibold text-gray-700">Icône</div>
                    <div className="mt-2 grid grid-cols-6 gap-2">
                      {poiIconOptions.map(({ id, Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setDraftIcon(id)}
                          className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-white ${
                            draftIcon === id ? 'ring-2 ring-blue-500' : 'hover:bg-gray-50'
                          }`}
                          aria-label={id}
                        >
                          <Icon size={18} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    value={draftComment}
                    onChange={(e) => setDraftComment(e.target.value)}
                    placeholder="Commentaire"
                    className="h-11 w-full rounded-2xl border px-3 text-sm"
                  />
                </>
              ) : null}

              {activeTool === 'zone_circle' ? (
                <div className="rounded-2xl border p-3">
                  <div className="text-xs font-semibold text-gray-700">Rayon: {draftCircleRadius} m</div>
                  <input
                    type="range"
                    min={50}
                    max={1500}
                    step={25}
                    value={draftCircleRadius}
                    onChange={(e) => setDraftCircleRadius(Number(e.target.value))}
                    className="mt-2 w-full"
                  />
                </div>
              ) : null}

              {activeTool !== 'poi' ? (
                <div className="rounded-2xl border p-3">
                  <div className="text-xs font-semibold text-gray-700">Couleur</div>
                  <div className="mt-2 grid grid-cols-8 gap-2">
                    {poiColorOptions.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDraftColor(c)}
                        className={`h-8 w-8 rounded-xl border ${draftColor === c ? 'ring-2 ring-blue-500' : ''}`}
                        style={{ backgroundColor: c }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                  <div className="mt-2 text-xs font-mono text-gray-600">{draftColor}</div>
                </div>
              ) : null}

              {actionError ? <div className="text-sm text-red-600">{actionError}</div> : null}

              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void confirmCreate()}
                className="h-11 w-full rounded-2xl bg-blue-600 text-sm font-semibold text-white shadow disabled:opacity-50"
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

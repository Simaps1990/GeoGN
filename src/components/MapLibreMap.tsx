import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMapInstance, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  AlertTriangle,
  Binoculars,
  Bomb,
  Bike,
  Car,
  Check,
  Cctv,
  Church,
  CircleDot,
  CircleDotDashed,
  Coffee,
  Compass,
  Crosshair,
  Flame,
  Flag,
  HelpCircle,
  House,
  Layers,
  MapPin,
  Mic,
  Navigation,
  NavigationOff,
  MessageCircle,
  Users,
  Dog,
  PawPrint,
  Plane,
  Radiation,
  Shield,
  Skull,
  Spline,
  Tag,
  Tent,
  Truck,
  Undo2,
  Warehouse,
  X,
} from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAuth } from '../contexts/AuthContext';
import { useMission } from '../contexts/MissionContext';
import { getSocket } from '../lib/socket';
import {
  createPoi,
  createZone,
  getMission,
  listPois,
  listMissionMembers,
  listZones,
  type ApiMission,
  type ApiPoi,
  type ApiZone,
} from '../lib/api';

function getRasterStyle(tiles: string[], attribution: string) {
  const style: StyleSpecification = {
    version: 8,
    // Required for text labels (symbol layers with text-field)
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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

function isPointInZone(lng: number, lat: number, z: ApiZone) {
  if (z.type === 'circle' && z.circle) {
    const { center, radiusMeters } = z.circle;
    const metersPerDegLat = 111_320;
    const metersPerDegLng = 111_320 * Math.cos((center.lat * Math.PI) / 180);
    const dx = (lng - center.lng) * metersPerDegLng;
    const dy = (lat - center.lat) * metersPerDegLat;
    const distSq = dx * dx + dy * dy;
    return distSq <= radiusMeters * radiusMeters;
  }

  if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
    const ring = z.polygon.coordinates[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];

      const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  return false;
}

function getZoneBbox(z: ApiZone) {
  if (z.type === 'circle' && z.circle) {
    const { lng, lat } = z.circle.center;
    const metersPerDegLat = 111_320;
    const metersPerDegLng = 111_320 * Math.cos((lat * Math.PI) / 180);
    const dLat = z.circle.radiusMeters / metersPerDegLat;
    const dLng = z.circle.radiusMeters / metersPerDegLng;
    return { minLng: lng - dLng, minLat: lat - dLat, maxLng: lng + dLng, maxLat: lat + dLat };
  }

  if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
    const ring = z.polygon.coordinates[0];
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const p of ring) {
      minLng = Math.min(minLng, p[0]);
      minLat = Math.min(minLat, p[1]);
      maxLng = Math.max(maxLng, p[0]);
      maxLat = Math.max(maxLat, p[1]);
    }
    return { minLng, minLat, maxLng, maxLat };
  }

  return null;
}

function closeRing(ring: number[][]) {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function clipVerticalLineToPolygon(lng: number, ringInput: number[][]) {
  const ring = closeRing(ringInput);
  const ys: number[] = [];
  const eps = 1e-12;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const dx = x2 - x1;
    if (Math.abs(dx) < eps) {
      if (Math.abs(lng - x1) < eps) {
        ys.push(y1, y2);
      }
      continue;
    }
    const t = (lng - x1) / dx;
    if (t < -eps || t > 1 + eps) continue;
    const y = y1 + t * (y2 - y1);
    ys.push(y);
  }

  ys.sort((a, b) => a - b);
  const segments: [number, number][] = [];
  for (let i = 0; i + 1 < ys.length; i += 2) {
    const a = ys[i];
    const b = ys[i + 1];
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > eps) segments.push([a, b]);
  }
  return segments;
}

function getZoneLabelPoint(z: ApiZone) {
  const bbox = getZoneBbox(z);
  if (!bbox) return null;
  const cx = (bbox.minLng + bbox.maxLng) / 2;
  const height = bbox.maxLat - bbox.minLat;
  const y = bbox.minLat - height * 0.04;
  return { lng: cx, lat: y };
}

function clipHorizontalLineToPolygon(lat: number, ringInput: number[][]) {
  const ring = closeRing(ringInput);
  const xs: number[] = [];
  const eps = 1e-12;

  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const dy = y2 - y1;
    if (Math.abs(dy) < eps) {
      if (Math.abs(lat - y1) < eps) {
        xs.push(x1, x2);
      }
      continue;
    }
    const t = (lat - y1) / dy;
    if (t < -eps || t > 1 + eps) continue;
    const x = x1 + t * (x2 - x1);
    xs.push(x);
  }

  xs.sort((a, b) => a - b);
  const segments: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const a = xs[i];
    const b = xs[i + 1];
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > eps) segments.push([a, b]);
  }
  return segments;
}

export default function MapLibreMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapLibreMapInstance | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  const poiMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const polygonDraftRef = useRef<[number, number][]>([]);

  const otherColorsRef = useRef<Record<string, string>>({});
  const otherTracesRef = useRef<Record<string, { lng: number; lat: number; t: number }[]>>({});

  const [memberColors, setMemberColors] = useState<Record<string, string>>({});

  const [lastPos, setLastPos] = useState<{ lng: number; lat: number } | null>(null);
  const [tracePoints, setTracePoints] = useState<{ lng: number; lat: number; t: number }[]>([]);
  const [otherPositions, setOtherPositions] = useState<Record<string, { lng: number; lat: number; t: number }>>({});
  const [pois, setPois] = useState<ApiPoi[]>([]);
  const [selectedPoi, setSelectedPoi] = useState<ApiPoi | null>(null);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [mapReady, setMapReady] = useState(false);

  const [baseStyleIndex, setBaseStyleIndex] = useState(0);

  const [trackingEnabled, setTrackingEnabled] = useState(true);

  const [zoneMenuOpen, setZoneMenuOpen] = useState(false);

  const [activeTool, setActiveTool] = useState<'none' | 'poi' | 'zone_circle' | 'zone_polygon'>('none');
  const [draftLngLat, setDraftLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [draftCircleRadius, setDraftCircleRadius] = useState(250);

  const [showValidation, setShowValidation] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftComment, setDraftComment] = useState('');
  const [draftColor, setDraftColor] = useState('#f97316');
  const [draftIcon, setDraftIcon] = useState('target');

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [labelsEnabled, setLabelsEnabled] = useState(false);

  const poiColorOptions = useMemo(
    () => ['#3b82f6', '#22c55e', '#f97316', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#ec4899', '#000000', '#ffffff'],
    []
  );

  const poiIconOptions = useMemo(
    () => [
      { id: 'target', Icon: Crosshair, label: 'Target' },
      { id: 'flag', Icon: Flag, label: 'Flag' },
      { id: 'alert', Icon: AlertTriangle, label: 'Alert' },
      { id: 'help', Icon: HelpCircle, label: 'Help' },
      { id: 'skull', Icon: Skull, label: 'Skull' },
      { id: 'binoculars', Icon: Binoculars, label: 'Binoculars' },
      { id: 'bomb', Icon: Bomb, label: 'Bomb' },
      { id: 'car', Icon: Car, label: 'Car' },
      { id: 'cctv', Icon: Cctv, label: 'CCTV' },
      { id: 'church', Icon: Church, label: 'Church' },
      { id: 'coffee', Icon: Coffee, label: 'Coffee' },
      { id: 'flame', Icon: Flame, label: 'Flame' },
      { id: 'helicopter', Icon: Plane, label: 'Helicopter' },
      { id: 'mic', Icon: Mic, label: 'Mic' },
      { id: 'paw', Icon: PawPrint, label: 'Paw' },
      { id: 'radiation', Icon: Radiation, label: 'Radiation' },
      { id: 'warehouse', Icon: Warehouse, label: 'Warehouse' },
      { id: 'truck', Icon: Truck, label: 'Truck' },
      { id: 'motorcycle', Icon: Bike, label: 'Motorbike' },
      { id: 'shield', Icon: Shield, label: 'Shield' },
      { id: 'tent', Icon: Tent, label: 'Tent' },
      { id: 'house', Icon: House, label: 'House' },
      { id: 'speech', Icon: MessageCircle, label: 'Speech' },
      { id: 'users', Icon: Users, label: 'Users' },
      { id: 'dog', Icon: Dog, label: 'Dog' },
    ],
    []
  );

  function getPoiIconComponent(iconId: string) {
    return poiIconOptions.find((x) => x.id === iconId)?.Icon ?? MapPin;
  }
  const { user } = useAuth();
  const { selectedMissionId } = useMission();

  const mapViewKey = selectedMissionId ? `geotacops.mapView.${selectedMissionId}` : null;

  const tracesLoadedRef = useRef(false);
  const autoCenterMissionIdRef = useRef<string | null>(null);
  const autoCenterDoneRef = useRef(false);

  const [mission, setMission] = useState<ApiMission | null>(null);

  const traceRetentionMs = useMemo(() => {
    const s = mission?.traceRetentionSeconds;
    const seconds = typeof s === 'number' && Number.isFinite(s) ? s : 3600;
    return Math.max(0, seconds) * 1000;
  }, [mission?.traceRetentionSeconds]);

  const maxTracePoints = useMemo(() => {
    // Cible: pouvoir garder une heure à ~1 point/sec (3600) sans tronquer.
    const approxPoints = Math.ceil(traceRetentionMs / 1000);
    return Math.max(2000, approxPoints + 200);
  }, [traceRetentionMs]);

  // Par défaut, tant que la mission n'est pas chargée, on considère que l'utilisateur ne peut pas éditer
  // afin d'éviter un flash de boutons d'édition pour les comptes visualisateurs.
  const canEdit = !!mission && mission.membership?.role !== 'viewer';

  useEffect(() => {
    if (!selectedMissionId) {
      setMission(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const m = await getMission(selectedMissionId);
        if (!cancelled) setMission(m);
      } catch {
        if (!cancelled) setMission(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMissionId]);

  useEffect(() => {
    const onMissionUpdated = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const updated = ce?.detail?.mission;
      if (!updated?.id) return;
      if (!selectedMissionId) return;
      if (updated.id !== selectedMissionId) return;
      setMission((prev) => ({ ...(prev ?? updated), ...updated }));
    };
    window.addEventListener('geotacops:mission:updated', onMissionUpdated as any);
    return () => {
      window.removeEventListener('geotacops:mission:updated', onMissionUpdated as any);
    };
  }, [selectedMissionId]);

  // Au chargement de la carte pour une mission, centrer automatiquement sur ma position (une seule fois).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!selectedMissionId) return;

    if (autoCenterMissionIdRef.current !== selectedMissionId) {
      autoCenterMissionIdRef.current = selectedMissionId;
      autoCenterDoneRef.current = false;
    }

    if (autoCenterDoneRef.current) return;

    const doCenter = (lng: number, lat: number) => {
      try {
        autoCenterDoneRef.current = true;
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 16), duration: 800 });
      } catch {
        // ignore
      }
    };

    // Si on a déjà une position en mémoire (tracking), l'utiliser en priorité.
    if (lastPos) {
      doCenter(lastPos.lng, lastPos.lat);
      return;
    }

    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        doCenter(pos.coords.longitude, pos.coords.latitude);
      },
      () => {}
    );
  }, [mapReady, selectedMissionId, lastPos]);

  useEffect(() => {
    if (!selectedMissionId) {
      setMemberColors({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const members = await listMissionMembers(selectedMissionId);
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const m of members) {
          const id = m.user?.id;
          if (!id) continue;
          const c = typeof m.color === 'string' ? m.color.trim() : '';
          if (c) next[id] = c;
        }
        setMemberColors(next);
      } catch {
        // non bloquant
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMissionId]);

  useEffect(() => {
    if (!selectedMissionId) return;
    const socket = getSocket();

    const onMemberUpdated = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      const userId = msg?.member?.userId;
      if (!userId) return;
      const color = msg?.member?.color;
      if (typeof color === 'string' && color.trim()) {
        setMemberColors((prev) => ({ ...prev, [userId]: color.trim() }));
      }
    };

    socket.on('member:updated', onMemberUpdated);
    return () => {
      socket.off('member:updated', onMemberUpdated);
    };
  }, [selectedMissionId]);

  // Garder otherColorsRef synchronisé avec les couleurs de membres de mission
  // afin d'utiliser uniquement la couleur attribuée dans les contacts de la mission.
  useEffect(() => {
    for (const [userId, color] of Object.entries(memberColors)) {
      if (color) {
        otherColorsRef.current[userId] = color;
      }
    }
  }, [memberColors]);

  // Load previously saved traces for this mission (self + others) once per mission.
  useEffect(() => {
    if (!selectedMissionId) {
      tracesLoadedRef.current = false;
      return;
    }

    if (tracesLoadedRef.current) return;

    const selfKey = user?.id ? `geogn.trace.self.${selectedMissionId}.${user.id}` : null;
    const othersKey = `geogn.trace.others.${selectedMissionId}`;

    try {
      if (selfKey) {
        const rawSelf = localStorage.getItem(selfKey);
        if (rawSelf) {
          const parsed = JSON.parse(rawSelf) as { lng: number; lat: number; t: number }[];
          if (Array.isArray(parsed)) {
            setTracePoints(parsed);
            if (parsed.length) {
              const last = parsed[parsed.length - 1];
              setLastPos({ lng: last.lng, lat: last.lat });
            }
          }
        }
      }

      const rawOthers = localStorage.getItem(othersKey);
      if (rawOthers) {
        const parsed = JSON.parse(rawOthers) as Record<string, { lng: number; lat: number; t: number }[]>;
        if (parsed && typeof parsed === 'object') {
          otherTracesRef.current = parsed;
          const nextPositions: Record<string, { lng: number; lat: number; t: number }> = {};
          for (const [userId, pts] of Object.entries(parsed)) {
            if (!Array.isArray(pts) || pts.length === 0) continue;
            const last = pts[pts.length - 1];
            nextPositions[userId] = { lng: last.lng, lat: last.lat, t: last.t };
          }
          if (Object.keys(nextPositions).length) {
            setOtherPositions(nextPositions);
          }
        }
      }
    } catch {
      // ignore malformed data
    }

    tracesLoadedRef.current = true;
  }, [selectedMissionId, user?.id]);

  useEffect(() => {
    if (!selectedMissionId) return;
    const now = Date.now();
    const cutoff = now - traceRetentionMs;

    setTracePoints((prev) => prev.filter((p) => p.t >= cutoff));

    const nextOthers: Record<string, { lng: number; lat: number; t: number }[]> = {};
    for (const [userId, pts] of Object.entries(otherTracesRef.current)) {
      const filtered = pts.filter((p) => p.t >= cutoff);
      if (filtered.length) nextOthers[userId] = filtered;
    }
    otherTracesRef.current = nextOthers;

    setOtherPositions((prev) => {
      const next: Record<string, { lng: number; lat: number; t: number }> = {};
      for (const [userId, p] of Object.entries(prev)) {
        if (Number.isFinite(p.t) && p.t >= cutoff) {
          next[userId] = p;
        }
      }
      return next;
    });

  }, [traceRetentionMs, selectedMissionId]);

  // Purge périodique: garantit que le chenillard disparaît exactement au-delà
  // de la durée configurée, même si aucun nouvel événement n'arrive.
  useEffect(() => {
    if (!selectedMissionId) return;
    if (traceRetentionMs <= 0) {
      setTracePoints([]);
      otherTracesRef.current = {};
      setOtherPositions({});
      return;
    }

    const interval = window.setInterval(() => {
      const now = Date.now();
      const cutoff = now - traceRetentionMs;

      setTracePoints((prev) => prev.filter((p) => p.t >= cutoff));

      const nextOthers: Record<string, { lng: number; lat: number; t: number }[]> = {};
      for (const [userId, pts] of Object.entries(otherTracesRef.current)) {
        const filtered = pts.filter((p) => p.t >= cutoff);
        if (filtered.length) nextOthers[userId] = filtered;
      }
      otherTracesRef.current = nextOthers;

      setOtherPositions((prev) => {
        const next: Record<string, { lng: number; lat: number; t: number }> = {};
        for (const [userId, p] of Object.entries(prev)) {
          if (Number.isFinite(p.t) && p.t >= cutoff) next[userId] = p;
        }
        return next;
      });
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedMissionId, traceRetentionMs]);

  // Keep the current user's dot and personal trace in sync with their mission color.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!user?.id) return;

    const myColor = memberColors[user.id];
    // Si aucune couleur n'est définie pour moi dans la mission, laisser
    // la couleur par défaut définie dans le style (pas de couleur inventée).
    if (!myColor) return;

    if (map.getLayer('me-dot')) {
      map.setPaintProperty('me-dot', 'circle-color', myColor);
      const stroke = myColor.toLowerCase() === '#ffffff' ? '#d1d5db' : '#ffffff';
      map.setPaintProperty('me-dot', 'circle-stroke-color', stroke);
    }

    if (map.getLayer('trace-line')) {
      map.setPaintProperty('trace-line', 'line-color', myColor);
    }
  }, [mapReady, selectedMissionId, user?.id, memberColors]);

  // Persist self trace for this mission while the app is open.
  useEffect(() => {
    if (!selectedMissionId || !user?.id) return;
    const key = `geogn.trace.self.${selectedMissionId}.${user.id}`;
    try {
      localStorage.setItem(key, JSON.stringify(tracePoints));
    } catch {
      // storage might be full; ignore
    }
  }, [tracePoints, selectedMissionId, user?.id]);

  // Persist others traces for this mission based on the ref, whenever positions update.
  useEffect(() => {
    if (!selectedMissionId) return;
    const key = `geogn.trace.others.${selectedMissionId}`;
    try {
      localStorage.setItem(key, JSON.stringify(otherTracesRef.current));
    } catch {
      // ignore storage errors
    }
  }, [otherPositions, selectedMissionId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const raw = sessionStorage.getItem('geogn.centerPoi');
    if (!raw) return;
    try {
      const v = JSON.parse(raw) as any;
      if (typeof v.lng !== 'number' || typeof v.lat !== 'number') return;
      const zoom = typeof v.zoom === 'number' ? v.zoom : Math.max(map.getZoom(), 16);
      map.easeTo({ center: [v.lng, v.lat], zoom, duration: 600 });
      // Tell the mapView restore effect to skip once so this centering isn't overridden.
      sessionStorage.setItem('geogn.skipMapViewOnce', '1');
      sessionStorage.removeItem('geogn.centerPoi');
    } catch {
      // ignore
    }
  }, [mapReady, selectedMissionId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const raw = sessionStorage.getItem('geogn.centerZone');
    if (!raw) return;
    try {
      const v = JSON.parse(raw) as any;
      if (typeof v.lng !== 'number' || typeof v.lat !== 'number') return;
      const zoom = typeof v.zoom === 'number' ? v.zoom : Math.max(map.getZoom(), 14);
      map.easeTo({ center: [v.lng, v.lat], zoom, duration: 600 });
      // Same as for POIs: skip one mapView restore so this centering keeps priority.
      sessionStorage.setItem('geogn.skipMapViewOnce', '1');
      sessionStorage.removeItem('geogn.centerZone');
    } catch {
      // ignore
    }
  }, [mapReady, selectedMissionId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!mapViewKey) return;

    // If we have a pending explicit centering instruction (from POI/Zones pages),
    // or we've just processed one, skip restoring the last saved view.
    const hasCenterPoi = sessionStorage.getItem('geogn.centerPoi');
    const hasCenterZone = sessionStorage.getItem('geogn.centerZone');
    const skipOnce = sessionStorage.getItem('geogn.skipMapViewOnce');
    if (hasCenterPoi || hasCenterZone || skipOnce) {
      if (skipOnce) sessionStorage.removeItem('geogn.skipMapViewOnce');
      return;
    }

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

  // Toggle visibility of labels (POIs + other users) based on labelsEnabled.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const othersLabels = map.getLayer('others-labels');
    const poisLabels = map.getLayer('pois-labels');
    const zonesLabels = map.getLayer('zones-labels');
    const visibility = labelsEnabled ? 'visible' : 'none';

    if (othersLabels) {
      map.setLayoutProperty('others-labels', 'visibility', visibility);
    }
    if (poisLabels) {
      map.setLayoutProperty('pois-labels', 'visibility', visibility);
    }
    if (zonesLabels) {
      map.setLayoutProperty('zones-labels', 'visibility', visibility);
    }
  }, [labelsEnabled, mapReady]);

  // S'assurer que les labels (users + POI + zones) sont au-dessus des tracés et des zones.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const labelLayers = ['others-labels', 'pois-labels', 'zones-labels'];
    for (const id of labelLayers) {
      if (map.getLayer(id)) {
        map.moveLayer(id);
      }
    }
  }, [mapReady]);

  function centerOnMe() {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (selectedMissionId) {
      (async () => {
        try {
          const [p, z] = await Promise.all([listPois(selectedMissionId), listZones(selectedMissionId)]);
          setPois(p);
          setZones(z);
        } catch {
          // ignore refresh errors
        }
      })();
    }
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
          ' OpenStreetMap contributors'
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
          ' OpenStreetMap contributors CARTO'
        ),
      },
      {
        id: 'sat',
        style: getRasterStyle(
          ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          'Tiles Esri'
        ),
      },
    ],
    []
  );

  const currentBaseStyle = baseStyles[baseStyleIndex]?.style;

  function applyGridLabelStyle(map: MapLibreMapInstance) {
    if (!map.getLayer('zones-grid-labels')) return;

    const styleId = baseStyles[baseStyleIndex]?.id;

    if (styleId === 'sat') {
      // Fond satellite: texte blanc 70%, sans contour.
      map.setPaintProperty('zones-grid-labels', 'text-color', '#ffffff');
      map.setPaintProperty('zones-grid-labels', 'text-halo-color', 'rgba(0,0,0,0)');
      map.setPaintProperty('zones-grid-labels', 'text-halo-width', 0);
      // Toujours visibles, mais un peu atténués pour éviter de dominer le fond satellite.
      map.setPaintProperty('zones-grid-labels', 'text-opacity', 0.7);
      return;
    }

    // Fonds plan / clair: texte gris foncé plein, sans halo.
    map.setPaintProperty('zones-grid-labels', 'text-color', '#111827');
    map.setPaintProperty('zones-grid-labels', 'text-halo-color', 'rgba(0,0,0,0)');
    map.setPaintProperty('zones-grid-labels', 'text-halo-width', 0);
    map.setPaintProperty('zones-grid-labels', 'text-opacity', 0.55);
  }

  function toggleMapStyle() {
    setBaseStyleIndex((i) => (i + 1) % baseStyles.length);

    // Recharger explicitement les POI et zones à chaque changement de fond de carte
    // pour s'assurer que tout est bien synchronisé après un setStyle.
    if (selectedMissionId) {
      (async () => {
        try {
          const [p, z] = await Promise.all([listPois(selectedMissionId), listZones(selectedMissionId)]);
          setPois(p);
          setZones(z);
        } catch {
          // non bloquant: si ça échoue, la carte reste utilisable avec les données existantes
        }
      })();
    }
  }

  function resetNorth() {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.easeTo({ bearing: 0, pitch: 0 });
  }

  function enforceLayerOrder(map: MapLibreMapInstance) {
    const safeMoveToTop = (id: string) => {
      if (!map.getLayer(id)) return;
      try {
        map.moveLayer(id);
      } catch {
      }
    };

    safeMoveToTop('zones-fill');
    safeMoveToTop('zones-outline');
    safeMoveToTop('zones-grid-lines');
    safeMoveToTop('zones-grid-labels');
    safeMoveToTop('pois');
    safeMoveToTop('pois-labels');

    safeMoveToTop('trace-line');
    safeMoveToTop('others-traces-line');
    safeMoveToTop('others-points');
    safeMoveToTop('others-labels');
    safeMoveToTop('me-dot');
    safeMoveToTop('zones-labels');
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
          // color is updated dynamically in an effect using the mission member color
          'circle-color': '#3B82F6',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    if (!map.getSource('zones-grid')) {
      map.addSource('zones-grid', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('zones-grid-lines')) {
      map.addLayer({
        id: 'zones-grid-lines',
        type: 'line',
        source: 'zones-grid',
        filter: ['==', ['get', 'kind'], 'line'],
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#ffffff'],
          'line-opacity': 0.9,
          'line-width': 1.5,
        },
      });
    }
    if (!map.getLayer('zones-grid-labels')) {
      map.addLayer({
        id: 'zones-grid-labels',
        type: 'symbol',
        source: 'zones-grid',
        filter: ['==', ['get', 'kind'], 'cell'],
        layout: {
          'text-field': ['coalesce', ['get', 'text'], ''],
          // Adapter la taille en fonction du zoom ET de la densité (rows*cols).
          // On utilise un interpolate sur le zoom au niveau racine, comme l'exige MapLibre.
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            // Zoom carte faible
            10,
            [
              'step',
              ['*', ['get', 'rows'], ['get', 'cols']],
              10, // grilles <= 8x8
              65,
              9, // 9x9 à ~12x12
              145,
              8, // au-delà
            ],
            // Zoom carte élevé
            16,
            [
              'step',
              ['*', ['get', 'rows'], ['get', 'cols']],
              16, // grilles <= 8x8
              65,
              14, // 9x9 à ~12x12
              145,
              12, // au-delà
            ],
          ],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-anchor': [
            'case',
            ['==', ['get', 'kind'], 'cell'],
            'center',
            ['case', ['==', ['get', 'axis'], 'x'], 'bottom', 'right'],
          ],
          'text-offset': [
            'case',
            ['==', ['get', 'kind'], 'cell'],
            ['literal', [0, 0]],
            ['case', ['==', ['get', 'axis'], 'x'], ['literal', [0, 1.75]], ['literal', [-0.9, 0]]],
          ],
          'text-optional': true,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          // Valeurs par défaut neutres; elles seront surchargées par applyGridLabelStyle
          'text-color': '#111827',
          'text-halo-color': 'rgba(0,0,0,0)',
          'text-halo-width': 0,
          'text-opacity': 0.9,
        },
      });
    }

    if (!map.getSource('trace')) {
      map.addSource('trace', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('trace-line')) {
      // Insert the trace layer *under* the me-dot layer so the position icon stays above the line.
      map.addLayer(
        {
          id: 'trace-line',
          type: 'line',
          source: 'trace',
          paint: {
            'line-color': '#00ff00',
            'line-width': 8,
            'line-opacity': ['coalesce', ['get', 'opacity'], 0.5],
          },
        },
        'me-dot'
      );
    }

    if (!map.getSource('others')) {
      map.addSource('others', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('others-traces')) {
      map.addSource('others-traces', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('others-traces-line')) {
      map.addLayer({
        id: 'others-traces-line',
        type: 'line',
        source: 'others-traces',
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#2563eb'],
          'line-width': 8,
          'line-opacity': ['coalesce', ['get', 'opacity'], 0.9],
        },
      });
    }
    if (!map.getLayer('others-points')) {
      // Add points after traces so circles render above lines.
      map.addLayer({
        id: 'others-points',
        type: 'circle',
        source: 'others',
        paint: {
          'circle-radius': 6,
          'circle-color': ['coalesce', ['get', 'color'], '#2563eb'],
          'circle-stroke-color': [
            'case',
            ['==', ['downcase', ['get', 'color']], '#ffffff'],
            '#d1d5db',
            '#ffffff',
          ],
          'circle-stroke-width': 2,
        },
      });
    }
    if (!map.getLayer('others-labels')) {
      // Labels (pseudos) au-dessus des points des autres utilisateurs.
      map.addLayer({
        id: 'others-labels',
        type: 'symbol',
        source: 'others',
        layout: {
          'text-field': ['coalesce', ['get', 'name'], ''],
          'text-size': 13,
          'text-offset': [0, -1.2],
          'text-anchor': 'bottom',
          'text-optional': true,
        },
        paint: {
          'text-color': '#111827',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
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
    if (!map.getLayer('pois-labels')) {
      // Labels pour les POI, contrôlés en même temps que les labels utilisateurs.
      map.addLayer({
        id: 'pois-labels',
        type: 'symbol',
        source: 'pois',
        layout: {
          'text-field': ['coalesce', ['get', 'title'], ''],
          'text-size': 13,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#111827',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
      });
    }

    if (!map.getSource('zones')) {
      map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('zones-labels')) {
      map.addSource('zones-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer('zones-fill')) {
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: { 'fill-color': ['coalesce', ['get', 'color'], '#22c55e'], 'fill-opacity': 0 },
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

    const existingZonesLabelsLayer = map.getLayer('zones-labels') as any;
    if (existingZonesLabelsLayer && existingZonesLabelsLayer.source !== 'zones-labels') {
      map.removeLayer('zones-labels');
    }
    if (!map.getLayer('zones-labels')) {
      map.addLayer({
        id: 'zones-labels',
        type: 'symbol',
        source: 'zones-labels',
        layout: {
          'text-field': ['coalesce', ['get', 'title'], ''],
          'text-size': 13,
          'text-offset': [0, 0.8],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': '#111827',
          'text-halo-color': '#ffffff',
          'text-halo-width': 2,
        },
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

    enforceLayerOrder(map);
  }

  function resyncAllOverlays(map: MapLibreMapInstance) {
    const meSource = map.getSource('me') as GeoJSONSource | undefined;
    const traceSource = map.getSource('trace') as GeoJSONSource | undefined;
    const othersSource = map.getSource('others') as GeoJSONSource | undefined;
    const othersTracesSource = map.getSource('others-traces') as GeoJSONSource | undefined;
    const zonesSource = map.getSource('zones') as GeoJSONSource | undefined;
    const zonesLabelsSource = map.getSource('zones-labels') as GeoJSONSource | undefined;
    const poisSource = map.getSource('pois') as GeoJSONSource | undefined;
    const draftZoneSource = map.getSource('draft-zone') as GeoJSONSource | undefined;
    const draftPoiSource = map.getSource('draft-poi') as GeoJSONSource | undefined;

    if (meSource && lastPos) {
      meSource.setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lastPos.lng, lastPos.lat] },
            properties: {},
          },
        ],
      } as any);
    }

    if (traceSource) {
      const now = Date.now();
      const filtered = tracePoints.filter((p) => now - p.t <= traceRetentionMs);

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
        } as any);
      } else {
        traceSource.setData({ type: 'FeatureCollection', features: [] } as any);
      }
    }

    if (othersSource) {
      const features = Object.entries(otherPositions).map(([userId, p]) => {
        const memberColor = memberColors[userId];
        const color = memberColor ?? '#4b5563';

        return {
          type: 'Feature',
          properties: {
            userId,
            t: p.t,
            color,
            name: '',
          },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        };
      });

      othersSource.setData({
        type: 'FeatureCollection',
        features: features as any,
      });
    }

    if (othersTracesSource) {
      const features: any[] = [];
      const now = Date.now();
      for (const [userId, pts] of Object.entries(otherTracesRef.current)) {
        const filtered = pts.filter((p) => now - p.t <= traceRetentionMs);
        if (filtered.length < 2) continue;
        const memberColor = memberColors[userId];
        const color = memberColor ?? '#4b5563';
        features.push({
          type: 'Feature',
          properties: { userId, color },
          geometry: { type: 'LineString', coordinates: filtered.map((p) => [p.lng, p.lat]) },
        });
      }

      othersTracesSource.setData({ type: 'FeatureCollection', features } as any);
    }

    if (zonesSource) {
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
      zonesSource.setData({ type: 'FeatureCollection', features } as any);
    }

    if (zonesLabelsSource) {
      const features: any[] = [];
      for (const z of zones) {
        const p = getZoneLabelPoint(z);
        if (!p) continue;
        features.push({
          type: 'Feature',
          properties: { id: z.id, title: z.title, color: z.color },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        });
      }
      zonesLabelsSource.setData({ type: 'FeatureCollection', features } as any);
    }

    const zonesGridSource = map.getSource('zones-grid') as GeoJSONSource | undefined;
    if (zonesGridSource) {
      const features: any[] = [];

      for (const z of zones) {
        if (!z.grid?.rows || !z.grid?.cols) continue;
        const bbox = getZoneBbox(z);
        if (!bbox) continue;

        const rows = Math.max(1, z.grid.rows);
        const cols = Math.max(1, Math.min(26, z.grid.cols));

        const dx = (bbox.maxLng - bbox.minLng) / cols;
        const dy = (bbox.maxLat - bbox.minLat) / rows;

        const metersPerDegLat = 111_320;
        const metersPerDegLng = 111_320 * Math.cos((((z.type === 'circle' && z.circle) ? z.circle.center.lat : (bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180);

        const getBottomBoundaryAtX = (x: number) => {
          if (z.type === 'circle' && z.circle) {
            const dxm = (x - z.circle.center.lng) * metersPerDegLng;
            if (Math.abs(dxm) >= z.circle.radiusMeters) return null;
            const dym = Math.sqrt(z.circle.radiusMeters * z.circle.radiusMeters - dxm * dxm);
            return z.circle.center.lat - dym / metersPerDegLat;
          }
          if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
            const segs = clipVerticalLineToPolygon(x, z.polygon.coordinates[0]);
            if (segs.length === 0) return null;
            return Math.min(...segs.map((s) => Math.min(s[0], s[1])));
          }
          return null;
        };

        const getLeftBoundaryAtY = (y: number) => {
          if (z.type === 'circle' && z.circle) {
            const dym = (y - z.circle.center.lat) * metersPerDegLat;
            if (Math.abs(dym) >= z.circle.radiusMeters) return null;
            const dxm = Math.sqrt(z.circle.radiusMeters * z.circle.radiusMeters - dym * dym);
            return z.circle.center.lng - dxm / metersPerDegLng;
          }
          if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
            const segs = clipHorizontalLineToPolygon(y, z.polygon.coordinates[0]);
            if (segs.length === 0) return null;
            return Math.min(...segs.map((s) => Math.min(s[0], s[1])));
          }
          return null;
        };

        const addVerticalSegments = (x: number) => {
          if (z.type === 'circle' && z.circle) {
            const metersPerDegLat = 111_320;
            const metersPerDegLng = 111_320 * Math.cos((z.circle.center.lat * Math.PI) / 180);
            const dxm = (x - z.circle.center.lng) * metersPerDegLng;
            if (Math.abs(dxm) >= z.circle.radiusMeters) return;
            const dym = Math.sqrt(z.circle.radiusMeters * z.circle.radiusMeters - dxm * dxm);
            const y1 = z.circle.center.lat - dym / metersPerDegLat;
            const y2 = z.circle.center.lat + dym / metersPerDegLat;
            features.push({
              type: 'Feature',
              properties: { kind: 'line', zoneId: z.id, color: z.color, rows, cols },
              geometry: { type: 'LineString', coordinates: [[x, y1], [x, y2]] },
            });
            return;
          }
          if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
            const ring = z.polygon.coordinates[0];
            const segs = clipVerticalLineToPolygon(x, ring);
            for (const [a, b] of segs) {
              features.push({
                type: 'Feature',
                properties: { kind: 'line', zoneId: z.id, color: z.color, rows, cols },
                geometry: { type: 'LineString', coordinates: [[x, a], [x, b]] },
              });
            }
          }
        };

        const addHorizontalSegments = (y: number) => {
          if (z.type === 'circle' && z.circle) {
            const metersPerDegLat = 111_320;
            const metersPerDegLng = 111_320 * Math.cos((z.circle.center.lat * Math.PI) / 180);
            const dym = (y - z.circle.center.lat) * metersPerDegLat;
            if (Math.abs(dym) >= z.circle.radiusMeters) return;
            const dxm = Math.sqrt(z.circle.radiusMeters * z.circle.radiusMeters - dym * dym);
            const x1 = z.circle.center.lng - dxm / metersPerDegLng;
            const x2 = z.circle.center.lng + dxm / metersPerDegLng;
            features.push({
              type: 'Feature',
              properties: { kind: 'line', zoneId: z.id, color: z.color },
              geometry: { type: 'LineString', coordinates: [[x1, y], [x2, y]] },
            });
            return;
          }
          if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
            const ring = z.polygon.coordinates[0];
            const segs = clipHorizontalLineToPolygon(y, ring);
            for (const [a, b] of segs) {
              features.push({
                type: 'Feature',
                properties: { kind: 'line', zoneId: z.id, color: z.color },
                geometry: { type: 'LineString', coordinates: [[a, y], [b, y]] },
              });
            }
          }
        };

        // vertical lines
        for (let c = 1; c < cols; c++) {
          const x = bbox.minLng + c * dx;
          addVerticalSegments(x);
        }

        // horizontal lines
        for (let r = 1; r < rows; r++) {
          const y = bbox.minLat + r * dy;
          addHorizontalSegments(y);
        }

        // column labels (bottom): A, B, C...
        for (let c = 0; c < cols; c++) {
          const x = bbox.minLng + (c + 0.5) * dx;
          const bottom = getBottomBoundaryAtX(x);
          if (bottom == null) continue;
          const y = bottom;
          const letter = String.fromCharCode('A'.charCodeAt(0) + c);
          features.push({
            type: 'Feature',
            properties: { kind: 'label', axis: 'x', zoneId: z.id, text: letter, rows, cols },
            geometry: { type: 'Point', coordinates: [x, y] },
          });
        }

        // row labels (left): 1.. (bottom->top)
        for (let r = 0; r < rows; r++) {
          const y = bbox.minLat + (r + 0.5) * dy;
          const left = getLeftBoundaryAtY(y);
          if (left == null) continue;
          const x = left;
          const num = String(r + 1);
          features.push({
            type: 'Feature',
            properties: { kind: 'label', axis: 'y', zoneId: z.id, text: num, rows, cols },
            geometry: { type: 'Point', coordinates: [x, y] },
          });
        }

        // cell labels (center): A1, B2, etc.
        // On les génère toujours; la taille est ensuite adaptée via text-size
        // en fonction de la densité (rows*cols) et du zoom.
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = bbox.minLng + (c + 0.5) * dx;
            const y = bbox.minLat + (r + 0.5) * dy;

            if (!isPointInZone(x, y, z)) continue;

            const colLetter = String.fromCharCode('A'.charCodeAt(0) + c);
            const rowNumber = r + 1;
            const text = `${colLetter}${rowNumber}`;

            features.push({
              type: 'Feature',
              properties: { kind: 'cell', zoneId: z.id, text, rows, cols },
              geometry: { type: 'Point', coordinates: [x, y] },
            });
          }
        }
      }

      zonesGridSource.setData({ type: 'FeatureCollection', features } as any);
    }

    if (poisSource) {
      poisSource.setData({
        type: 'FeatureCollection',
        features: pois.map((p) => ({
          type: 'Feature',
          properties: { id: p.id, type: p.type, title: p.title, icon: p.icon, color: p.color, comment: p.comment },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })) as any,
      });
    }

    if (draftPoiSource) {
      if (activeTool === 'poi' && draftLngLat) {
        draftPoiSource.setData({
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
        draftPoiSource.setData({ type: 'FeatureCollection', features: [] } as any);
      }
    }

    if (draftZoneSource) {
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

    const initialStyle = currentBaseStyle ?? baseStyles[0]?.style;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: initialStyle,
      center: [2.3522, 48.8566],
      zoom: 13,
    });

    const onLoad = () => {
      ensureOverlays(map);
      applyGridLabelStyle(map);
      resyncAllOverlays(map);
      setMapReady(true);
    };

    map.on('load', onLoad);
    mapInstanceRef.current = map;

    return () => {
      map.off('load', onLoad);

      for (const marker of poiMarkersRef.current.values()) {
        marker.remove();
      }
      poiMarkersRef.current.clear();

      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!currentBaseStyle) return;

    map.setStyle(currentBaseStyle);

    const onStyleData = () => {
      ensureOverlays(map);
      applyGridLabelStyle(map);
      resyncAllOverlays(map);
    };

    map.once('styledata', onStyleData);

    return () => {
      map.off('styledata', onStyleData as any);
    };
  }, [currentBaseStyle]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    const poisSource = map.getSource('pois') as GeoJSONSource | undefined;
    if (poisSource) {
      poisSource.setData({
        type: 'FeatureCollection',
        features: pois.map((p) => ({
          type: 'Feature',
          properties: { color: p.color },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      });
    }
  }, [pois, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    resyncAllOverlays(map);
  }, [zones, mapReady]);

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

    const onSnapshot = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      const now = Date.now();

      const positions = (msg.positions && typeof msg.positions === 'object' ? msg.positions : {}) as Record<
        string,
        { lng: number; lat: number; t: number }
      >;
      const traces = (msg.traces && typeof msg.traces === 'object' ? msg.traces : {}) as Record<
        string,
        { lng: number; lat: number; t: number }[]
      >;

      const cutoff = now - traceRetentionMs;

      const nextOthers: Record<string, { lng: number; lat: number; t: number }> = {};
      for (const [userId, p] of Object.entries(positions)) {
        if (!userId) continue;
        if (user?.id && userId === user.id) continue;
        if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
        const t = typeof p.t === 'number' ? p.t : now;
        if (t < cutoff) continue;
        nextOthers[userId] = { lng: p.lng, lat: p.lat, t };
      }

      const nextOthersTraces: Record<string, { lng: number; lat: number; t: number }[]> = {};
      for (const [userId, pts] of Object.entries(traces)) {
        if (!userId) continue;
        if (user?.id && userId === user.id) continue;
        if (!Array.isArray(pts) || pts.length === 0) continue;
        const filtered = pts
          .filter((p) => p && typeof p.lng === 'number' && typeof p.lat === 'number')
          .map((p) => ({ lng: p.lng, lat: p.lat, t: typeof p.t === 'number' ? p.t : now }))
          .filter((p) => p.t >= cutoff)
          .slice(-maxTracePoints);
        if (filtered.length) {
          nextOthersTraces[userId] = filtered;
        }
      }

      otherTracesRef.current = nextOthersTraces;
      setOtherPositions(nextOthers);
    };

    const onPos = (msg: any) => {
      if (!msg?.userId || typeof msg.lng !== 'number' || typeof msg.lat !== 'number') return;
      if (user?.id && msg.userId === user.id) return;

      // Toujours utiliser uniquement la couleur de mission attribuée au membre.
      const memberColor = memberColors[msg.userId];
      if (memberColor) {
        otherColorsRef.current[msg.userId] = memberColor;
      }
      const now = typeof msg.t === 'number' ? msg.t : Date.now();
      const traces = otherTracesRef.current[msg.userId] ?? [];
      const cutoff = Date.now() - traceRetentionMs;
      const nextTraces = [...traces, { lng: msg.lng, lat: msg.lat, t: now }]
        .filter((p) => p.t >= cutoff)
        .slice(-maxTracePoints);
      otherTracesRef.current[msg.userId] = nextTraces;

      setOtherPositions((prev) => ({
        ...prev,
        [msg.userId]: { lng: msg.lng, lat: msg.lat, t: now },
      }));
    };

    socket.on('mission:snapshot', onSnapshot);
    socket.on('position:update', onPos);

    const onPosClear = (msg: any) => {
      if (!msg?.userId) return;
      setOtherPositions((prev) => {
        const next = { ...prev };
        delete next[msg.userId];
        return next;
      });
      delete otherTracesRef.current[msg.userId];
    };

    socket.on('position:clear', onPosClear);

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
      socket.off('mission:snapshot', onSnapshot);
      socket.off('position:update', onPos);
      socket.off('position:clear', onPosClear);
      socket.off('poi:created', onPoiCreated);
      socket.off('poi:updated', onPoiUpdated);
      socket.off('poi:deleted', onPoiDeleted);
      socket.off('zone:created', onZoneCreated);
      socket.off('zone:updated', onZoneUpdated);
      socket.off('zone:deleted', onZoneDeleted);
      socket.emit('mission:leave', {});
    };
  }, [selectedMissionId, user?.id, memberColors, traceRetentionMs, maxTracePoints]);

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
    if (!selectedMissionId) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }
    if (!navigator.geolocation) return;

    // Stop any existing watcher before applying new tracking state.
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (!trackingEnabled) {
      // Tracking has been disabled: clear our own position and trace locally
      setLastPos(null);
      setTracePoints([]);

      // Persist cleared self trace for this mission
      if (selectedMissionId && user?.id) {
        const key = `geogn.trace.self.${selectedMissionId}.${user.id}`;
        try {
          localStorage.setItem(key, JSON.stringify([]));
        } catch {
          // ignore storage errors
        }
      }

      // Notify other clients so they remove our point and trace
      const socket = socketRef.current;
      if (socket) {
        socket.emit('position:clear', {});
      }

      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        const t = Date.now();

        setLastPos({ lng, lat });
        setTracePoints((prev) => {
          const cutoff = Date.now() - traceRetentionMs;
          const next = [...prev, { lng, lat, t }].filter((p) => p.t >= cutoff);
          return next.slice(-maxTracePoints);
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
  }, [selectedMissionId, trackingEnabled, traceRetentionMs, maxTracePoints]);

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

    const applyMarkerContent = (el: HTMLDivElement, p: ApiPoi) => {
      const Icon = getPoiIconComponent(p.icon);
      const iconColor = (p.color || '').toLowerCase() === '#ffffff' ? '#000000' : '#ffffff';
      const svg = renderToStaticMarkup(<Icon size={16} color={iconColor} strokeWidth={2.5} />);
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
      // Slightly offset the icon inside the circle (mostly upward) without moving the marker anchor.
      el.innerHTML = `<div style="transform: translate(0px, -0.5px); display:flex; align-items:center; justify-content:center;">${svg}</div>`;
      el.title = p.title;

      el.onclick = () => {
        setSelectedPoi(p);
      };
    };

    // remove stale markers
    for (const [id, marker] of markers.entries()) {
      if (!nextIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    for (const p of pois) {
      const existing = markers.get(p.id);
      if (existing) {
        existing.setLngLat([p.lng, p.lat]);
        const el = existing.getElement() as HTMLDivElement;
        applyMarkerContent(el, p);
      } else {
        const el = document.createElement('div');
        applyMarkerContent(el, p);
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

    const now = Date.now();
    const inactiveAfterMs = 60_000;
    const features = Object.entries(otherPositions).map(([userId, p]) => {
      const memberColor = memberColors[userId];
      const isInactive = now - p.t > inactiveAfterMs;
      // Inactif: gris foncé. Sinon, couleur de mission.
      const color = isInactive ? '#374151' : (memberColor ?? '#374151');

      return {
        type: 'Feature',
        properties: {
          userId,
          t: p.t,
          color,
          name: '',
        },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      };
    });

    src.setData({
      type: 'FeatureCollection',
      features: features as any,
    });
  }, [otherPositions, memberColors, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('others-traces') as GeoJSONSource | undefined;
    if (!src) return;

    const now = Date.now();
    const inactiveAfterMs = 60_000;
    const features: any[] = [];
    for (const [userId, pts] of Object.entries(otherTracesRef.current)) {
      if (pts.length < 2) continue;
      const memberColor = memberColors[userId];
      const lastT = pts[pts.length - 1]?.t ?? 0;
      const isInactive = now - lastT > inactiveAfterMs;
      const color = isInactive ? '#374151' : (memberColor ?? '#374151');

      const tA = now - traceRetentionMs * (2 / 3);
      const tB = now - traceRetentionMs * (1 / 3);

      const oldest = pts.filter((p) => p.t < tA);
      const middle = pts.filter((p) => p.t >= tA && p.t < tB);
      const newest = pts.filter((p) => p.t >= tB);

      const pushSeg = (segPts: typeof pts, opacity: number) => {
        if (segPts.length < 2) return;
        features.push({
          type: 'Feature',
          properties: { userId, color, opacity },
          geometry: { type: 'LineString', coordinates: segPts.map((p) => [p.lng, p.lat]) },
        });
      };

      pushSeg(oldest, 0.3);
      pushSeg(middle, 0.6);
      pushSeg(newest, 0.9);
    }

    src.setData({ type: 'FeatureCollection', features } as any);
  }, [otherPositions, memberColors, mapReady, traceRetentionMs]);

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
      } else {
        // Si aucune position n'est disponible (par exemple localisation désactivée),
        // vider la source pour faire disparaître le point "me" de la carte.
        meSource.setData({ type: 'FeatureCollection', features: [] } as any);
      }

      const retentionMs = traceRetentionMs;
      const now = Date.now();
      const filtered = tracePoints.filter((p) => now - p.t <= retentionMs);
      if (filtered.length !== tracePoints.length) setTracePoints(filtered);

      if (filtered.length >= 2) {
        const tA = now - retentionMs * (2 / 3);
        const tB = now - retentionMs * (1 / 3);

        const oldest = filtered.filter((p) => p.t < tA);
        const middle = filtered.filter((p) => p.t >= tA && p.t < tB);
        const newest = filtered.filter((p) => p.t >= tB);

        const features: any[] = [];
        const pushSeg = (segPts: typeof filtered, opacity: number) => {
          if (segPts.length < 2) return;
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: segPts.map((p) => [p.lng, p.lat]) },
            properties: { opacity },
          });
        };

        pushSeg(oldest, 0.3);
        pushSeg(middle, 0.6);
        pushSeg(newest, 0.9);

        traceSource.setData({
          type: 'FeatureCollection',
          features,
        });
      } else {
        traceSource.setData({ type: 'FeatureCollection', features: [] });
      }
    };

    update();
  }, [lastPos, tracePoints, mapReady, traceRetentionMs]);

  return (
    <div className="relative w-full h-screen">
      <div ref={mapRef} className="w-full h-full" />

      {selectedPoi && (
        <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/25 backdrop-blur-sm">
          <div className="mx-6 max-w-md w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-xl flex items-start gap-3">
            <div className="mt-0.5 flex-shrink-0 flex items-center justify-center">
              {(() => {
                const Icon = getPoiIconComponent(selectedPoi.icon);
                return (
                  <div className="h-9 w-9 rounded-full border-2 border-white shadow" style={{ backgroundColor: selectedPoi.color || '#f97316' }}>
                    <div className="flex h-full w-full items-center justify-center">
                      <Icon size={16} color="#ffffff" strokeWidth={2.5} />
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="truncate text-sm font-semibold text-gray-900">{selectedPoi.title}</div>
              <div className="mt-1 text-xs text-gray-700 break-words">
                {selectedPoi.comment || 'Aucune description'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPoi(null)}
              className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-700"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            setTrackingEnabled((prev) => {
              const next = !prev;
              // Si on vient de réactiver le tracking, forcer une mise à jour immédiate de la position
              // pour réafficher le point et relancer un nouveau tracé, pour soi et pour les autres.
              if (!prev && next && navigator.geolocation && selectedMissionId && user?.id) {
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    const lng = pos.coords.longitude;
                    const lat = pos.coords.latitude;
                    const t = Date.now();

                    setLastPos({ lng, lat });
                    setTracePoints([{ lng, lat, t }]);

                    const socket = socketRef.current;
                    if (socket) {
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
                  () => {
                    // ignore error; le watcher prendra le relais si possible
                  },
                  {
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 5000,
                  }
                );
              }
              return next;
            });
          }}
          className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur inline-flex items-center justify-center hover:bg-white"
        >
          {trackingEnabled ? (
            <Navigation className="mx-auto text-green-600" size={22} />
          ) : (
            <NavigationOff className="mx-auto text-gray-600" size={22} />
          )}
        </button>

        <button
          type="button"
          onClick={centerOnMe}
          className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Centrer sur moi"
        >
          <Crosshair className="mx-auto text-gray-600" size={22} />
        </button>

        <button
          type="button"
          onClick={toggleMapStyle}
          className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Changer le fond de carte"
        >
          <Layers className="mx-auto text-gray-600" size={22} />
        </button>

        <button
          type="button"
          onClick={() => setLabelsEnabled((v) => !v)}
          className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur inline-flex items-center justify-center hover:bg-white"
          title="Afficher les noms (POI + zones + utilisateurs)"
        >
          <Tag
            className={`mx-auto ${labelsEnabled ? 'text-green-600' : 'text-gray-600'}`}
            size={20}
          />
        </button>

        {canEdit ? (
          <>
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
              <MapPin
                className={
                  activeTool === 'poi' ? 'mx-auto' : 'mx-auto text-gray-600'
                }
                size={22}
              />
            </button>

            <div className="relative flex items-center justify-end">
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setZoneMenuOpen((v) => !v);
                }}
                className={`h-14 w-14 rounded-2xl border shadow backdrop-blur inline-flex items-center justify-center transition-colors ${
                  activeTool === 'zone_circle' || activeTool === 'zone_polygon'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white/90 hover:bg-white text-gray-600'
                }`}
                title="Zones"
              >
                <CircleDotDashed
                  className={
                    activeTool === 'zone_circle' || activeTool === 'zone_polygon'
                      ? 'mx-auto text-white'
                      : 'mx-auto text-gray-600'
                  }
                  size={22}
                />
              </button>

              {zoneMenuOpen ? (
                <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 rounded-2xl border bg-white/90 p-2 shadow backdrop-blur">
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
                    <CircleDot
                      className={
                        activeTool === 'zone_circle' ? 'text-white' : 'text-gray-600'
                      }
                      size={20}
                    />
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
                    <Spline
                      className={
                        activeTool === 'zone_polygon' ? 'text-white' : 'text-gray-600'
                      }
                      size={20}
                    />
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="flex flex-col gap-3 pt-1">
          <button
            type="button"
            onClick={resetNorth}
            className="h-14 w-14 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
            title="Boussole"
          >
            <Compass className="mx-auto text-gray-600" size={22} />
          </button>
        </div>
      </div>

      {activeTool !== 'none' && activeTool !== 'zone_polygon' && !showValidation ? (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 z-[1000] rounded-2xl border bg-white/90 px-4 py-2 text-sm shadow backdrop-blur">
          {activeTool === 'poi'
            ? 'Mode POI: clique sur la carte'
            : activeTool === 'zone_circle'
              ? 'Zone ronde: clique sur le centre'
              : 'Zone libre: clique pour poser des points'}
        </div>
      ) : null}

      {activeTool === 'zone_polygon' && !showValidation ? (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 z-[1100] flex gap-2">
          <button
            type="button"
            onClick={undoPolygonPoint}
            className="h-11 rounded-2xl bg-red-600 px-3 text-sm font-semibold text-white shadow inline-flex items-center gap-2 hover:bg-red-700"
          >
            <Undo2 size={16} />
            Annuler
          </button>
          <button
            type="button"
            onClick={validatePolygon}
            className="h-11 rounded-2xl bg-green-600 px-3 text-sm font-semibold text-white shadow inline-flex items-center gap-2 hover:bg-green-700"
          >
            <Check size={16} />
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
                <div className="mt-3 rounded-2xl border p-3">
                  <div className="text-xs font-semibold text-gray-700">Couleur</div>
                  <div className="mt-2 flex flex-wrap gap-2">
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

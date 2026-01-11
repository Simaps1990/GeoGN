import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMapInstance, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  AlertTriangle,
  Bike,
  Binoculars,
  Bomb,
  Car,
  Cctv,
  Church,
  CircleDot,
  CircleDotDashed,
  Coffee,
  Compass,
  Crosshair,
  Dog,
  Flag,
  Flame,
  HelpCircle,
  House,
  Layers,
  MapPin,
  Mic,
  Navigation2,
  PawPrint,
  Pencil,
  Radiation,
  Ruler,
  ShieldPlus,
  Trash2,
  Siren,
  Skull,
  Spline,
  Tag,
  Timer,
  Truck,
  UserRound,
  Warehouse,
  X,
  Zap,
} from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAuth } from '../contexts/AuthContext';
import { useMission } from '../contexts/MissionContext';
import { getSocket } from '../lib/socket';
import {
  createPoi,
  createZone,
  deletePoi,
  deleteZone,
  getMission,
  listPois,
  listMissionMembers,
  listZones,
  updatePoi,
  updateZone,
  updateMission,
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

function cloneStyle<T>(style: T): T {
  try {
    return (globalThis as any).structuredClone(style);
  } catch {
    return JSON.parse(JSON.stringify(style)) as T;
  }
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

function haversineMeters(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const R = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
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
  const y = bbox.minLat - height * 0.015;
  return { lng: cx, lat: y };
}

function pickZoneLabelColor(zoneColor: string | undefined | null) {
  const c = (zoneColor || '').trim();
  if (!c) return '#111827';
  if (!c.startsWith('#')) return c;
  const hex = c.slice(1);
  const full =
    hex.length === 3
      ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
      : hex.length === 6
        ? hex
        : '';
  if (!full) return c;

  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (![r, g, b].every((v) => Number.isFinite(v))) return c;

  // Relative luminance (sRGB)
  const srgb = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];

  // If too light, keep a dark readable label.
  if (L > 0.75) return '#111827';
  return c;
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
  const pendingBulkRef = useRef<{ lng: number; lat: number; t: number; speed?: number; heading?: number; accuracy?: number }[]>([]);
  const pendingActionsRef = useRef<any[]>([]);

  const scaleControlRef = useRef<maplibregl.ScaleControl | null>(null);
  const scaleControlElRef = useRef<HTMLElement | null>(null);

  const poiMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const polygonDraftRef = useRef<[number, number][]>([]);

  const otherColorsRef = useRef<Record<string, string>>({});
  const otherTracesRef = useRef<Record<string, { lng: number; lat: number; t: number }[]>>({});

  const [memberColors, setMemberColors] = useState<Record<string, string>>({});
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});

  const [lastPos, setLastPos] = useState<{ lng: number; lat: number } | null>(null);
  const [tracePoints, setTracePoints] = useState<{ lng: number; lat: number; t: number }[]>([]);
  const [otherPositions, setOtherPositions] = useState<Record<string, { lng: number; lat: number; t: number }>>({});
  const [pois, setPois] = useState<ApiPoi[]>([]);
  const [selectedPoi, setSelectedPoi] = useState<ApiPoi | null>(null);
  const [navPickerPoi, setNavPickerPoi] = useState<ApiPoi | null>(null);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!navPickerPoi) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavPickerPoi(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navPickerPoi]);

  const [editingPoiId, setEditingPoiId] = useState<string | null>(null);

  const [baseStyleIndex, setBaseStyleIndex] = useState(0);

  const [trackingEnabled] = useState(true);

  const [zoneMenuOpen, setZoneMenuOpen] = useState(false);

  const [activeTool, setActiveTool] = useState<'none' | 'poi' | 'zone_circle' | 'zone_polygon'>('none');
  const [draftLngLat, setDraftLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [draftCircleRadius, setDraftCircleRadius] = useState(250);
  const [draftCircleEdgeLngLat, setDraftCircleEdgeLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [circleRadiusReady, setCircleRadiusReady] = useState(false);
  const [polygonDraftCount, setPolygonDraftCount] = useState(0);

  const activeToolRef = useRef(activeTool);
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  const [showValidation, setShowValidation] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftComment, setDraftComment] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [draftIcon, setDraftIcon] = useState('');

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPoi) return;
    const next = pois.find((p) => p.id === selectedPoi.id);
    if (!next) return;
    if (next === selectedPoi) return;
    setSelectedPoi(next);
  }, [pois, selectedPoi]);

  const [labelsEnabled, setLabelsEnabled] = useState(false);
  const [scaleEnabled, setScaleEnabled] = useState(true);

  const poiColorOptions = useMemo(
    () => [
      '#ef4444',
      '#f97316',
      '#fde047',
      '#4ade80',
      '#596643',
      '#60a5fa',
      '#1e3a8a',
      '#a855f7',
      '#ec4899',
      '#6b3f35',
      '#a19579',
      '#000000',
      '#ffffff',
    ],
    []
  );

  const poiIconOptions = useMemo(
    () => [
      { id: 'target', Icon: Crosshair, label: 'Target' },
      { id: 'flag', Icon: Flag, label: 'Flag' },
      { id: 'alert', Icon: AlertTriangle, label: 'Alert' },
      { id: 'help', Icon: HelpCircle, label: 'Help' },
      { id: 'flame', Icon: Flame, label: 'Flame' },
      { id: 'radiation', Icon: Radiation, label: 'Radiation' },
      { id: 'bomb', Icon: Bomb, label: 'Bomb' },
      { id: 'skull', Icon: Skull, label: 'Skull' },
      { id: 'user_round', Icon: UserRound, label: 'User Round' },
      { id: 'house', Icon: House, label: 'House' },
      { id: 'warehouse', Icon: Warehouse, label: 'Warehouse' },
      { id: 'church', Icon: Church, label: 'Church' },
      { id: 'coffee', Icon: Coffee, label: 'Coffee' },
      { id: 'car', Icon: Car, label: 'Car' },
      { id: 'truck', Icon: Truck, label: 'Truck' },
      { id: 'motorcycle', Icon: Bike, label: 'Motorbike' },
      { id: 'cctv', Icon: Cctv, label: 'CCTV' },
      { id: 'mic', Icon: Mic, label: 'Mic' },
      { id: 'dog', Icon: Dog, label: 'Dog' },
      { id: 'paw', Icon: PawPrint, label: 'Paw' },
      { id: 'siren', Icon: Siren, label: 'Siren' },
      { id: 'zap', Icon: Zap, label: 'Lightning' },
      { id: 'shield_plus', Icon: ShieldPlus, label: 'Shield Plus' },
      { id: 'binoculars', Icon: Binoculars, label: 'Binoculars' },
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

  const [timerModalOpen, setTimerModalOpen] = useState(false);
  const [timerSecondsInput, setTimerSecondsInput] = useState('');
  const [timerSaving, setTimerSaving] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);

  const [isMapRotated, setIsMapRotated] = useState(false);

  const traceRetentionMs = useMemo(() => {
    const s = mission?.traceRetentionSeconds;
    const seconds = typeof s === 'number' && Number.isFinite(s) ? s : 3600;
    return Math.max(0, seconds) * 1000;
  }, [mission?.traceRetentionSeconds]);

  // Immediate purge when retention decreases.
  const prevTraceRetentionMsRef = useRef<number>(traceRetentionMs);
  const lastViewRef = useRef<{ lng: number; lat: number; zoom: number; bearing: number; pitch: number } | null>(null);
  useEffect(() => {
    const prev = prevTraceRetentionMsRef.current;
    prevTraceRetentionMsRef.current = traceRetentionMs;
    if (traceRetentionMs <= 0) return;
    if (prev <= 0) return;
    if (traceRetentionMs >= prev) return;

    const cutoff = Date.now() - traceRetentionMs;
    setTracePoints((prevPts) => prevPts.filter((p) => p.t >= cutoff));

    const nextOthers: Record<string, { lng: number; lat: number; t: number }[]> = {};
    for (const [userId, pts] of Object.entries(otherTracesRef.current)) {
      const filtered = pts.filter((p) => p.t >= cutoff);
      if (filtered.length) nextOthers[userId] = filtered;
    }
    otherTracesRef.current = nextOthers;

    setOtherPositions((prevPos) => {
      const next: Record<string, { lng: number; lat: number; t: number }> = {};
      for (const [userId, p] of Object.entries(prevPos)) {
        if (p && typeof p.t === 'number' && p.t >= cutoff) next[userId] = p;
      }
      return next;
    });
  }, [traceRetentionMs]);

  const maxTracePoints = useMemo(() => {
    // Cible: pouvoir garder une heure à ~1 point/sec (3600) sans tronquer.
    const approxPoints = Math.ceil(traceRetentionMs / 1000);
    return Math.max(2000, approxPoints + 200);
  }, [traceRetentionMs]);

  // Par défaut, tant que la mission n'est pas chargée, on considère que l'utilisateur ne peut pas éditer
  // afin d'éviter un flash de boutons d'édition pour les comptes visualisateurs.
  const canEdit = !!mission && mission.membership?.role !== 'viewer';
  const isAdmin = !!mission && mission.membership?.role === 'admin';

  const getPendingActionsKey = (missionId: string) => `geogn.pendingActions.${missionId}`;

  const persistPendingActions = (missionId: string) => {
    try {
      localStorage.setItem(getPendingActionsKey(missionId), JSON.stringify(pendingActionsRef.current.slice(-5000)));
    } catch {
      // ignore
    }
  };

  const enqueueAction = (missionId: string, action: any) => {
    // Compact: if we create a local entity and then update it before sync, merge into create.
    // If we create and then delete before sync, drop both.
    try {
      if (action?.entity === 'poi') {
        if (action.op === 'update') {
          const idx = pendingActionsRef.current.findIndex(
            (a) => a && a.entity === 'poi' && a.op === 'create' && a.localId && a.localId === action.id
          );
          if (idx >= 0) {
            const existing = pendingActionsRef.current[idx];
            existing.payload = { ...(existing.payload || {}), ...(action.payload || {}) };
            persistPendingActions(missionId);
            return;
          }
        }
        if (action.op === 'delete') {
          const idx = pendingActionsRef.current.findIndex(
            (a) => a && a.entity === 'poi' && a.op === 'create' && a.localId && a.localId === action.id
          );
          if (idx >= 0) {
            pendingActionsRef.current = pendingActionsRef.current.filter((_, i) => i !== idx);
            persistPendingActions(missionId);
            return;
          }
        }
      }

      if (action?.entity === 'zone') {
        if (action.op === 'update') {
          const idx = pendingActionsRef.current.findIndex(
            (a) => a && a.entity === 'zone' && a.op === 'create' && a.localId && a.localId === action.id
          );
          if (idx >= 0) {
            const existing = pendingActionsRef.current[idx];
            existing.payload = { ...(existing.payload || {}), ...(action.payload || {}) };
            persistPendingActions(missionId);
            return;
          }
        }
        if (action.op === 'delete') {
          const idx = pendingActionsRef.current.findIndex(
            (a) => a && a.entity === 'zone' && a.op === 'create' && a.localId && a.localId === action.id
          );
          if (idx >= 0) {
            pendingActionsRef.current = pendingActionsRef.current.filter((_, i) => i !== idx);
            persistPendingActions(missionId);
            return;
          }
        }
      }
    } catch {
      // ignore
    }

    pendingActionsRef.current = [...pendingActionsRef.current, action].slice(-5000);
    persistPendingActions(missionId);
  };

  const flushPendingActions = async (missionId: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    const list = pendingActionsRef.current;
    if (!Array.isArray(list) || list.length === 0) return;

    let changed = false;
    const idMap = new Map<string, string>();
    const remaining: any[] = [];

    for (const a of list) {
      if (!a || !a.entity || !a.op) continue;
      try {
        if (a.entity === 'poi') {
          const targetId = typeof a.id === 'string' ? (idMap.get(a.id) ?? a.id) : '';
          if (a.op === 'create') {
            const created = await createPoi(missionId, a.payload);
            if (a.localId) {
              idMap.set(a.localId, created.id);
              setPois((prev) => prev.map((p) => (p.id === a.localId ? created : p)));
            } else {
              setPois((prev) => (prev.some((p) => p.id === created.id) ? prev : [created, ...prev]));
            }
            changed = true;
            continue;
          }
          if (a.op === 'update') {
            if (!targetId) continue;
            if (targetId.startsWith('local-') && !idMap.get(targetId)) {
              remaining.push(a);
              continue;
            }
            const updated = await updatePoi(missionId, targetId, a.payload);
            setPois((prev) => prev.map((p) => (p.id === targetId ? updated : p)));
            changed = true;
            continue;
          }
          if (a.op === 'delete') {
            if (!targetId) continue;
            if (targetId.startsWith('local-') && !idMap.get(targetId)) {
              changed = true;
              continue;
            }
            await deletePoi(missionId, targetId);
            setPois((prev) => prev.filter((p) => p.id !== targetId));
            changed = true;
            continue;
          }
        }

        if (a.entity === 'zone') {
          const targetId = typeof a.id === 'string' ? (idMap.get(a.id) ?? a.id) : '';
          if (a.op === 'create') {
            const created = await createZone(missionId, a.payload);
            if (a.localId) {
              idMap.set(a.localId, created.id);
              setZones((prev) => prev.map((z) => (z.id === a.localId ? created : z)));
            } else {
              setZones((prev) => (prev.some((z) => z.id === created.id) ? prev : [created, ...prev]));
            }
            changed = true;
            continue;
          }
          if (a.op === 'update') {
            if (!targetId) continue;
            if (targetId.startsWith('local-') && !idMap.get(targetId)) {
              remaining.push(a);
              continue;
            }
            const updated = await updateZone(missionId, targetId, a.payload);
            setZones((prev) => prev.map((z) => (z.id === targetId ? updated : z)));
            changed = true;
            continue;
          }
          if (a.op === 'delete') {
            if (!targetId) continue;
            if (targetId.startsWith('local-') && !idMap.get(targetId)) {
              changed = true;
              continue;
            }
            await deleteZone(missionId, targetId);
            setZones((prev) => prev.filter((z) => z.id !== targetId));
            changed = true;
            continue;
          }
        }
      } catch {
        remaining.push(a);
        const idx = list.indexOf(a);
        if (idx >= 0) {
          for (let i = idx + 1; i < list.length; i++) remaining.push(list[i]);
        }
        break;
      }
    }

    if (changed || remaining.length !== list.length) {
      pendingActionsRef.current = remaining;
      persistPendingActions(missionId);
    }
  };

  async function onSaveTraceRetentionSeconds() {
    if (!selectedMissionId) return;
    if (!isAdmin) return;
    setTimerSaving(true);
    setTimerError(null);
    try {
      const trimmed = timerSecondsInput.trim();
      const parsed = trimmed ? Number(trimmed) : NaN;
      if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
        setTimerError('Durée invalide');
        return;
      }
      const nextRetention = Math.max(0, Math.floor(parsed));
      const updated = await updateMission(selectedMissionId, { traceRetentionSeconds: nextRetention });
      setMission(updated);
      setTimerModalOpen(false);
      try {
        window.dispatchEvent(new CustomEvent('geotacops:mission:updated', { detail: { mission: updated } }));
      } catch {
        // ignore
      }
    } catch (e: any) {
      setTimerError(e?.message ?? 'Erreur');
    } finally {
      setTimerSaving(false);
    }
  }

  useEffect(() => {
    if (!selectedMissionId) return;

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

  useEffect(() => {
    if (!selectedMissionId) return;
    const socket = getSocket();
    const onMissionUpdated = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      const nextRetention =
        typeof msg.traceRetentionSeconds === 'number' && Number.isFinite(msg.traceRetentionSeconds)
          ? msg.traceRetentionSeconds
          : null;
      if (nextRetention === null) return;

      setMission((prev) => {
        const prevRetention = prev?.traceRetentionSeconds;
        const next = prev ? { ...prev, traceRetentionSeconds: nextRetention } : prev;

        // If retention increased, request a fresh snapshot to fill missing history.
        if (prevRetention && nextRetention > prevRetention) {
          try {
            socket.emit('mission:join', { missionId: selectedMissionId });
          } catch {
            // ignore
          }
        }

        return next;
      });
    };

    const onMissionUpdatedWindow = (e: any) => {
      const m = e?.detail?.mission as ApiMission | undefined;
      if (!m || m.id !== selectedMissionId) return;
      onMissionUpdated({ missionId: m.id, traceRetentionSeconds: m.traceRetentionSeconds });
    };

    socket.on('mission:updated', onMissionUpdated);
    window.addEventListener('geotacops:mission:updated', onMissionUpdatedWindow as any);
    return () => {
      socket.off('mission:updated', onMissionUpdated);
      window.removeEventListener('geotacops:mission:updated', onMissionUpdatedWindow as any);
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
      setMemberNames({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const members = await listMissionMembers(selectedMissionId);
        if (cancelled) return;
        const next: Record<string, string> = {};
        const nextNames: Record<string, string> = {};
        for (const m of members) {
          const id = m.user?.id;
          if (!id) continue;
          const c = typeof m.color === 'string' ? m.color.trim() : '';
          if (c) next[id] = c;
          const name = typeof m.user?.displayName === 'string' ? m.user.displayName.trim() : '';
          if (name) nextNames[id] = name;
        }
        setMemberColors(next);
        setMemberNames(nextNames);
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

    applyMyDynamicPaint(map);
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

    const onFlyTo = (e: any) => {
      const lng = e?.detail?.lng;
      const lat = e?.detail?.lat;
      const zoom = e?.detail?.zoom;
      if (typeof lng !== 'number' || typeof lat !== 'number') return;
      try {
        map.easeTo({ center: [lng, lat], zoom: typeof zoom === 'number' ? zoom : Math.max(map.getZoom(), 16), duration: 600 });
        sessionStorage.setItem('geogn.skipMapViewOnce', '1');
      } catch {
        // ignore
      }
    };

    window.addEventListener('geogn:map:flyTo', onFlyTo as any);
    return () => {
      window.removeEventListener('geogn:map:flyTo', onFlyTo as any);
    };
  }, [mapReady]);

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

    const existing = lastViewRef.current;
    if (existing) {
      map.jumpTo({
        center: [existing.lng, existing.lat],
        zoom: existing.zoom,
        bearing: existing.bearing,
        pitch: existing.pitch,
      });
      return;
    }

    const saved = localStorage.getItem(mapViewKey);
    if (!saved) return;
    try {
      const v = JSON.parse(saved) as any;
      if (v && typeof v.lng === 'number' && typeof v.lat === 'number') {
        const view = {
          lng: v.lng,
          lat: v.lat,
          zoom: typeof v.zoom === 'number' ? v.zoom : map.getZoom(),
          bearing: typeof v.bearing === 'number' ? v.bearing : 0,
          pitch: typeof v.pitch === 'number' ? v.pitch : 0,
        };
        lastViewRef.current = view;
        map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom, bearing: view.bearing, pitch: view.pitch });
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

  // Rendre les labels utilisateurs robustes: si la couche existait déjà (cache/style reload),
  // on force les propriétés nécessaires pour qu'ils soient effectivement rendus.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!map.getLayer('others-labels')) return;

    try {
      map.setLayoutProperty('others-labels', 'text-allow-overlap', true);
      map.setLayoutProperty('others-labels', 'text-ignore-placement', true);
      map.setPaintProperty('others-labels', 'text-color', ['coalesce', ['get', 'color'], '#111827']);
    } catch {
      // ignore
    }
  }, [mapReady, labelsEnabled]);

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

  // Ajuster la hauteur du label des zones (plus haut).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!map.getLayer('zones-labels')) return;
    try {
      map.setLayoutProperty('zones-labels', 'text-offset', [0, 0.03]);
    } catch {
      // ignore
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
          '© OpenStreetMap contributors'
        ),
      },
      {
        id: 'sat',
        style: getRasterStyle(
          ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          'Tiles Esri'
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
        id: 'voyager',
        style: getRasterStyle(
          [
            'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
            'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
            'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
            'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
          ],
          '© OpenStreetMap contributors © CARTO'
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
          '© OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)'
        ),
      },
    ],
    []
  );

  const currentBaseStyle = useMemo(() => {
    const style = baseStyles[baseStyleIndex]?.style;
    return style ? cloneStyle(style) : undefined;
  }, [baseStyleIndex, baseStyles]);

  function applyMyDynamicPaint(map: MapLibreMapInstance) {
    if (!user?.id) return;
    const myColor = memberColors[user.id];
    if (!myColor) return;

    if (map.getLayer('me-dot')) {
      map.setPaintProperty('me-dot', 'circle-color', myColor);
      const stroke = myColor.toLowerCase() === '#ffffff' ? '#d1d5db' : '#ffffff';
      map.setPaintProperty('me-dot', 'circle-stroke-color', stroke);
    }
    if (map.getLayer('trace-line')) {
      map.setPaintProperty('trace-line', 'line-color', myColor);
    }
  }

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
    safeMoveToTop('others-points-inactive-dot');
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
            'line-opacity': 0.9,
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
          'line-opacity': 0.9,
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

    if (!map.getLayer('others-points-inactive-dot')) {
      // Petit point noir au centre uniquement quand le membre est inactif.
      map.addLayer({
        id: 'others-points-inactive-dot',
        type: 'circle',
        source: 'others',
        paint: {
          'circle-radius': 1.8,
          'circle-color': '#000000',
          'circle-opacity': ['case', ['==', ['get', 'inactive'], 1], 1, 0],
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
          visibility: labelsEnabled ? 'visible' : 'none',
          'text-field': ['coalesce', ['get', 'name'], ['get', 'userId'], ''],
          'text-size': 13,
          'text-offset': [0, -1.2],
          'text-anchor': 'bottom',
          'text-optional': true,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': ['coalesce', ['get', 'color'], '#111827'],
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
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
          visibility: labelsEnabled ? 'visible' : 'none',
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
          visibility: labelsEnabled ? 'visible' : 'none',
          'text-field': ['coalesce', ['get', 'title'], ''],
          'text-size': 13,
          'text-offset': [0, 0.03],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': ['coalesce', ['get', 'labelColor'], '#111827'],
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
        const name = memberNames[userId] ?? '';

        return {
          type: 'Feature',
          properties: {
            userId,
            t: p.t,
            color,
            name,
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
          properties: { id: z.id, title: z.title, color: z.color, labelColor: pickZoneLabelColor(z.color) },
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

        if (draftCircleEdgeLngLat) {
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

      if (draftCircleEdgeLngLat) {
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
        const ring = [...coords, coords[0]];
        features.push({
          type: 'Feature',
          properties: { kind: 'fill', color: draftColor },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      }
    }

    src.setData({ type: 'FeatureCollection', features });
  }, [activeTool, draftLngLat, draftCircleRadius, draftColor, draftCircleEdgeLngLat, mapReady]);

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
        const clamped = Math.max(50, Math.round(computed));
        setDraftCircleRadius(clamped);
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
        const ring = [...coords, coords[0]];
        const created = await createZone(selectedMissionId, {
          type: 'polygon',
          title: nextTitle,
          comment: draftComment.trim() || '',
          color: draftColor,
          polygon: { type: 'Polygon', coordinates: [ring] },
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
                createdBy: user?.id ?? 'offline',
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
                  polygon: { type: 'Polygon', coordinates: [[...polygonDraftRef.current, polygonDraftRef.current[0]] ] },
                };
            const optimistic: ApiZone = {
              id: localId,
              title: payload.title,
              comment: payload.comment,
              color: payload.color,
              type: payload.type,
              circle: payload.type === 'circle' ? payload.circle : null,
              polygon: payload.type === 'polygon' ? payload.polygon : null,
              grid: null,
              sectors: null,
              createdBy: user?.id ?? 'offline',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            setZones((prev) => [optimistic, ...prev]);
            enqueueAction(selectedMissionId, { entity: 'zone', op: 'create', localId, payload, t: Date.now() });
          }

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
        } catch {
          // fallthrough
        }
      }
      setActionError(e?.message ?? 'Erreur');
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initialStyle = currentBaseStyle ?? baseStyles[0]?.style;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: initialStyle,
      center: [2.3522, 48.8566],
      zoom: 13,
      attributionControl: false,
      // Localisation des messages internes MapLibre (ex: "Utilisez deux doigts…")
      // pour les modes coopératifs (édition zones / blocage zoom scroll).
      locale: {
        // Cooperative gestures: touch (mobile)
        'CooperativeGesturesHandler.Message': 'Utilisez deux doigts pour déplacer la carte',
        // Cooperative gestures: wheel (desktop)
        'CooperativeGesturesHandler.ScrollZoomBlockerMessage': 'Maintenez Ctrl (ou ⌘ sur Mac) et utilisez la molette pour zoomer',
        // Some versions use ScrollZoomBlocker.* keys
        'ScrollZoomBlocker.CtrlMessage': 'Maintenez Ctrl et utilisez la molette pour zoomer sur la carte',
        'ScrollZoomBlocker.CmdMessage': 'Maintenez ⌘ et utilisez la molette pour zoomer sur la carte',
        // Fallback key used by some builds
        'ScrollZoomBlocker.Message': 'Utilisez Ctrl (ou ⌘ sur Mac) + molette pour zoomer sur la carte',
      } as any,
    });

    const onLoad = () => {
      ensureOverlays(map);
      applyGridLabelStyle(map);
      resyncAllOverlays(map);
      setMapReady(true);
    };

    map.on('load', onLoad);
    mapInstanceRef.current = map;

    // Échelle réelle (mètres / km) placée au-dessus du footer
    try {
      const control = new maplibregl.ScaleControl({ maxWidth: 170, unit: 'metric' });
      scaleControlRef.current = control;
      const el = control.onAdd(map);
      scaleControlElRef.current = el;
      try {
        (el as any).style.transform = 'scale(1.05)';
        (el as any).style.transformOrigin = 'center bottom';

        const scaleEl = (el as any).querySelector?.('.maplibregl-ctrl-scale') as HTMLElement | null;
        if (scaleEl) {
          scaleEl.style.height = '16px';
          scaleEl.style.lineHeight = '16px';
          scaleEl.style.padding = '0 10px';
          scaleEl.style.fontSize = '10px';
        }
      } catch {
        // ignore
      }
      const host = document.getElementById('map-scale-container');
      if (host) {
        host.appendChild(el);
      } else {
        map.addControl(control, 'bottom-left');
      }
    } catch {
      // ignore
    }

    // Afficher la boussole uniquement quand la carte est orientée
    const updateRotated = () => {
      const bearing = map.getBearing?.() ?? 0;
      const pitch = map.getPitch?.() ?? 0;
      setIsMapRotated(Math.abs(bearing) > 0.5 || Math.abs(pitch) > 0.5);
    };
    map.on('rotate', updateRotated);
    map.on('pitch', updateRotated);
    map.on('load', updateRotated);

    return () => {
      map.off('rotate', updateRotated);
      map.off('pitch', updateRotated);
      map.off('load', updateRotated);

      try {
        const el = scaleControlElRef.current;
        if (el && el.parentElement) el.parentElement.removeChild(el);
        const ctrl = scaleControlRef.current;
        if (ctrl && (ctrl as any).onRemove) (ctrl as any).onRemove(map);
      } catch {
        // ignore
      }
      scaleControlElRef.current = null;
      scaleControlRef.current = null;

      map.remove();
      mapInstanceRef.current = null;
    };
  }, [currentBaseStyle]);

  // Keep scale visibility in sync with scaleEnabled
  useEffect(() => {
    const el = scaleControlElRef.current;
    if (!el) return;
    (el as HTMLElement).style.display = scaleEnabled ? '' : 'none';
  }, [scaleEnabled]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const onResize = () => {
      try {
        map.resize();
      } catch {
        // ignore
      }
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!currentBaseStyle) return;
    const c = map.getCenter();
    const fallbackView = { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    const view = lastViewRef.current ?? fallbackView;

    map.setStyle(currentBaseStyle);

    const onStyleData = () => {
      ensureOverlays(map);
      applyGridLabelStyle(map);
      resyncAllOverlays(map);
      applyMyDynamicPaint(map);
      try {
        map.jumpTo({ center: [view.lng, view.lat], zoom: view.zoom, bearing: view.bearing, pitch: view.pitch });
      } catch {
        // ignore
      }
    };

    map.once('styledata', onStyleData);

    return () => {
      map.off('styledata', onStyleData as any);
    };
  }, [currentBaseStyle, user?.id, memberColors]);

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
      lastViewRef.current = payload;
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

    const missionId = selectedMissionId;

    const socket = getSocket();
    socketRef.current = socket;

    const ensureJoined = () => {
      try {
        socket.emit('mission:join', { missionId });
      } catch {
        // ignore
      }
    };

    // Always (re)join on mount so we are in the right room (even if MissionLayout is not mounted).
    ensureJoined();

    const pendingKey = user?.id ? `geogn.pendingPos.${missionId}.${user.id}` : null;
    if (pendingKey) {
      try {
        const raw = localStorage.getItem(pendingKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            pendingBulkRef.current = parsed
              .filter((p) => p && typeof p.lng === 'number' && typeof p.lat === 'number' && typeof p.t === 'number')
              .slice(-5000);
          }
        }
      } catch {
        // ignore
      }
    }

    // Load pending actions (POI/Zone create/update/delete)
    try {
      const raw = localStorage.getItem(getPendingActionsKey(missionId));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          pendingActionsRef.current = parsed;
        }
      }
    } catch {
      // ignore
    }

    const persistPending = () => {
      if (!pendingKey) return;
      try {
        localStorage.setItem(pendingKey, JSON.stringify(pendingBulkRef.current.slice(-5000)));
      } catch {
        // ignore
      }
    };

    const flushPending = () => {
      const pts = pendingBulkRef.current;
      if (!pendingKey) return;
      if (!pts || pts.length === 0) return;
      if (!socket.connected) return;
      socket.emit('position:bulk', { points: pts }, (res: any) => {
        if (res && res.ok) {
          pendingBulkRef.current = [];
          persistPending();
        }
      });
    };

    const requestSnapshot = () => {
      try {
        socket.emit('mission:snapshot:request', { missionId });
      } catch {
        // ignore
      }
    };

    // Best effort: re-join + request fresh snapshot + flush buffered points on connect/reconnect.
    const onConnected = () => {
      ensureJoined();
      flushPending();
      void flushPendingActions(missionId);
      requestSnapshot();
    };
    socket.on('connect', onConnected);
    socket.on('reconnect', onConnected as any);
    setTimeout(onConnected, 300);

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (!socket.connected) return;
      ensureJoined();
      requestSnapshot();
      flushPending();
      void flushPendingActions(missionId);
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onOnline = () => {
      void flushPendingActions(missionId);
    };
    window.addEventListener('online', onOnline);

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

      const retentionSecondsFromSnapshot =
        typeof msg.retentionSeconds === 'number' && Number.isFinite(msg.retentionSeconds) ? msg.retentionSeconds : null;
      const retentionMsFromSnapshot = Math.max(
        0,
        (retentionSecondsFromSnapshot !== null ? retentionSecondsFromSnapshot * 1000 : traceRetentionMs)
      );
      const maxTracePointsFromSnapshot = Math.max(1, Math.ceil(retentionMsFromSnapshot / 1000) + 2);
      const cutoff = now - retentionMsFromSnapshot;

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
          .slice(-maxTracePointsFromSnapshot);
        if (filtered.length) {
          nextOthersTraces[userId] = filtered;
        }
      }

      otherTracesRef.current = nextOthersTraces;
      setOtherPositions(nextOthers);
    };

    const applyRemotePosition = (msg: any) => {
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

    const onPos = (msg: any) => {
      applyRemotePosition(msg);
    };

    const onPosBulk = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      if (!msg.userId) return;
      const pts = Array.isArray(msg.points) ? msg.points : [];
      for (const p of pts) {
        applyRemotePosition({ ...p, userId: msg.userId });
      }
    };

    socket.on('mission:snapshot', onSnapshot);
    socket.on('position:update', onPos);
    socket.on('position:bulk', onPosBulk);

    const onPosClear = (msg: any) => {
      if (!msg?.userId) return;
      if (msg?.missionId && msg.missionId !== selectedMissionId) return;
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

      socket.off('mission:snapshot', onSnapshot);
      socket.off('position:update', onPos);
      socket.off('position:bulk', onPosBulk);
      socket.off('position:clear', onPosClear);

      socket.off('poi:created', onPoiCreated);
      socket.off('poi:updated', onPoiUpdated);
      socket.off('poi:deleted', onPoiDeleted);

      socket.off('zone:created', onZoneCreated);
      socket.off('zone:updated', onZoneUpdated);
      socket.off('zone:deleted', onZoneDeleted);
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
          const payload = {
            lng,
            lat,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            accuracy: pos.coords.accuracy ?? undefined,
            t,
          };

          if (socket.connected) {
            socket.emit('position:update', payload);
          } else {
            pendingBulkRef.current = [...pendingBulkRef.current, payload].slice(-5000);
            if (selectedMissionId && user?.id) {
              const key = `geogn.pendingPos.${selectedMissionId}.${user.id}`;
              try {
                localStorage.setItem(key, JSON.stringify(pendingBulkRef.current));
              } catch {
                // ignore
              }
            }
          }
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

  // HTML markers for POIs (circles with inner icon).
  // We fully rebuild them whenever POIs, map readiness, icon options or base style change,
  // to avoid inconsistent DOM state after style changes.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const markers = poiMarkersRef.current;

    const applyMarkerContent = (el: HTMLDivElement, p: ApiPoi) => {
      const Icon = getPoiIconComponent(p.icon);
      const colorLower = (p.color || '').toLowerCase();
      const iconColor = colorLower === '#ffffff' || colorLower === '#fde047' ? '#000000' : '#ffffff';
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
        const tool = activeToolRef.current;
        if (tool === 'zone_circle' || tool === 'zone_polygon') return;
        setSelectedPoi(p);
      };
    };

    // Remove all existing markers and rebuild from scratch.
    for (const marker of markers.values()) {
      marker.remove();
    }
    markers.clear();

    for (const p of pois) {
      const el = document.createElement('div');
      applyMarkerContent(el, p);
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      markers.set(p.id, marker);
    }
  }, [pois, mapReady, poiIconOptions, currentBaseStyle]);

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
    const inactiveColor = '#9ca3af';
    const features = Object.entries(otherPositions).map(([userId, p]) => {
      const memberColor = memberColors[userId];
      const isInactive = now - p.t > inactiveAfterMs;
      // Inactif: gris plus clair. Sinon, couleur de mission.
      const color = isInactive ? inactiveColor : (memberColor ?? inactiveColor);
      const name = memberNames[userId] ?? '';

      return {
        type: 'Feature',
        properties: { userId, color, name, inactive: isInactive ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      };
    });

    src.setData({
      type: 'FeatureCollection',
      features: features as any,
    });
  }, [otherPositions, memberColors, memberNames, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('others-traces') as GeoJSONSource | undefined;
    if (!src) return;

    const now = Date.now();
    const inactiveAfterMs = 60_000;
    const inactiveColor = '#9ca3af';
    const features: any[] = [];
    for (const [userId, pts] of Object.entries(otherTracesRef.current)) {
      if (pts.length < 2) continue;
      const memberColor = memberColors[userId];
      const lastT = pts[pts.length - 1]?.t ?? 0;
      const isInactive = now - lastT > inactiveAfterMs;
      const color = isInactive ? inactiveColor : (memberColor ?? inactiveColor);

      features.push({
        type: 'Feature',
        properties: { userId, color, inactive: isInactive ? 1 : 0 },
        geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lng, p.lat]) },
      });
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
        const myColor = user?.id ? memberColors[user.id] : undefined;
        const myName = user?.id ? memberNames[user.id] : undefined;
        meSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [lastPos.lng, lastPos.lat] },
              properties: {
                color: myColor,
                name: myName,
              },
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
        traceSource.setData({
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: filtered.map((p) => [p.lng, p.lat]) },
              properties: {},
            },
          ],
        });
      } else {
        traceSource.setData({ type: 'FeatureCollection', features: [] });
      }
    };

    update();
  }, [lastPos, tracePoints, mapReady, traceRetentionMs, memberColors, memberNames, user?.id]);

  return (
    <div className="relative w-full h-screen">
      <div ref={mapRef} className="w-full h-full" />

      <div className="pointer-events-none fixed bottom-[calc(max(env(safe-area-inset-bottom),16px)+104px)] left-1/2 z-[1000] w-full -translate-x-1/2 max-w-md px-3 sm:max-w-lg md:max-w-xl">
        <div id="map-scale-container" className="pointer-events-auto flex w-full justify-center" />
      </div>

      {selectedPoi && (
        <div
          className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setSelectedPoi(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white shadow-xl flex items-start gap-3 px-4 py-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mt-0.5 flex-shrink-0 flex items-center justify-center">
              {(() => {
                const Icon = getPoiIconComponent(selectedPoi.icon);
                const bg = selectedPoi.color || '#f97316';
                const bgLower = bg.toLowerCase();
                const iconColor = bgLower === '#ffffff' || bgLower === '#fde047' ? '#000000' : '#ffffff';
                return (
                  <div className="h-9 w-9 rounded-full border-2 border-white shadow" style={{ backgroundColor: bg }}>
                    <div className="flex h-full w-full items-center justify-center">
                      <Icon size={16} color={iconColor} strokeWidth={2.5} />
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
              <div className="mt-0.5 text-[11px] text-gray-500">
                {(() => {
                  const id = selectedPoi.createdBy as string | undefined;
                  if (!id) return 'Créé par inconnu';
                  const name = memberNames[id] || id;
                  return `Créé par ${name}`;
                })()}
              </div>
            </div>
            <div className="ml-2 flex flex-col items-end gap-2 self-start">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNavPickerPoi(selectedPoi);
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                  title="Naviguer vers le point"
                >
                  <Navigation2 size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPoi(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-700 shadow-sm hover:bg-gray-50 hover:text-gray-900"
                  title="Fermer"
                >
                  <X size={14} />
                </button>
              </div>
              {canEdit ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPoi) return;
                      setEditingPoiId(selectedPoi.id);
                      setActiveTool('poi');
                      setDraftLngLat({ lng: selectedPoi.lng, lat: selectedPoi.lat });
                      setDraftTitle(selectedPoi.title || '');
                      setDraftComment((selectedPoi.comment || '').trim() === '-' ? '' : (selectedPoi.comment || ''));
                      setDraftColor(selectedPoi.color || '#f97316');
                      setDraftIcon(selectedPoi.icon || 'target');
                      setActionError(null);
                      setShowValidation(true);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                    title="Éditer le POI"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={async () => {
                      if (!selectedMissionId || !selectedPoi) return;
                      const ok = window.confirm('Supprimer ce POI ?');
                      if (!ok) return;
                      setActionBusy(true);
                      setActionError(null);
                      try {
                        await deletePoi(selectedMissionId, selectedPoi.id);
                        setPois((prev) => prev.filter((p) => p.id !== selectedPoi.id));
                        setSelectedPoi(null);
                      } catch (e: any) {
                        const offline = !navigator.onLine || !socketRef.current?.connected;
                        if (offline) {
                          setPois((prev) => prev.filter((p) => p.id !== selectedPoi.id));
                          enqueueAction(selectedMissionId, {
                            entity: 'poi',
                            op: 'delete',
                            id: selectedPoi.id,
                            t: Date.now(),
                          });
                          setSelectedPoi(null);
                        } else {
                          setActionError(e?.message ?? 'Erreur');
                        }
                      } finally {
                        setActionBusy(false);
                      }
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                    title="Supprimer le POI"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {navPickerPoi ? (
        <div
          className="absolute inset-0 z-[1200] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setNavPickerPoi(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 text-sm font-semibold text-gray-900">
              Selectionnez votre moyen de navigation
            </div>
            <div className="flex items-center justify-center gap-4 p-4">
              <button
                type="button"
                onClick={() => {
                  const waze = `https://waze.com/ul?ll=${navPickerPoi.lat}%2C${navPickerPoi.lng}&navigate=yes`;
                  window.open(waze, '_blank');
                  setNavPickerPoi(null);
                }}
                className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
                title="Waze"
              >
                <img src="/icon/waze.png" alt="Waze" className="h-12 w-12 object-contain" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const q = encodeURIComponent(`${navPickerPoi.lat},${navPickerPoi.lng}`);
                  const gmaps = `https://www.google.com/maps/search/?api=1&query=${q}`;
                  window.open(gmaps, '_blank');
                  setNavPickerPoi(null);
                }}
                className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
                title="Google Maps"
              >
                <img src="/icon/maps.png" alt="Google Maps" className="h-12 w-12 object-contain" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const label = encodeURIComponent(navPickerPoi.title || 'POI');
                  const apple = `http://maps.apple.com/?ll=${navPickerPoi.lat},${navPickerPoi.lng}&q=${label}`;
                  window.open(apple, '_blank');
                  setNavPickerPoi(null);
                }}
                className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
                title="Plans (Apple)"
              >
                <img src="/icon/apple.png" alt="Plans (Apple)" className="h-12 w-12 object-contain" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="fixed right-4 top-[calc(env(safe-area-inset-top)+16px)] z-[1000] flex flex-col gap-3 touch-none"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={centerOnMe}
          className="h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Centrer sur moi"
        >
          <Crosshair className="mx-auto text-gray-600" size={20} />
        </button>

        <button
          type="button"
          onClick={toggleMapStyle}
          className="h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Changer le fond de carte"
        >
          <Layers className="mx-auto text-gray-600" size={20} />
        </button>

        <button
          type="button"
          onClick={() => setScaleEnabled((v) => !v)}
          className={`h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur inline-flex items-center justify-center hover:bg-white ${
            scaleEnabled ? 'ring-1 ring-inset ring-blue-500/25' : ''
          }`}
          title="Afficher l'échelle"
        >
          <Ruler className={scaleEnabled ? 'mx-auto text-blue-600' : 'mx-auto text-gray-600'} size={20} />
        </button>

        <button
          type="button"
          onClick={() => setLabelsEnabled((v) => !v)}
          className={`h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur inline-flex items-center justify-center hover:bg-white ${
            labelsEnabled ? 'ring-1 ring-inset ring-blue-500/25' : ''
          }`}
          title="Afficher les noms (POI + zones + utilisateurs)"
        >
          <Tag
            className={`mx-auto ${
              labelsEnabled ? 'text-blue-600' : 'text-gray-600'
            }`}
            size={18}
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
                setDraftColor('');
                setDraftIcon('');
                setDraftComment('');
                setActiveTool('poi');
              }}
              className={`h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white ${
                activeTool === 'poi' ? 'ring-1 ring-inset ring-blue-500/25' : ''
              }`}
              title="Ajouter un POI"
            >
              <MapPin
                className={
                  activeTool === 'poi' ? 'mx-auto text-blue-600' : 'mx-auto text-gray-600'
                }
                size={20}
              />
            </button>

            <div
              className={`relative w-12 overflow-hidden rounded-2xl bg-white/0 shadow backdrop-blur p-px transition-all duration-200 ${
                zoneMenuOpen ? 'h-[160px] ring-1 ring-inset ring-black/10' : 'h-12 ring-0'
              }`}
            >
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setActionError(null);

                    if (activeTool === 'zone_circle' || activeTool === 'zone_polygon') {
                      cancelDraft();
                      setZoneMenuOpen(false);
                      return;
                    }

                    setZoneMenuOpen((v) => !v);
                  }}
                  className={`h-12 w-12 rounded-2xl border bg-white/90 inline-flex items-center justify-center transition-colors hover:bg-white ${
                    zoneMenuOpen || activeTool === 'zone_circle' || activeTool === 'zone_polygon'
                      ? 'ring-1 ring-inset ring-blue-500/25'
                      : ''
                  }`}
                  title="Zones"
                >
                  <CircleDotDashed
                    className={
                      zoneMenuOpen || activeTool === 'zone_circle' || activeTool === 'zone_polygon'
                        ? 'mx-auto text-blue-600'
                        : 'mx-auto text-gray-600'
                    }
                    size={20}
                  />
                </button>

                <div
                  className={`flex flex-col gap-2 transition-all duration-200 ${
                    zoneMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTool === 'zone_circle') {
                        cancelDraft();
                        setZoneMenuOpen(false);
                        return;
                      }
                      cancelDraft();
                      setDraftColor('#2563eb');
                      setActiveTool('zone_circle');
                    }}
                    className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                      activeTool === 'zone_circle' ? 'ring-blue-500/25' : 'ring-black/10'
                    }`}
                    title="Zone cercle"
                  >
                    <CircleDot className={activeTool === 'zone_circle' ? 'text-blue-600' : 'text-gray-600'} size={20} />
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
                      setDraftColor('#2563eb');
                      setActiveTool('zone_polygon');
                    }}
                    className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                      activeTool === 'zone_polygon' ? 'ring-blue-500/25' : 'ring-black/10'
                    }`}
                    title="Zone à la main"
                  >
                    <Spline className={activeTool === 'zone_polygon' ? 'text-blue-600' : 'text-gray-600'} size={20} />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {isAdmin ? (
          <button
            type="button"
            onClick={() => {
              const rs = mission?.traceRetentionSeconds ?? 3600;
              setTimerSecondsInput(String(rs));
              setTimerError(null);
              setTimerModalOpen(true);
            }}
            className="h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur inline-flex items-center justify-center hover:bg-white"
            title="Durée de la piste"
          >
            <Timer className="mx-auto text-gray-600" size={20} />
          </button>
        ) : null}

        {isMapRotated ? (
          <button
            type="button"
            onClick={resetNorth}
            className="h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
            title="Boussole"
          >
            <Compass className="mx-auto text-gray-600" size={20} />
          </button>
        ) : null}
      </div>

      {timerModalOpen ? (
        <div className="absolute inset-0 z-[1300] flex items-center justify-center bg-black/30 px-4 pt-6 pb-28">
          <div className="w-full max-w-sm rounded-3xl bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="text-base font-bold text-gray-900">Durée de la piste</div>
              <button
                type="button"
                onClick={() => setTimerModalOpen(false)}
                className="h-10 w-10 rounded-2xl border bg-white"
              >
                <X className="mx-auto" size={18} />
              </button>
            </div>

            <div className="mt-3 grid gap-3">
              <div className="text-xs font-semibold text-gray-700">Durée (secondes)</div>
              <div className="text-[11px] text-gray-600">
                Ceci règle combien de temps la trace reste visible avant de commencer à s'effacer.
              </div>

              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                {[{ label: "10'", value: 600 }, { label: "20'", value: 1200 }, { label: "30'", value: 1800 }, { label: '1h', value: 3600 }, { label: '2h', value: 7200 }].map(
                  (p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setTimerSecondsInput(String(p.value))}
                      className="h-8 rounded-2xl border bg-white px-3 text-xs font-semibold text-gray-800 hover:bg-gray-50"
                    >
                      {p.label}
                    </button>
                  )
                )}
              </div>

              <div className="mt-1 flex items-center justify-center gap-3">
                <input
                  type="text"
                  inputMode="numeric"
                  value={timerSecondsInput}
                  onChange={(e) => setTimerSecondsInput(e.target.value)}
                  className="h-10 w-24 rounded-2xl border px-3 text-sm text-center"
                />
                {(() => {
                  const trimmed = timerSecondsInput.trim();
                  const parsed = trimmed ? Number(trimmed) : NaN;
                  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) return null;
                  const total = Math.floor(parsed);
                  const h = Math.floor(total / 3600);
                  const m = Math.floor((total % 3600) / 60);
                  const s = total % 60;
                  const parts: string[] = [];
                  if (h > 0) parts.push(`${h} h`);
                  if (h > 0 || m > 0) parts.push(`${m} min`);
                  parts.push(`${s} s`);
                  return <div className="text-sm font-medium text-gray-700">{parts.join(' ')}</div>;
                })()}
              </div>

              {timerError ? <div className="text-sm text-red-600">{timerError}</div> : null}

              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setTimerModalOpen(false)}
                  className="h-11 rounded-2xl border bg-white text-sm font-semibold text-gray-700"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={timerSaving}
                  onClick={() => void onSaveTraceRetentionSeconds()}
                  className="h-11 rounded-2xl bg-blue-600 text-sm font-semibold text-white shadow disabled:opacity-50"
                >
                  Valider
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showValidation ? (
        <div className="absolute inset-0 z-[1200] flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-xl max-h-[calc(100vh-32px)] flex flex-col">
            <div className="px-4 pt-3 pb-2 flex items-center justify-between">
              <div className="text-base font-bold text-gray-900">Validation</div>
              <button type="button" onClick={cancelDraft} className="h-10 w-10 rounded-2xl border bg-white">
                <X className="mx-auto" size={18} />
              </button>
            </div>

            <div className="px-4 pt-1 pb-4 overflow-y-auto">
              <div className="grid gap-2">
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
                          className={`h-7 w-7 rounded-xl border ${draftColor === c ? 'ring-2 ring-blue-500' : ''}`}
                          style={{
                            backgroundColor: c,
                            backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))',
                            borderColor: c.toLowerCase() === '#ffffff' ? '#9ca3af' : 'rgba(0,0,0,0.12)',
                          }}
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
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border ${
                            draftIcon === id ? 'ring-2 ring-blue-500' : ''
                          }`}
                          style={{
                            backgroundColor: draftColor || '#ffffff',
                            backgroundImage:
                              'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))',
                            borderColor:
                              (draftColor || '#ffffff').toLowerCase() === '#ffffff'
                                ? '#9ca3af'
                                : 'rgba(0,0,0,0.12)',
                          }}
                          aria-label={id}
                        >
                          {(() => {
                            const colorLower = (draftColor || '#ffffff').toLowerCase();
                            const iconColor =
                              colorLower === '#ffffff' || colorLower === '#fde047' ? '#000000' : '#ffffff';
                            return <Icon size={18} color={iconColor} />;
                          })()}
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

              {activeTool === 'zone_circle' || activeTool === 'zone_polygon' ? (
                <input
                  value={draftComment}
                  onChange={(e) => setDraftComment(e.target.value)}
                  placeholder="Commentaire"
                  className="h-11 w-full rounded-2xl border px-3 text-sm"
                />
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
                        style={{
                          backgroundColor: c,
                          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))',
                          borderColor: c.toLowerCase() === '#ffffff' ? '#9ca3af' : 'rgba(0,0,0,0.12)',
                        }}
                        aria-label={c}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {actionError ? <div className="text-sm text-red-600">{actionError}</div> : null}
              </div>
            </div>

            <div className="p-4 pt-0">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => void submitDraft()}
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

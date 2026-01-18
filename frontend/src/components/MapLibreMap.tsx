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
  ChevronDown,
  ChevronUp,
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
  Loader2,
  MapPin,
  Mic,
  Navigation2,
  PawPrint,
  Pencil,
  Radiation,
  Ruler,
  Settings,
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
  deletePersonCase,
  deleteZone,
  getPersonCase,
  getMission,
  listPois,
  listMissionMembers,
  listZones,
  upsertPersonCase,
  updatePoi,
  updateZone,
  updateMission,
  createVehicleTrack,
  listVehicleTracks,
  deleteVehicleTrack,
  getVehicleTrackState,
  type ApiMission,
  type ApiPoi,
  type ApiPersonCase,
  type ApiZone,
  type ApiVehicleTrack,
  type ApiVehicleTrackStatus,
  type ApiVehicleTrackVehicleType,
} from '../lib/api';
import { useConfirmDialog } from './ConfirmDialog';
import {
  DiseaseId,
  InjuryId,
  SimpleWeather,
  clamp,
  cleanDiseases,
  cleanInjuries,
  computeAgeFactor,
  computeDiseaseFactor,
  computeEffectiveWalkingKmh,
  computeHealthStatusFactor,
  computeIsNight,
  computeLocomotorInjuryFactor,
  computeNightFactor,
  computeWeatherFactor,
  isLocomotorLocation,
} from '../lib/estimationWalking';

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

function weatherStatusLabel(code: number | null | undefined) {
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

function formatHoursToHM(hours: number) {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m} min`;
  if (m <= 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function formatElapsedSince(iso: string | null | undefined): string {
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

function cloneStyle<T>(style: T): T {
  try {
    return (globalThis as any).structuredClone(style);
  } catch {
    return JSON.parse(JSON.stringify(style)) as T;
  }
}

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

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
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function buildCorridorEllipseRing(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
  options?: { baseWidthKm?: number; dispersionScaleKm?: number }
): number[][] | null {
  const latMid = (a.lat + b.lat) / 2;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const kmPerDegLat = 111.32;
  const kmPerDegLon = kmPerDegLat * Math.cos(toRad(latMid));
  if (!Number.isFinite(kmPerDegLon) || kmPerDegLon <= 0) return null;

  const ax = a.lng * kmPerDegLon;
  const ay = a.lat * kmPerDegLat;
  const bx = b.lng * kmPerDegLon;
  const by = b.lat * kmPerDegLat;

  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;

  const dx = bx - ax;
  const dy = by - ay;
  const dKm = Math.sqrt(dx * dx + dy * dy);
  if (!Number.isFinite(dKm) || dKm < 0.05) return null; // < 50 m → pas de couloir

  const longitudinalFactor = 1.3;
  const aKm = (dKm / 2) * longitudinalFactor;

  const baseWidthKm = options?.baseWidthKm ?? 0.3;
  const dispersionScaleKm = options?.dispersionScaleKm ?? 0.7;
  const kDisp = 1; // placeholder simple pour v1
  let bKm = Math.max(dKm * 0.2, baseWidthKm + (kDisp - 1) * dispersionScaleKm);
  bKm = Math.max(0.2, Math.min(5, bKm));

  const bearing = Math.atan2(dx, dy); // axe majeur orienté A→B
  const cosB = Math.cos(bearing);
  const sinB = Math.sin(bearing);

  const steps = 64;
  const ring: number[][] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (2 * Math.PI * i) / steps;
    const xLocal = aKm * Math.cos(t);
    const yLocal = bKm * Math.sin(t);
    const x = cx + xLocal * cosB - yLocal * sinB;
    const y = cy + xLocal * sinB + yLocal * cosB;
    const lng = x / kmPerDegLon;
    const lat = y / kmPerDegLat;
    ring.push([lng, lat]);
  }
  if (ring.length) ring.push(ring[0]);
  return ring;
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
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirmDialog();
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const lastSnapshotAtRef = useRef<number>(0);
  const lastHiddenAtRef = useRef<number | null>(null);
  const pendingBulkRef = useRef<{
    lng: number;
    lat: number;
    t: number;
    speed?: number;
    heading?: number;
    accuracy?: number;
  }[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const flushDelayRef = useRef<number>(1000);
  const lastPersistTsRef = useRef<number>(0);
  const activeMissionRef = useRef<string | null>(null);
  const wasSocketConnectedRef = useRef<boolean>(false);
  const pendingActionsRef = useRef<any[]>([]);

  const persistPendingPositions = (missionId: string, userId: string) => {
    const now = Date.now();
    if (now - lastPersistTsRef.current < 2000) return;
    lastPersistTsRef.current = now;
    const key = `geogn.pendingPos.${missionId}.${userId}`;
    try {
      localStorage.setItem(key, JSON.stringify(pendingBulkRef.current.slice(-5000)));
    } catch {
      // ignore
    }
  };

  const scaleControlRef = useRef<maplibregl.ScaleControl | null>(null);
  const scaleControlElRef = useRef<HTMLElement | null>(null);

  const poiMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const polygonDraftRef = useRef<[number, number][]>([]);

  const otherColorsRef = useRef<Record<string, string>>({});
  const otherTracesRef = useRef<Record<string, { lng: number; lat: number; t: number }[]>>({});

  const [memberColors, setMemberColors] = useState<Record<string, string>>({});
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});

  const [othersActivityTick, setOthersActivityTick] = useState(0);

  function getUserDisplayName(userId: string | null | undefined): string {
    if (!userId) return 'Inconnu';

    // Si c'est l'utilisateur courant, toujours préférer son displayName
    if (user?.id && userId === user.id) {
      if (user.displayName && user.displayName.trim()) {
        return user.displayName.trim();
      }
    }

    const fromMembers = memberNames[userId];
    if (fromMembers && fromMembers.trim()) {
      return fromMembers.trim();
    }

    return userId;
  }

  function buildUserDisplayName(userId: string | null | undefined): string {
    if (!userId) return 'Inconnu';

    // Si c'est l'utilisateur courant, préférer user.displayName
    if (user?.id && userId === user.id && user.displayName && user.displayName.trim()) {
      return user.displayName.trim();
    }

    // Sinon, utiliser le nom depuis les membres de mission si disponible
    const memberName = memberNames[userId];
    if (memberName && memberName.trim()) {
      return memberName.trim();
    }

    // Fallback sur le helper existant
    return getUserDisplayName(userId);
  }

  const [followMyBearing, setFollowMyBearing] = useState(false);
  const centerOnMeNextActionRef = useRef<'center' | 'follow'>('center');
  const lastHeadingRef = useRef<number | null>(null);

  const [lastPos, setLastPos] = useState<{ lng: number; lat: number } | null>(null);
  const [tracePoints, setTracePoints] = useState<{ lng: number; lat: number; t: number }[]>([]);
  const [otherPositions, setOtherPositions] = useState<Record<string, { lng: number; lat: number; t: number }>>({});
  const [pois, setPois] = useState<ApiPoi[]>([]);
  const [selectedPoi, setSelectedPoi] = useState<ApiPoi | null>(null);
  const [navPickerTarget, setNavPickerTarget] = useState<{ lng: number; lat: number; title: string } | null>(null);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [hiddenUserIds, setHiddenUserIds] = useState<Record<string, true>>({});
  // Compteur de version du style de carte pour forcer la resynchro des overlays (dont la zone d'estimation)
  const [styleVersion, setStyleVersion] = useState(0);

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

  useEffect(() => {
    if (!navPickerTarget) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavPickerTarget(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navPickerTarget]);

  const isAndroid = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /android/i.test(navigator.userAgent);
  }, []);

  const [editingPoiId, setEditingPoiId] = useState<string | null>(null);

  const [baseStyleIndex, setBaseStyleIndex] = useState(0);

  const [trackingEnabled] = useState(true);

  const [zoneMenuOpen, setZoneMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

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
  const [scaleEnabled, setScaleEnabled] = useState(false);

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

      try {
        const { tracks } = await listVehicleTracks(selectedMissionId, {
          limit: 200,
          offset: 0,
        });
        for (const t of tracks) {
          try {
            await deleteVehicleTrack(selectedMissionId, t.id);
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
      setPersonCase(null);
      setPersonEdit(true);
      setPersonDraft({
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
      });
      setShowEstimationHeatmap(false);
      const map = mapInstanceRef.current;
      if (map && mapReady) applyHeatmapVisibility(map, false);
    } catch (e: any) {
      setPersonError(e?.message ?? 'Erreur');
    } finally {
      setPersonLoading(false);
    }
  };
  const [personDraft, setPersonDraft] = useState<{
    lastKnownQuery: string;
    lastKnownType: 'address' | 'poi';
    lastKnownPoiId?: string;
    lastKnownLng?: number;
    lastKnownLat?: number;
    lastKnownWhen: string;
    mobility: 'none' | 'bike' | 'scooter' | 'motorcycle' | 'car';
    age: string;
    sex: 'unknown' | 'female' | 'male';
    healthStatus: 'stable' | 'fragile' | 'critique';
    diseases: string[];
    diseasesFreeText: string;
    injuries: { id: string; locations: string[] }[];
    injuriesFreeText: string;
  }>({
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
  });

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
        'autre',
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
  const [weather, setWeather] = useState<
    | {
        temperatureC: number | null;
        windSpeedKmh: number | null;
        precipitationMm: number | null;
        weatherCode: number | null;
        when: string;
        source: string;
      }
    | null
  >(null);
  // Ancien toggle de heatmap conservé uniquement pour compatibilité, mais la visibilité
  // est désormais pilotée uniquement par l'état de suivi (panneau activité ouvert + fiche existante).
  const [showEstimationHeatmap, setShowEstimationHeatmap] = useState<boolean>(true);
  const showEstimationHeatmapRef = useRef(true);
  const personPanelOpenRef = useRef(false);
  const lastKnownWhenInputRef = useRef<HTMLInputElement | null>(null);
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

  const clearVehicleTrackVisual = (reason: string) => {
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

    try {
      // eslint-disable-next-line no-console
      console.log('[vehicle-track]', ts(), 'visual cleared', { reason });
    } catch {
      // ignore
    }
  };

  const [vehicleTracks, setVehicleTracks] = useState<ApiVehicleTrack[]>([]);
  const [vehicleTracksTotal, setVehicleTracksTotal] = useState(0);
  // Indique si la liste des pistes véhicule a déjà été chargée au moins une fois
  // pour la mission courante durant cette session.
  const [vehicleTracksLoaded, setVehicleTracksLoaded] = useState(false);
  const [vehicleTracksQuery, setVehicleTracksQuery] = useState<{
    status?: ApiVehicleTrackStatus;
    vehicleType?: ApiVehicleTrackVehicleType;
    q: string;
    limit: number;
    offset: number;
  }>({ status: undefined, vehicleType: undefined, q: '', limit: 20, offset: 0 });

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
  }, [showActiveVehicleTrack, mapReady]);

  useEffect(() => {
    activeVehicleTrackIdRef.current = activeVehicleTrackId;
  }, [activeVehicleTrackId]);

  useEffect(() => {
    vehicleTrackGeojsonByIdRef.current = vehicleTrackGeojsonById;
  }, [vehicleTrackGeojsonById]);

  const isTestTrack = (track: ApiVehicleTrack | null | undefined): boolean => {
    if (!track) return false;
    if (track.algorithm === 'road_graph') return true;
    return !!track.label && /TEST/i.test(track.label);
  };

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

  // road_graph est désactivé pour l'instant : on ne montre plus le bandeau de chargement.
  const roadGraphWarmingUp = false;

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
    if (normalizeMobility(personDraft.mobility as any) === 'none') return;
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

      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
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

  type EstimationResult = {
    hoursSince: number | null;
    effectiveKmh: number;
    probableKm: number;
    maxKm: number;
    risk: number;
    needs: string[];
    likelyPlaces: string[];
    reasoning: string[];
  };

  const estimation = useMemo<EstimationResult | null>(() => {
    if (!personCase) return null;

    const now = estimationNowMs;
    const whenMs = personCase.lastKnown.when ? new Date(personCase.lastKnown.when).getTime() : NaN;
    const hoursSince = Number.isFinite(whenMs) ? Math.max(0, (now - whenMs) / 36e5) : null;

    const mobilityBaseKmh = (() => {
      switch (personCase.mobility) {
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

    const walkingKmh = computeEffectiveWalkingKmh(
      personCase.mobility,
      personCase.age,
      personCase.healthStatus as any,
      personCase.diseases,
      personCase.injuries,
      weather as SimpleWeather | null,
      personCase.lastKnown.when
    );

    const ageFactor = computeAgeFactor(personCase.age);
    const healthFactor = computeHealthStatusFactor(personCase.healthStatus as any);
    const isNight = computeIsNight(personCase.lastKnown.when);
    const hasDeshydratation = cleanInj.some((inj) => inj.id === 'deshydratation');
    const hasLocomotor = cleanInj.some((inj) => inj.locations.some((loc) => isLocomotorLocation(loc)));
    const diseaseFactor = computeDiseaseFactor(personCase.diseases, weather as SimpleWeather | null);
    const weatherFactor = computeWeatherFactor(weather as SimpleWeather | null, isNight, hasDeshydratation);
    const nightFactor = computeNightFactor(isNight, weather as SimpleWeather | null, hasLocomotor);
    const terrainFactor = 1;

    const rawKmh = (() => {
      if (personCase.mobility === 'none') {
        if (walkingKmh !== null) return walkingKmh;
        const base = 4.5;
        return (
          base *
          ageFactor *
          healthFactor *
          computeLocomotorInjuryFactor(cleanInj) *
          diseaseFactor *
          weatherFactor *
          nightFactor *
          terrainFactor
        );
      }

      return (
        mobilityBaseKmh *
        ageFactor *
        healthFactor *
        diseaseFactor *
        weatherFactor *
        nightFactor *
        terrainFactor
      );
    })();

    const clampedKmh = (() => {
      const v = rawKmh;
      if (personCase.mobility === 'bike') {
        return clamp(v, 2, 25);
      }
      if (
        personCase.mobility === 'car' ||
        personCase.mobility === 'motorcycle' ||
        personCase.mobility === 'scooter'
      ) {
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

    const probableKm = d50Km;
    const maxKm = d50Km * kDisp;

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
      )}% x santé ${(healthFactor * 100).toFixed(0)}% x blessures locomotrices ${(computeLocomotorInjuryFactor(
        cleanInj
      ) * 100).toFixed(0)}% x pathologies ${(diseaseFactor * 100).toFixed(
        0
      )}% x météo+nuit ${(
        computeWeatherFactor(weather as SimpleWeather | null, isNight, hasDeshydratation) *
        computeNightFactor(isNight, weather as SimpleWeather | null, hasLocomotor) *
        100
      ).toFixed(0)}% → ~${clampedKmh.toFixed(1)} km/h.`
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
    const hasSecondClue =
      false;
    if (
      personCase.mobility === 'car' ||
      personCase.mobility === 'motorcycle' ||
      personCase.mobility === 'scooter'
    ) {
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
  }, [
    personCase,
    weather,
    estimationNowMs,
  ]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const src = map.getSource('person-estimation') as GeoJSONSource | undefined;
    if (!src) return;

    const est = estimation;

    // Règle métier :
    // - Afficher le disque d'estimation si la mobilité est piétonne;
    // - OU si un suivi véhicule non-TEST est actif;
    // - Ne jamais l'afficher pour une piste TEST seule.
    const isPedestrian = (personCase?.mobility ?? 'none') === 'none';
    const hasActiveNonTestVehicle = !!(activeVehicleTrack && !isTestTrack(activeVehicleTrack));

    if (!est || !personCase || (!isPedestrian && !hasActiveNonTestVehicle)) {
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

    const inner = Math.max(0, estimation.probableKm || 0);
    const outer = Math.max(inner, estimation.maxKm || 0);

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
  }, [mapReady, personCase, estimation, styleVersion]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const src = map.getSource('person-estimation-corridor') as GeoJSONSource | undefined;
    if (!src) return;

    src.setData({ type: 'FeatureCollection', features: [] } as any);
  }, [mapReady, personCase?.lastKnown?.lng, personCase?.lastKnown?.lat]);

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

  const [mission, setMission] = useState<ApiMission | null>(null);

  function normalizeRemoteTime(t: any, now: number) {
    // Certains clients / caches peuvent fournir des timestamps en secondes.
    // Et certains appareils peuvent avoir une horloge très décalée.
    // On normalise pour éviter de marquer tout le monde "inactif" à tort.
    if (typeof t !== 'number' || !Number.isFinite(t)) return now;
    let v = t;
    // seconds -> ms
    if (v > 0 && v < 10_000_000_000) v = v * 1000;
    // future timestamps (clock skew) -> clamp to now
    if (v > now + 5 * 60_000) return now;
    return v;
  }

  useEffect(() => {
    if (!selectedMissionId) {
      setHiddenUserIds({});
      return;
    }
    try {
      const raw = window.localStorage.getItem(`geogn.hiddenMembers.${selectedMissionId}`);
      const parsed = raw ? (JSON.parse(raw) as any) : [];
      const ids = Array.isArray(parsed) ? (parsed.filter((x) => typeof x === 'string' && x.trim()) as string[]) : [];
      const map: Record<string, true> = {};
      for (const id of ids) map[id] = true;
      setHiddenUserIds(map);
    } catch {
      setHiddenUserIds({});
    }
  }, [selectedMissionId]);

  useEffect(() => {
    const onHiddenChanged = (e: Event) => {
      const ce = e as CustomEvent<any>;
      const missionId = ce?.detail?.missionId;
      if (!missionId || !selectedMissionId || missionId !== selectedMissionId) return;
      const list = Array.isArray(ce?.detail?.hiddenUserIds) ? (ce.detail.hiddenUserIds as any[]) : [];
      const map: Record<string, true> = {};
      for (const id of list) {
        if (typeof id === 'string' && id.trim()) map[id] = true;
      }
      setHiddenUserIds(map);
    };
    window.addEventListener('geogn:hiddenMembers:changed', onHiddenChanged as any);
    return () => {
      window.removeEventListener('geogn:hiddenMembers:changed', onHiddenChanged as any);
    };
  }, [selectedMissionId]);

  // Rôles
  const role = mission?.membership?.role ?? null; // 'admin' | 'member' | 'viewer' | null
  const isAdmin = role === 'admin';
  const canEditMap = role === 'admin' || role === 'member'; // zones / POI
  const canEditPerson = isAdmin; // fiche personne / projection

  // Notifications projection (pour utilisateurs / visualisateurs)
  const [projectionNotification, setProjectionNotification] = useState(false);
  const [settingsNotification, setSettingsNotification] = useState(false);
  const lastNotifiedPersonCaseIdRef = useRef<string | null>(null);

  function dismissedPersonCaseStorageKey(missionId: string) {
    return `dismissed_person_case_${missionId}`;
  }

  function getDismissedPersonCaseId(missionId: string): string | null {
    try {
      if (typeof window === 'undefined') return null;
      return window.localStorage.getItem(dismissedPersonCaseStorageKey(missionId));
    } catch {
      return null;
    }
  }

  function setDismissedPersonCaseId(missionId: string, caseId: string) {
    try {
      if (typeof window === 'undefined') return;
      window.localStorage.setItem(dismissedPersonCaseStorageKey(missionId), caseId);
    } catch {
      // ignore
    }
  }

  const mobilityLabel = (m: ApiPersonCase['mobility']) => {
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
      default:
        return 'Inconnu';
    }
  };

  type MobilityUi = ApiPersonCase['mobility'] | 'car_test' | 'motorcycle_test' | 'scooter_test' | 'truck_test' | 'bike_test';

  const normalizeMobility = (m: MobilityUi): ApiPersonCase['mobility'] => {
    if (m === 'car_test') return 'car';
    if (m === 'motorcycle_test') return 'motorcycle';
    if (m === 'scooter_test') return 'scooter';
    if (m === 'truck_test') return 'car';
    if (m === 'bike_test') return 'bike';
    return m;
  };

  const isMobilityTest = (m: MobilityUi): boolean =>
    m === 'car_test' || m === 'motorcycle_test' || m === 'scooter_test' || m === 'truck_test' || m === 'bike_test';

  const sexLabel = (s: ApiPersonCase['sex']) => {
    if (s === 'female') return 'Femme';
    if (s === 'male') return 'Homme';
    return 'Inconnu';
  };

  // Lorsqu'une fiche apparaît pour la mission, déclencher une notification pour les non-admin
  useEffect(() => {
    if (!personCase) {
      lastNotifiedPersonCaseIdRef.current = null;
      setProjectionNotification(false);
      return;
    }

    if (user?.id && personCase.createdBy === user.id) {
      lastNotifiedPersonCaseIdRef.current = personCase.id;
      setProjectionNotification(false);
      return;
    }

    if (selectedMissionId) {
      const dismissed = getDismissedPersonCaseId(selectedMissionId);
      if (dismissed === personCase.id) return;
    }

    if (lastNotifiedPersonCaseIdRef.current === personCase.id) return;
    lastNotifiedPersonCaseIdRef.current = personCase.id;
    setProjectionNotification(true);
    // Toujours signaler aussi sur l'icône paramètres, quel que soit le rôle,
    // pour révéler plus facilement l'icône paw depuis le menu.
    setSettingsNotification(true);
  }, [personCase, isAdmin, selectedMissionId, user?.id]);

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
  }, [selectedMissionId, mission?.id, personPanelOpen, personEdit]);

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
        const { tracks, total } = await listVehicleTracks(missionIdAtCall, vehicleTracksQuery);
        if (cancelled) return;

        setVehicleTracksLoaded(true);
        const filtered = filterAllowedVehicleTracks(tracks);
        setVehicleTracks(filtered);
        setVehicleTracksTotal(filtered.length);

        // Si la mission n'a plus aucune piste, on nettoie complètement l'état
        // associé aux suivis pour éviter qu'une géométrie ancienne reste
        // accrochée dans la carte ou dans la mémoire React.
        if (!filtered.length) {
          if (activeVehicleTrackId) {
            setActiveVehicleTrackId(null);
          }
          if (Object.keys(vehicleTrackGeojsonById).length > 0) {
            setVehicleTrackGeojsonById({});
          }
          return;
        }

        const currentId = activeVehicleTrackId;
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
          if (activeVehicleTrackId) {
            setActiveVehicleTrackId(null);
          }
        } else {
          if (nextActiveId !== activeVehicleTrackId) {
            setActiveVehicleTrackId(nextActiveId);
          }

          if (!vehicleTrackGeojsonById[nextActiveId]) {
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
  }, [
    selectedMissionId,
    vehicleTracksQuery.status,
    vehicleTracksQuery.vehicleType,
    vehicleTracksQuery.q,
    vehicleTracksQuery.limit,
    vehicleTracksQuery.offset,
    activeVehicleTrackId,
    vehicleTrackGeojsonById,
  ]);

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
              };
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

  const mapViewKey = selectedMissionId ? `geotacops.mapView.${selectedMissionId}` : null;

  const tracesLoadedRef = useRef(false);
  const prevTrackingRef = useRef<boolean | null>(null);
  const tracePointsRef = useRef(tracePoints);
  const autoCenterMissionIdRef = useRef<string | null>(null);
  const autoCenterDoneRef = useRef(false);

  const [timerModalOpen, setTimerModalOpen] = useState(false);
  const [timerSecondsInput, setTimerSecondsInput] = useState('');
  const [timerSaving, setTimerSaving] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);

  const nowLocalMinute = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);

  // Toast discret pour informer qu'aucune projection n'est active
  const [noProjectionToast, setNoProjectionToast] = useState(false);

  const [activityToast, setActivityToast] = useState<string | null>(null);
  const [activityToastVisible, setActivityToastVisible] = useState(false);
  const activityToastTimerRef = useRef<number | null>(null);
  const activityToastHideRef = useRef<number | null>(null);

  const [historyWindowSeconds, setHistoryWindowSeconds] = useState(1800);
  const historyWindowUserSetRef = useRef(false);

  useEffect(() => {
    historyWindowUserSetRef.current = false;
    setHistoryWindowSeconds(1800);
  }, [selectedMissionId]);

  useEffect(() => {
    if (!selectedMissionId) return;
    if (historyWindowUserSetRef.current) return;
    const s = mission?.traceRetentionSeconds;
    const sec = typeof s === 'number' && Number.isFinite(s) ? Math.max(0, Math.floor(s)) : null;
    if (sec === null) return;
    const capped = Math.min(3600, sec);
    if (capped > 0) setHistoryWindowSeconds(capped);
  }, [selectedMissionId, mission?.traceRetentionSeconds]);

  useEffect(() => {
    if (!noProjectionToast) return;
    const t = window.setTimeout(() => {
      setNoProjectionToast(false);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [noProjectionToast]);

  useEffect(() => {
    if (!activityToast) {
      setActivityToastVisible(false);
      return;
    }

    // Afficher immédiatement avec fade-in
    setActivityToastVisible(true);

    // Réinitialiser les timers existants
    if (activityToastTimerRef.current !== null) {
      window.clearTimeout(activityToastTimerRef.current);
      activityToastTimerRef.current = null;
    }
    if (activityToastHideRef.current !== null) {
      window.clearTimeout(activityToastHideRef.current);
      activityToastHideRef.current = null;
    }

    // Après 4s, lancer le fade-out puis nettoyer le message
    activityToastTimerRef.current = window.setTimeout(() => {
      setActivityToastVisible(false);
      activityToastTimerRef.current = null;

      activityToastHideRef.current = window.setTimeout(() => {
        setActivityToast(null);
        activityToastHideRef.current = null;
      }, 300);
    }, 4000);

    return () => {
      if (activityToastTimerRef.current !== null) {
        window.clearTimeout(activityToastTimerRef.current);
        activityToastTimerRef.current = null;
      }
      if (activityToastHideRef.current !== null) {
        window.clearTimeout(activityToastHideRef.current);
        activityToastHideRef.current = null;
      }
    };
  }, [activityToast]);

  const [isMapRotated, setIsMapRotated] = useState(false);

  const traceRetentionMs = useMemo(() => {
    const s = mission?.traceRetentionSeconds;
    const seconds = typeof s === 'number' && Number.isFinite(s) ? s : 3600;
    return Math.max(0, seconds) * 1000;
  }, [mission?.traceRetentionSeconds]);

  useEffect(() => {
    tracePointsRef.current = tracePoints;
  }, [tracePoints]);

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

    setTracePoints((prevPts) => {
      const next = prevPts.filter((p) => p.t >= cutoff);
      return next;
    });

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
      const prevRetentionForEvent = typeof mission?.traceRetentionSeconds === 'number' ? mission.traceRetentionSeconds : null;
      const trimmed = timerSecondsInput.trim();
      const parsed = trimmed ? Number(trimmed) : NaN;
      if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
        setTimerError('Durée invalide');
        return;
      }
      const nextRetention = Math.max(0, Math.floor(parsed));
      const updated = await updateMission(selectedMissionId, { traceRetentionSeconds: nextRetention });
      const merged = { ...(mission ?? {}), ...(updated ?? {}) } as any;
      setMission(merged);

      // Garder la fenêtre snapshot alignée sur la rétention mission.
      // (Sinon un snapshot demandé avec 1800s peut "rétrécir" la trace localement.)
      historyWindowUserSetRef.current = false;
      const nextWindowSeconds = Math.min(3600, Math.max(0, nextRetention));
      if (nextWindowSeconds > 0) {
        setHistoryWindowSeconds(nextWindowSeconds);
        const socket = socketRef.current;
        if (socket) {
          try {
            socket.emit('mission:join', { missionId: selectedMissionId, retentionSeconds: nextWindowSeconds });
          } catch {
            // ignore
          }
          try {
            socket.emit('mission:snapshot:request', { missionId: selectedMissionId });
          } catch {
            // ignore
          }
        }
      }

      setTimerModalOpen(false);
      try {
        window.dispatchEvent(
          new CustomEvent('geotacops:mission:updated', {
            detail: {
              mission: merged,
              prevTraceRetentionSeconds: prevRetentionForEvent,
              traceRetentionSeconds: typeof merged?.traceRetentionSeconds === 'number' ? merged.traceRetentionSeconds : null,
              actorUserId: typeof user?.id === 'string' ? user.id : null,
              actorDisplayName: typeof user?.displayName === 'string' ? user.displayName : null,
            },
          })
        );
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
    if (!selectedMissionId) {
      setMemberColors({});
      setMemberNames({});
      return;
    }
    let cancelled = false;

    const refresh = async () => {
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
    };

    void refresh();

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
    };
    const onFocus = () => {
      void refresh();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [selectedMissionId]);

  useEffect(() => {
    if (!selectedMissionId) return;
    const id = window.setInterval(() => {
      setOthersActivityTick((v) => (v + 1) % 1_000_000);
    }, 10_000);
    return () => {
      window.clearInterval(id);
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

      try {
        const prevFromMsg =
          typeof msg.prevTraceRetentionSeconds === 'number' && Number.isFinite(msg.prevTraceRetentionSeconds)
            ? msg.prevTraceRetentionSeconds
            : null;
        const actorUserId = typeof msg.actorUserId === 'string' ? msg.actorUserId : null;
        const rawName = typeof msg.actorDisplayName === 'string' ? msg.actorDisplayName : null;
        const name = (rawName && rawName.trim()) || (actorUserId ? buildUserDisplayName(actorUserId) : null);

        const prevFallback = mission?.traceRetentionSeconds;
        const prev = prevFromMsg ?? (typeof prevFallback === 'number' ? prevFallback : null);
        if (name && typeof prev === 'number' && prev !== nextRetention) {
          setActivityToast(`${name} vient de passer le temps de suivi de ${prev} secondes à ${nextRetention} secondes`);
        }
      } catch {
        // ignore
      }

      setMission((prev) => {
        const prevRetention = prev?.traceRetentionSeconds;
        const next = prev ? { ...prev, traceRetentionSeconds: nextRetention } : prev;

        // If retention increased, request a fresh snapshot to fill missing history.
        if (prevRetention && nextRetention > prevRetention) {
          try {
            socket.emit('mission:join', { missionId: selectedMissionId, retentionSeconds: historyWindowSeconds });
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
      onMissionUpdated({
        missionId: m.id,
        traceRetentionSeconds: e?.detail?.traceRetentionSeconds ?? m.traceRetentionSeconds,
        prevTraceRetentionSeconds: e?.detail?.prevTraceRetentionSeconds,
        actorUserId: e?.detail?.actorUserId,
        actorDisplayName: e?.detail?.actorDisplayName,
      });
    };

    socket.on('mission:updated', onMissionUpdated);
    window.addEventListener('geotacops:mission:updated', onMissionUpdatedWindow as any);
    return () => {
      socket.off('mission:updated', onMissionUpdated);
      window.removeEventListener('geotacops:mission:updated', onMissionUpdatedWindow as any);
    };
  }, [selectedMissionId, mission, historyWindowSeconds]);

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

  // Load previously saved traces for this mission (ONLY others) once per mission.
  useEffect(() => {
    if (!selectedMissionId) {
      tracesLoadedRef.current = false;
      return;
    }

    if (tracesLoadedRef.current) return;

    const othersKey = `geogn.trace.others.${selectedMissionId}`;

    try {
      const rawOthers = localStorage.getItem(othersKey);
      if (rawOthers) {
        const parsed = JSON.parse(rawOthers) as Record<string, { lng: number; lat: number; t: number }[]>;
        if (parsed && typeof parsed === 'object') {
          const normalizedOthers: Record<string, { lng: number; lat: number; t: number }[]> = {};
          for (const [userId, pts] of Object.entries(parsed)) {
            if (!Array.isArray(pts) || pts.length === 0) continue;
            normalizedOthers[userId] = pts
              .filter((p) => p && typeof p.lng === 'number' && typeof p.lat === 'number' && typeof p.t === 'number')
              .map((p) => ({
                lng: p.lng,
                lat: p.lat,
                t: p.t < 1_000_000_000_000 ? p.t * 1000 : p.t,
              }));
          }

          otherTracesRef.current = normalizedOthers;
          const nextPositions: Record<string, { lng: number; lat: number; t: number }> = {};
          for (const [userId, pts] of Object.entries(normalizedOthers)) {
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

  // À chaque changement de mission, réinitialiser immédiatement la dernière position locale
  // pour éviter qu'un ancien point "fantôme" ne se recolore au reconnect.
  useEffect(() => {
    setLastPos(null);
  }, [selectedMissionId]);

  // Réagir à une purge explicite de l'historique de mission (bouton "Purger l'historique")
  // en vidant immédiatement les traces et positions locales pour cette mission.
  useEffect(() => {
    const clearLocalTraces = (missionId: string | undefined) => {
      if (!missionId || missionId !== selectedMissionId) return;

      setTracePoints([]);
      tracePointsRef.current = [];
      setLastPos(null);
      otherTracesRef.current = {};
      setOtherPositions({});
      setOthersActivityTick((v) => (v + 1) % 1_000_000);
      tracesLoadedRef.current = false;
    };

    const onWindowEvent = (e: any) => {
      const missionId = e?.detail?.missionId as string | undefined;
      clearLocalTraces(missionId);
    };

    // IMPORTANT: ne pas dépendre de socketRef.current ici.
    // Le listener peut être enregistré avant que socketRef.current ne soit initialisé,
    // ce qui fait que l'event temps réel n'est jamais reçu.
    // getSocket() retourne un singleton : on s'abonne directement dessus.
    const socket = getSocket();
    const onSocketEvent = (msg: any) => {
      const missionId = typeof msg?.missionId === 'string' ? msg.missionId : undefined;

      try {
        if (missionId && missionId === selectedMissionId) {
          const actorUserId = typeof msg?.actorUserId === 'string' ? msg.actorUserId : null;
          const rawName = typeof msg?.actorDisplayName === 'string' ? msg.actorDisplayName : null;
          const name = (rawName && rawName.trim()) || (actorUserId ? buildUserDisplayName(actorUserId) : null);
          if (name && (!user?.id || user.id !== actorUserId)) {
            setActivityToast(`${name} vient de vider la trame de la mission`);
          }
        }
      } catch {
        // ignore
      }
      clearLocalTraces(missionId);
    };

    window.addEventListener('geogn:mission:tracesCleared', onWindowEvent as any);
    socket.on('mission:tracesCleared', onSocketEvent);

    return () => {
      window.removeEventListener('geogn:mission:tracesCleared', onWindowEvent as any);
      socket.off('mission:tracesCleared', onSocketEvent);
    };
  }, [selectedMissionId]);

  useEffect(() => {
    if (!selectedMissionId) return;
    const now = Date.now();
    const cutoff = now - traceRetentionMs;

    setTracePoints((prev) => {
      const next = prev.filter((p) => p.t >= cutoff);
      return next;
    });

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
      setTracePoints((prev) => {
        const next: typeof prev = [];
        return next;
      });
      otherTracesRef.current = {};
      setOtherPositions({});
      return;
    }

    const interval = window.setInterval(() => {
      const now = Date.now();
      const cutoff = now - traceRetentionMs;

      setTracePoints((prev) => {
        const next = prev.filter((p) => p.t >= cutoff);
        return next;
      });

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

    // Alternance simple à chaque clic :
    // - center => recentre + désactive follow
    // - follow => active followMyBearing
    if (centerOnMeNextActionRef.current === 'follow') {
      setFollowMyBearing(true);
      centerOnMeNextActionRef.current = 'center';
      return;
    }

    setFollowMyBearing(false);
    centerOnMeNextActionRef.current = 'follow';

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

  function enforceLayerOrder(map: MapLibreMapInstance) {
    const safeMoveToTop = (id: string) => {
      if (!map.getLayer(id)) return;
      try {
        map.moveLayer(id);
      } catch {
      }
    };

    // Zones et grilles de fond
    safeMoveToTop('zones-fill');
    safeMoveToTop('zones-outline');
    safeMoveToTop('zones-grid-lines');
    safeMoveToTop('zones-grid-labels');

    // Zones véhicule (doivent rester sous les POI/traces mais au-dessus du fond)
    safeMoveToTop('vehicle-track-reached-prev-fill');
    safeMoveToTop('vehicle-track-reached-prev-outline');
    safeMoveToTop('vehicle-track-reached-fill');
    safeMoveToTop('vehicle-track-reached-outline');

    // Zone d'estimation (doit rester sous les points/POI)
    safeMoveToTop('person-estimation-outer-fill');
    safeMoveToTop('person-estimation-inner-fill');
    safeMoveToTop('person-estimation-corridor-outline');
    safeMoveToTop('person-estimation-corridor-fill');

    // POI, traces et positions au-dessus de la zone
    safeMoveToTop('pois');
    safeMoveToTop('pois-labels');

    safeMoveToTop('trace-line');
    safeMoveToTop('others-traces-line');
    safeMoveToTop('others-points');
    safeMoveToTop('others-points-inactive-dot');
    safeMoveToTop('others-labels');
    safeMoveToTop('zones-labels');

    // Toujours au-dessus de tout le reste (POI, zones, traces, labels, etc.)
    safeMoveToTop('me-dot');
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

    if (!map.getSource('trace')) {
      map.addSource('trace', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    }

    // Ensure my fading trace is rendered above other users' traces.
    if (!map.getLayer('trace-line')) {
      map.addLayer(
        {
          id: 'trace-line',
          type: 'line',
          source: 'trace',
          paint: {
            'line-color': '#00ff00',
            'line-width': 8,
            'line-opacity': ['coalesce', ['get', 'opacity'], 0.9],
          },
          layout: {
            'line-join': 'round',
            'line-cap': 'butt',
          },
        },
        'me-dot'
      );
    }

    if (map.getLayer('others-traces-line') && map.getLayer('trace-line')) {
      // Render others-traces-line underneath the main trace-line layer.
      map.moveLayer('others-traces-line', 'trace-line');
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
          // Use per-feature opacity to support fading gradient on other users' traces as well.
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

      // Ensure my own position dot stays visually on top of other points.
      if (map.getLayer('me-dot')) {
        map.moveLayer('me-dot');
      }
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
        paint: {
          'fill-color': ['coalesce', ['get', 'color'], '#22c55e'],
          'fill-opacity': 0,
        },
      });
    }
    if (!map.getLayer('zones-outline')) {
      map.addLayer({
        id: 'zones-outline',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#16a34a'],
          'line-width': 2,
        },
      });
    }

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
    if (!map.getSource('person-estimation')) {
      map.addSource('person-estimation', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('person-estimation-corridor')) {
      map.addSource('person-estimation-corridor', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }
    if (!map.getSource('person-estimation')) {
      map.addSource('person-estimation', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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
      });
    }

    if (traceSource) {
      const retentionMs = traceRetentionMs;
      const now = Date.now();
      const currentTracePoints = tracePointsRef.current;
      const filtered = currentTracePoints.filter((p) => now - p.t <= retentionMs);
      const coords = filtered.map((p) => [p.lng, p.lat]);
      if (coords.length >= 2) {
        const fc = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: coords },
            },
          ],
        } as any;
        traceSource.setData(fc);
      } else if (coords.length === 1) {
        const [lng, lat] = coords[0];
        const fc = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  [lng, lat],
                  [lng + 1e-9, lat + 1e-9],
                ],
              },
            },
          ],
        } as any;
        traceSource.setData(fc);
      } else {
        const fc = { type: 'FeatureCollection', features: [] } as any;
        traceSource.setData(fc);
      }
    }

    if (othersSource) {
      const features = Object.entries(otherPositions)
        .filter(([userId]) => !hiddenUserIds[userId])
        .map(([userId, p]) => {
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
        if (hiddenUserIds[userId]) continue;
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

        const gridOrientation = (z.grid as any)?.orientation === 'diag45' ? 'diag45' : 'vertical';

        const dx = (bbox.maxLng - bbox.minLng) / cols;
        const dy = (bbox.maxLat - bbox.minLat) / rows;

        const metersPerDegLat = 111_320;
        const metersPerDegLng = 111_320 * Math.cos((((z.type === 'circle' && z.circle) ? z.circle.center.lat : (bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180);

        // Centre utilisé pour la rotation (et le repère en mètres)
        const centerLng = z.type === 'circle' && z.circle ? z.circle.center.lng : (bbox.minLng + bbox.maxLng) / 2;
        const centerLat = z.type === 'circle' && z.circle ? z.circle.center.lat : (bbox.minLat + bbox.maxLat) / 2;

        const rotateMeters = (x: number, y: number, angleRad: number) => {
          const c = Math.cos(angleRad);
          const s = Math.sin(angleRad);
          return { x: x * c - y * s, y: x * s + y * c };
        };

        const toMeters = (lng: number, lat: number, centerLng: number, centerLat: number) => {
          return {
            x: (lng - centerLng) * metersPerDegLng,
            y: (lat - centerLat) * metersPerDegLat,
          };
        };

        const toLngLat = (x: number, y: number, centerLng: number, centerLat: number) => {
          return {
            lng: centerLng + x / metersPerDegLng,
            lat: centerLat + y / metersPerDegLat,
          };
        };

        const addRotatedSegments = (
          kind: 'line' | 'label' | 'cell',
          axis: 'x' | 'y' | null,
          text: string | null,
          a: { x: number; y: number },
          b: { x: number; y: number } | null
        ) => {
          if (kind === 'line') {
            if (!b) return;
            const pa = toLngLat(a.x, a.y, centerLng, centerLat);
            const pb = toLngLat(b.x, b.y, centerLng, centerLat);
            features.push({
              type: 'Feature',
              properties: { kind: 'line', zoneId: z.id, color: z.color, rows, cols },
              geometry: { type: 'LineString', coordinates: [[pa.lng, pa.lat], [pb.lng, pb.lat]] },
            });
            return;
          }
          const p = toLngLat(a.x, a.y, centerLng, centerLat);
          if (kind === 'cell') {
            features.push({
              type: 'Feature',
              properties: { kind: 'cell', zoneId: z.id, text },
              geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            });
            return;
          }
          features.push({
            type: 'Feature',
            properties: { kind: 'label', axis, zoneId: z.id, text, rows, cols },
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          });
        };

        if (gridOrientation === 'diag45') {
          const angle = Math.PI / 4;
          const inv = -angle;

          const ringMetersRot: [number, number][] | null =
            z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length
              ? z.polygon.coordinates[0].map((p) => {
                  const m = toMeters(p[0], p[1], centerLng, centerLat);
                  const r = rotateMeters(m.x, m.y, inv);
                  return [r.x, r.y];
                })
              : null;

          const clipV = (x: number) => {
            if (z.type === 'circle' && z.circle) {
              const R = z.circle.radiusMeters;
              if (Math.abs(x) >= R) return [] as [number, number][];
              const y = Math.sqrt(R * R - x * x);
              return [[-y, y]] as [number, number][];
            }
            if (ringMetersRot) {
              return clipVerticalLineToPolygon(x, ringMetersRot);
            }
            return [] as [number, number][];
          };

          const clipH = (y: number) => {
            if (z.type === 'circle' && z.circle) {
              const R = z.circle.radiusMeters;
              if (Math.abs(y) >= R) return [] as [number, number][];
              const x = Math.sqrt(R * R - y * y);
              return [[-x, x]] as [number, number][];
            }
            if (ringMetersRot) {
              return clipHorizontalLineToPolygon(y, ringMetersRot);
            }
            return [] as [number, number][];
          };

          // bbox dans l'espace tourné (en mètres)
          let minX = 0;
          let maxX = 0;
          let minY = 0;
          let maxY = 0;

          if (z.type === 'circle' && z.circle) {
            const R = z.circle.radiusMeters;
            minX = -R;
            maxX = R;
            minY = -R;
            maxY = R;
          } else if (ringMetersRot && ringMetersRot.length) {
            minX = Math.min(...ringMetersRot.map((p) => p[0]));
            maxX = Math.max(...ringMetersRot.map((p) => p[0]));
            minY = Math.min(...ringMetersRot.map((p) => p[1]));
            maxY = Math.max(...ringMetersRot.map((p) => p[1]));
          } else {
            continue;
          }

          const dxm = (maxX - minX) / cols;
          const dym = (maxY - minY) / rows;

          const fromRotMeters = (x: number, y: number) => {
            const r = rotateMeters(x, y, angle);
            return { x: r.x, y: r.y };
          };

          // lignes verticales (dans repère tourné)
          for (let c = 1; c < cols; c++) {
            const x = minX + c * dxm;
            const segs = clipV(x);
            for (const [a, b] of segs) {
              const p1 = fromRotMeters(x, a);
              const p2 = fromRotMeters(x, b);
              addRotatedSegments('line', null, null, p1, p2);
            }
          }

          // lignes horizontales (dans repère tourné)
          for (let r = 1; r < rows; r++) {
            const y = minY + r * dym;
            const segs = clipH(y);
            for (const [a, b] of segs) {
              const p1 = fromRotMeters(a, y);
              const p2 = fromRotMeters(b, y);
              addRotatedSegments('line', null, null, p1, p2);
            }
          }

          // labels colonnes (bas dans repère tourné)
          for (let c = 0; c < cols; c++) {
            const x = minX + (c + 0.5) * dxm;
            const segs = clipV(x);
            if (!segs.length) continue;
            const bottom = Math.min(...segs.map((s) => Math.min(s[0], s[1])));
            const p = fromRotMeters(x, bottom);
            const letter = String.fromCharCode('A'.charCodeAt(0) + c);
            addRotatedSegments('label', 'x', letter, p, null);
          }

          // labels lignes (gauche dans repère tourné)
          for (let r = 0; r < rows; r++) {
            const y = minY + (r + 0.5) * dym;
            const segs = clipH(y);
            if (!segs.length) continue;
            const left = Math.min(...segs.map((s) => Math.min(s[0], s[1])));
            const p = fromRotMeters(left, y);
            const num = String(rows - r);
            addRotatedSegments('label', 'y', num, p, null);
          }

          // labels cellules
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const x = minX + (c + 0.5) * dxm;
              const y = minY + (r + 0.5) * dym;
              const p = fromRotMeters(x, y);
              if (!isPointInZone(centerLng + p.x / metersPerDegLng, centerLat + p.y / metersPerDegLat, z)) continue;
              const colLetter = String.fromCharCode('A'.charCodeAt(0) + c);
              const rowNumber = rows - r;
              const text = `${colLetter}${rowNumber}`;
              addRotatedSegments('cell', null, text, p, null);
            }
          }

          continue;
        }

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
      applyHeatmapVisibility(map, showEstimationHeatmapRef.current && personPanelOpenRef.current);
      setMapReady(true);
    };

    const onStyleData = () => {
      if (!mapReady) return;
      // Après un changement de style (setStyle), toutes les couches custom sont perdues.
      // On recrée donc les overlays (zones, POI, estimation, etc.), on remet l'ordre,
      // puis on réapplique la visibilité de la heatmap.
      ensureOverlays(map);
      resyncAllOverlays(map);
      enforceLayerOrder(map);
      applyGridLabelStyle(map);
      applyHeatmapVisibility(map, showEstimationHeatmapRef.current && personPanelOpenRef.current);

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
      // Forcer un bump de version pour que les effets React réinjectent les données dans les sources.
      setStyleVersion((v) => v + 1);
    };

    map.on('load', onLoad);
    map.on('styledata', onStyleData);
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
        // Remonter légèrement l'échelle pour qu'elle passe au-dessus du mini popup heatmap
        (el as HTMLElement).style.marginBottom = '60px';
        // La réglette doit être purement informative (pas de drag/clic parasite sur mobile)
        (el as HTMLElement).style.pointerEvents = 'none';
        // Initialiser la visibilité de l'échelle en fonction de scaleEnabled au moment de la création
        (el as HTMLElement).style.display = scaleEnabled ? '' : 'none';
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
      map.off('load', onLoad);
      map.off('styledata', onStyleData);
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

    activeMissionRef.current = missionId;

    const ensureJoined = async (): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        try {
          socket.emit('mission:join', { missionId, retentionSeconds: historyWindowSeconds }, (res: any) => {
            resolve(Boolean(res?.ok));
          });
        } catch {
          resolve(false);
        }
      });
    };

    const onConnected = async () => {
      const joined = await ensureJoined();
      if (!joined) return;
      if (activeMissionRef.current !== missionId) return;

      // Après une (re)connexion, on redemande systématiquement un snapshot.
      // Sur mobile / retour d'arrière-plan, on peut avoir perdu des événements
      // et les positions actives ne se rafraîchissent pas sans snapshot.
      requestSnapshot();

      flushDelayRef.current = 1000;
      flushPendingInternal();
      void flushPendingActions(missionId);
    };

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
      if (!user?.id) return;
      persistPendingPositions(missionId, user.id);
    };

    const scheduleFlush = (delayMs: number) => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (!pendingKey) return;
      flushTimerRef.current = window.setTimeout(() => {
        flushPendingInternal();
      }, delayMs);
    };

    const flushPendingInternal = () => {
      const pts = pendingBulkRef.current;
      if (!pendingKey) return;
      if (activeMissionRef.current !== missionId) {
        return;
      }
      if (!pts || pts.length === 0) {
        flushDelayRef.current = 1000;
        return;
      }
      if (!socket.connected) {
        scheduleFlush(flushDelayRef.current);
        return;
      }

      const batch = pts.slice(0, 200);
      socket.emit('position:bulk', { points: batch }, (res: any) => {
        if (activeMissionRef.current !== missionId) {
          return;
        }
        if (res && res.ok) {
          pendingBulkRef.current = pendingBulkRef.current.slice(batch.length);
          persistPending();
          flushDelayRef.current = 1000;
          if (pendingBulkRef.current.length > 0) {
            scheduleFlush(0);
          }
        } else {
          const nextDelay = flushDelayRef.current < 2000 ? 2000 : flushDelayRef.current < 5000 ? 5000 : 5000;
          flushDelayRef.current = nextDelay;
          scheduleFlush(flushDelayRef.current);
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

    socket.on('connect', onConnected);
    if (socket.connected) {
      void onConnected();
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        lastHiddenAtRef.current = Date.now();
        return;
      }
      if (!socket.connected) {
        try {
          socket.connect();
        } catch {
          // ignore
        }
      }
      void (async () => {
        const joined = await ensureJoined();
        if (!joined) return;
        if (activeMissionRef.current !== missionId) return;

        const now = Date.now();
        const wasHiddenAt = lastHiddenAtRef.current;
        const wasBackgrounded = typeof wasHiddenAt === 'number' ? now - wasHiddenAt > 1500 : false;

        // Au retour dans l'app, on force le snapshot pour retrouver les positions actives.
        // (même si le dernier snapshot est récent)
        if (wasBackgrounded || Object.keys(otherPositions).length === 0) {
          requestSnapshot();
        } else if (now - lastSnapshotAtRef.current > 60_000) {
          requestSnapshot();
        }

        flushDelayRef.current = 1000;
        flushPendingInternal();
      })();
      void flushPendingActions(missionId);
    };
    document.addEventListener('visibilitychange', onVisibility);

    window.addEventListener('focus', onVisibility);

    const onOnline = () => {
      void flushPendingActions(missionId);
    };
    window.addEventListener('online', onOnline);

    const onSnapshot = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      const now = Date.now();
      lastSnapshotAtRef.current = now;

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
      const retentionMsFromSnapshot = Math.max(0, retentionSecondsFromSnapshot !== null ? retentionSecondsFromSnapshot * 1000 : 0);

      // Ne jamais tronquer localement plus court que la rétention de la mission.
      // Le snapshot peut être plus court si le client a demandé une fenêtre réduite.
      const effectiveRetentionMs = Math.max(traceRetentionMs, retentionMsFromSnapshot);
      const maxTracePointsFromSnapshot = Math.max(1, Math.ceil(effectiveRetentionMs / 1000) + 2);
      const cutoff = now - effectiveRetentionMs;

      const nextOthers: Record<string, { lng: number; lat: number; t: number }> = {};
      for (const [userId, p] of Object.entries(positions)) {
        if (!userId) continue;
        if (user?.id && userId === user.id) continue;
        if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
        const t = normalizeRemoteTime((p as any).t, now);
        if (t < cutoff) continue;
        nextOthers[userId] = { lng: p.lng, lat: p.lat, t };
      }

      const nextOthersTraces: Record<string, { lng: number; lat: number; t: number }[]> = {};
      for (const [userId, pts] of Object.entries(traces)) {
        if (!userId) continue;
        // Ne jamais ranger la propre trace de l'utilisateur courant dans "others"
        // pour éviter d'avoir un double rendu (trace self + trace grise "autre").
        if (user?.id && userId === user.id) continue;
        if (!Array.isArray(pts) || pts.length === 0) continue;
        const filtered = pts
          .filter((p) => p && typeof p.lng === 'number' && typeof p.lat === 'number')
          .map((p) => ({ lng: p.lng, lat: p.lat, t: normalizeRemoteTime((p as any).t, now) }))
          .filter((p) => p.t >= cutoff)
          .slice(-maxTracePointsFromSnapshot);
        if (filtered.length) {
          nextOthersTraces[userId] = filtered;
        }
      }

      // Apply self trace from snapshot as well (do not skip self for traces)
      if (user?.id) {
        const selfPts = traces[user.id];
        if (Array.isArray(selfPts)) {
          const effectiveMaxTracePoints = Math.max(1, Math.ceil(effectiveRetentionMs / 1000) + 2);
          const effectiveCutoff = now - effectiveRetentionMs;

          const normalizedSelf = selfPts
            .filter((p) => p && typeof p.lng === 'number' && typeof p.lat === 'number' && typeof (p as any).t === 'number')
            .map((p) => {
              const rawT = (p as any).t as number;
              const tMs = rawT < 1_000_000_000_000 ? rawT * 1000 : rawT;
              return { lng: p.lng, lat: p.lat, t: normalizeRemoteTime(tMs, now) };
            })
            .filter((p) => p.t >= effectiveCutoff)
            .slice(-effectiveMaxTracePoints);

          if (normalizedSelf.length) {
            // Remplacer complètement la trace locale par la trace du snapshot,
            // pour éviter de garder d'anciens segments "fantômes" propres au client.
            const merged = normalizedSelf
              .filter((p) => p && typeof p.lng === 'number' && typeof p.lat === 'number' && typeof p.t === 'number')
              .sort((a, b) => a.t - b.t)
              .filter((p) => p.t >= effectiveCutoff);

            const deduped: typeof merged = [];
            for (const p of merged) {
              const last = deduped.length ? deduped[deduped.length - 1] : null;
              if (last && last.lng === p.lng && last.lat === p.lat && Math.abs(last.t - p.t) < 500) continue;
              deduped.push(p);
            }

            const next = deduped.slice(-effectiveMaxTracePoints);
            setTracePoints(next);
          }
        }
      }

      // Le snapshot est la source de vérité pour les autres utilisateurs :
      // remplacer complètement les positions et traces locales par celles reçues,
      // même si le snapshot est vide (utile après une purge explicite).
      otherTracesRef.current = nextOthersTraces;
      setOtherPositions(nextOthers);
      setOthersActivityTick((v) => (v + 1) % 1_000_000);
    };

    const applyRemotePosition = (msg: any) => {
      if (!msg?.userId || typeof msg.lng !== 'number' || typeof msg.lat !== 'number') return;

      // If it's me, also feed my local trace from socket events (update/bulk/snapshot)
      // so my rendering behaves the same way as other users.
      if (user?.id && msg.userId === user.id) {
        const now = normalizeRemoteTime(msg.t, Date.now());
        setLastPos({ lng: msg.lng, lat: msg.lat });
        setTracePoints((prev) => {
          const last = prev.length ? prev[prev.length - 1] : null;
          if (last && last.lng === msg.lng && last.lat === msg.lat && Math.abs(last.t - now) < 500) {
            return prev;
          }
          const cutoff = Date.now() - traceRetentionMs;
          const next = [...prev, { lng: msg.lng, lat: msg.lat, t: now }]
            .filter((p) => p.t >= cutoff)
            .slice(-maxTracePoints);
          return next;
        });
        return;
      }

      // Toujours utiliser uniquement la couleur de mission attribuée au membre.
      const memberColor = memberColors[msg.userId];
      if (memberColor) {
        otherColorsRef.current[msg.userId] = memberColor;
      }
      const now = normalizeRemoteTime(msg.t, Date.now());

      const traces = otherTracesRef.current[msg.userId] ?? [];
      const cutoff = Date.now() - traceRetentionMs;
      const nextTraces = [...traces, { lng: msg.lng, lat: msg.lat, t: now }]
        .filter((p) => p.t >= cutoff)
        .slice(-maxTracePoints);
      otherTracesRef.current[msg.userId] = nextTraces;
      setOthersActivityTick((v) => (v + 1) % 1_000_000);

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
      if (otherTracesRef.current[msg.userId]) {
        delete otherTracesRef.current[msg.userId];
        setOthersActivityTick((v) => (v + 1) % 1_000_000);
      }
    };

    socket.on('position:clear', onPosClear);

    const onPoiCreated = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.poi?.id) return;
      try {
        const createdBy = typeof msg.poi.createdBy === 'string' ? msg.poi.createdBy : null;
        if (createdBy && user?.id && createdBy === user.id) {
          setProjectionNotification(false);
        }

        // Bulle d'info pour les autres participants uniquement (pas pour l'auteur).
        if (createdBy && (!user?.id || user.id !== createdBy)) {
          const rawName = typeof msg.createdByDisplayName === 'string' ? msg.createdByDisplayName : null;
          const name = (rawName && rawName.trim()) || buildUserDisplayName(createdBy);
          setActivityToast(`${name} vient de créer un POI`);
        }
      } catch {
        // ignore
      }

      setPois((prev) => {
        const incoming = msg.poi as ApiPoi;
        const exists = prev.some((p) => p.id === incoming.id);
        if (exists) return prev;

        // Réconciliation avec un POI optimiste local-* pour éviter les doublons.
        // Cas typique : on ajoute un POI offline/optimiste, puis on reçoit poi:created.
        const eps = 1e-6;
        const idxLocal = prev.findIndex((p) => {
          if (!p?.id || typeof p.id !== 'string') return false;
          if (!p.id.startsWith('local-')) return false;
          if ((p.title ?? '') !== (incoming.title ?? '')) return false;
          if ((p.type ?? '') !== (incoming.type ?? '')) return false;
          if ((p.icon ?? '') !== (incoming.icon ?? '')) return false;
          if ((p.color ?? '') !== (incoming.color ?? '')) return false;
          if ((p.comment ?? '') !== (incoming.comment ?? '')) return false;
          if (typeof p.lng !== 'number' || typeof p.lat !== 'number') return false;
          if (typeof incoming.lng !== 'number' || typeof incoming.lat !== 'number') return false;
          if (Math.abs(p.lng - incoming.lng) > eps) return false;
          if (Math.abs(p.lat - incoming.lat) > eps) return false;
          // si possible, vérifier aussi l'auteur
          if (p.createdBy && incoming.createdBy && p.createdBy !== incoming.createdBy) return false;
          return true;
        });

        if (idxLocal >= 0) {
          const next = prev.slice();
          next[idxLocal] = incoming;
          return next;
        }

        return [incoming, ...prev];
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
      try {
        const createdBy = typeof msg.zone.createdBy === 'string' ? msg.zone.createdBy : null;
        if (createdBy) {
          const rawName = typeof msg.createdByDisplayName === 'string' ? msg.createdByDisplayName : null;
          const name = (rawName && rawName.trim()) || buildUserDisplayName(createdBy);
          setActivityToast(`${name} vient de créer une zone`);
        }
      } catch {
        // ignore
      }
      setZones((prev) => {
        const exists = prev.some((z) => z.id === msg.zone.id);
        if (exists) return prev;
        return [msg.zone as ApiZone, ...prev];
      });
    };

    const onPersonCaseUpserted = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.case?.id) return;

      setPersonCase(msg.case as ApiPersonCase);

      const created = msg?.created === true;
      const actorUserId = typeof msg?.actorUserId === 'string' ? msg.actorUserId : null;
      if (created && actorUserId) {
        const rawName = typeof msg.actorDisplayName === 'string' ? msg.actorDisplayName : null;
        const name = (rawName && rawName.trim()) || buildUserDisplayName(actorUserId);
        setActivityToast(`${name} vient de créer une piste`);
      }
    };

    const onPersonCaseDeleted = (msg: any) => {
      if (msg?.missionId && msg.missionId !== selectedMissionId) return;
      setPersonCase(null);
      setProjectionNotification(false);
    };
    const onZoneUpdated = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.zone?.id) return;
      setZones((prev) => prev.map((z) => (z.id === msg.zone.id ? (msg.zone as ApiZone) : z)));
    };
    const onZoneDeleted = (msg: any) => {
      if (!msg?.zoneId) return;
      setZones((prev) => prev.filter((z) => z.id !== msg.zoneId));
    };

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
    }

    socket.on('poi:created', onPoiCreated);
    socket.on('poi:updated', onPoiUpdated);
    socket.on('poi:deleted', onPoiDeleted);

    socket.on('zone:created', onZoneCreated);
    socket.on('zone:updated', onZoneUpdated);
    socket.on('zone:deleted', onZoneDeleted);

    socket.on('person-case:upserted', onPersonCaseUpserted);
    socket.on('person-case:deleted', onPersonCaseDeleted);

    socket.on('vehicle-track:created', onVehicleTrackCreated);
    socket.on('vehicle-track:updated', onVehicleTrackUpdated);
    socket.on('vehicle-track:deleted', onVehicleTrackDeleted);
    socket.on('vehicle-track:expired', onVehicleTrackExpired);
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

      // stop scheduled flush
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      socket.off('connect', onConnected);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
      window.removeEventListener('online', onOnline);
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

      socket.off('person-case:upserted', onPersonCaseUpserted);
      socket.off('person-case:deleted', onPersonCaseDeleted);

      socket.off('vehicle-track:created', onVehicleTrackCreated);
      socket.off('vehicle-track:updated', onVehicleTrackUpdated);
      socket.off('vehicle-track:deleted', onVehicleTrackDeleted);
      socket.off('vehicle-track:expired', onVehicleTrackExpired);

      // prevent late callbacks from rescheduling
      activeMissionRef.current = null;

      // reset backoff
      flushDelayRef.current = 1000;
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

    const prevTracking = prevTrackingRef.current;
    prevTrackingRef.current = trackingEnabled;

    // Stop any existing watcher before applying new tracking state.
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    // Only reset when transitioning from true -> false
    if (prevTracking === true && trackingEnabled === false) {
      setLastPos(null);
      setTracePoints((prev) => {
        const next: typeof prev = [];
        return next;
      });

      if (selectedMissionId && user?.id) {
        const key = `geogn.trace.self.${selectedMissionId}.${user.id}`;
        try {
          localStorage.setItem(key, JSON.stringify([]));
        } catch {
          // ignore storage errors
        }
      }

      const socket = socketRef.current;
      if (socket) {
        socket.emit('position:clear', {});
      }

      return;
    }

    if (!trackingEnabled) {
      // Do not reset if we didn't come from an active tracking state
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lng = pos.coords.longitude;
        const lat = pos.coords.latitude;
        const t = Date.now();

        if (typeof pos.coords.heading === 'number' && Number.isFinite(pos.coords.heading)) {
          lastHeadingRef.current = pos.coords.heading;
        }

        setLastPos({ lng, lat });
        setTracePoints((prev) => {
          const cutoff = Date.now() - traceRetentionMs;
          const next = [...prev, { lng, lat, t }].filter((p) => p.t >= cutoff);
          const sliced = next.slice(-maxTracePoints);
          return sliced;
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
            wasSocketConnectedRef.current = true;
            socket.emit('position:update', payload);
          } else {
            // First offline point: persist immediately (then throttle every 2s)
            if (wasSocketConnectedRef.current) {
              wasSocketConnectedRef.current = false;
              lastPersistTsRef.current = 0;
            }

            pendingBulkRef.current = [...pendingBulkRef.current, payload].slice(-5000);
            if (user?.id) {
              persistPendingPositions(selectedMissionId, user.id);
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
    if (!followMyBearing) return;
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    if (!lastPos) return;

    const heading = lastHeadingRef.current;
    let bearing: number | null = null;
    if (typeof heading === 'number' && Number.isFinite(heading)) {
      bearing = heading;
    } else if (tracePoints.length >= 2) {
      const a = tracePoints[tracePoints.length - 2];
      const b = tracePoints[tracePoints.length - 1];
      const dLng = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
      const dLat = b.lat - a.lat;
      const rad = Math.atan2(dLng, dLat);
      bearing = ((rad * 180) / Math.PI + 360) % 360;
    }

    if (bearing === null) return;
    try {
      map.easeTo({ center: [lastPos.lng, lastPos.lat], bearing, duration: 350 });
    } catch {
      // ignore
    }
  }, [followMyBearing, lastPos, tracePoints, mapReady]);

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

    const getCenter = (fc: any): { lng: number; lat: number } | null => {
      const f0 = fc?.features?.[0];
      const c = f0?.properties?.center;
      if (c && typeof c.lng === 'number' && typeof c.lat === 'number') return { lng: c.lng, lat: c.lat };
      const ring = getRing(fc);
      if (!ring || ring.length < 3) return null;
      // simple centroid approx (average of vertices)
      let sumLng = 0;
      let sumLat = 0;
      let n = 0;
      for (let i = 0; i < ring.length - 1; i += 1) {
        const p = ring[i];
        sumLng += p[0];
        sumLat += p[1];
        n += 1;
      }
      if (n <= 0) return null;
      return { lng: sumLng / n, lat: sumLat / n };
    };

    function circleRingMeters(
      center: { lng: number; lat: number },
      radiusMeters: number,
      points: number
    ): [number, number][] {
      const latRad = (center.lat * Math.PI) / 180;
      const metersPerDegLat = 111_320;
      const metersPerDegLng = 111_320 * Math.cos(latRad);
      const coords: [number, number][] = [];
      for (let i = 0; i < points; i += 1) {
        const a = (i / points) * Math.PI * 2;
        const dx = Math.cos(a) * radiusMeters;
        const dy = Math.sin(a) * radiusMeters;
        const lng = center.lng + dx / metersPerDegLng;
        const lat = center.lat + dy / metersPerDegLat;
        coords.push([lng, lat]);
      }
      if (coords.length) coords.push(coords[0]);
      return coords;
    }

    const clampStartToNeverShrink = (args: {
      center: { lng: number; lat: number };
      startRing: [number, number][];
      endRing: [number, number][];
    }): [number, number][] => {
      const { center, startRing, endRing } = args;
      const cx = center.lng;
      const cy = center.lat;
      const out: [number, number][] = [];
      const len = Math.min(startRing.length, endRing.length);
      for (let i = 0; i < len; i += 1) {
        const a = startRing[i];
        const b = endRing[i];
        const ax = a[0] - cx;
        const ay = a[1] - cy;
        const bx = b[0] - cx;
        const by = b[1] - cy;
        const da = Math.sqrt(ax * ax + ay * ay);
        const db = Math.sqrt(bx * bx + by * by);
        if (!Number.isFinite(da) || !Number.isFinite(db) || da <= 0) {
          out.push([cx + bx, cy + by]);
          continue;
        }
        if (da <= db) {
          out.push([cx + ax, cy + ay]);
          continue;
        }
        // da > db : on clamp à db pour éviter une animation de rétrécissement
        const k = db / da;
        out.push([cx + ax * k, cy + ay * k]);
      }
      return ensureClosed(out);
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

    const buildEnvelopeNeverShrink = (args: {
      center: { lng: number; lat: number };
      prevRing: [number, number][];
      nextRing: [number, number][];
    }): [number, number][] => {
      const { center, prevRing, nextRing } = args;
      const cx = center.lng;
      const cy = center.lat;
      const out: [number, number][] = [];
      const len = Math.min(prevRing.length, nextRing.length);
      for (let i = 0; i < len; i += 1) {
        const a = prevRing[i];
        const b = nextRing[i];
        const ax = a[0] - cx;
        const ay = a[1] - cy;
        const bx = b[0] - cx;
        const by = b[1] - cy;
        const da = Math.sqrt(ax * ax + ay * ay);
        const db = Math.sqrt(bx * bx + by * by);
        if (!Number.isFinite(da) || !Number.isFinite(db)) {
          out.push([cx + bx, cy + by]);
          continue;
        }
        if (db >= da) {
          out.push([cx + bx, cy + by]);
          continue;
        }
        // db < da : on garde l'ancien point pour ne jamais rétrécir
        out.push([cx + ax, cy + ay]);
      }
      return ensureClosed(out);
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

    const toRingRaw = getRing(data);
    const toCenter = getCenter(data);
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
  }, [
    mapReady,
    styleVersion,
    showActiveVehicleTrack,
    activeVehicleTrackId,
    activeVehicleTrack,
    vehicleTracksLoaded,
    vehicleTrackGeojsonById,
  ]);

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
    const inactiveAfterMs = 30_000;
    const inactiveColor = '#9ca3af';
    const features = Object.entries(otherTracesRef.current)
      .filter(([userId, pts]) => {
        if (!Array.isArray(pts) || pts.length === 0) return false;
        // Ne pas afficher "me" dans la couche des autres.
        if (user?.id && userId === user.id) return false;
        if (hiddenUserIds[userId]) return false;
        return true;
      })
      .map(([userId, pts]) => {
        const last = pts[pts.length - 1];
        if (!last || typeof last.lng !== 'number' || typeof last.lat !== 'number' || typeof last.t !== 'number') {
          return null;
        }

        const memberColor = memberColors[userId];
        const isInactive = now - last.t > inactiveAfterMs;
        // Inactif: gris plus clair. Sinon, couleur de mission.
        const color = isInactive ? inactiveColor : (memberColor ?? inactiveColor);
        const name = memberNames[userId] ?? '';

        return {
          type: 'Feature',
          properties: { userId, color, name, inactive: isInactive ? 1 : 0 },
          geometry: { type: 'Point', coordinates: [last.lng, last.lat] },
        };
      })
      .filter((f): f is any => Boolean(f));

    src.setData({
      type: 'FeatureCollection',
      features: features as any,
    });
  }, [memberColors, memberNames, mapReady, othersActivityTick, hiddenUserIds]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('others-traces') as GeoJSONSource | undefined;
    if (!src) return;

    const now = Date.now();
    const inactiveAfterMs = 30_000;
    const inactiveColor = '#9ca3af';
    const features: any[] = [];
    const segmentGapMs = 30_000;
    const opacities = [1, 0.8, 0.6, 0.4, 0.2];

    for (const [userId, pts] of Object.entries(otherTracesRef.current)) {
      // Ne jamais rendre la trace "others" pour l'utilisateur courant.
      if (user?.id && userId === user.id) continue;
      if (hiddenUserIds[userId]) continue;
      if (pts.length < 2) continue;

      const memberColor = memberColors[userId];
      const lastT = pts[pts.length - 1]?.t ?? 0;
      const isInactive = now - lastT > inactiveAfterMs;
      const color = isInactive ? inactiveColor : (memberColor ?? inactiveColor);

      const n = pts.length;
      let segment: { lng: number; lat: number; t: number }[] = [];
      let prevT: number | null = null;
      let prevBucket: number | null = null;
      let prevPoint: { lng: number; lat: number; t: number } | null = null;

      const flush = (bucket: number | null) => {
        if (segment.length >= 2 && bucket !== null) {
          features.push({
            type: 'Feature',
            properties: { userId, color, inactive: isInactive ? 1 : 0, opacity: opacities[bucket] ?? 0.9 },
            geometry: { type: 'LineString', coordinates: segment.map((x) => [x.lng, x.lat]) },
          });
        }
        segment = [];
      };

      for (let i = 0; i < n; i++) {
        const p = pts[i];
        if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
        if (typeof p.t !== 'number' || !Number.isFinite(p.t)) continue;

        const bucket = n > 0 ? Math.min(4, Math.max(0, Math.floor(((n - 1 - i) * 5) / n))) : 0;
        const isGap = prevT !== null && p.t - prevT > segmentGapMs;
        const bucketChanged = prevBucket !== null && bucket !== prevBucket;

        if ((isGap || bucketChanged) && segment.length) {
          flush(prevBucket);

      // Si après filtrage on n'a au final qu'un seul point pour cet utilisateur,
      // créer un tout petit segment 2-points pour que la pointe de la trace
      // arrive exactement sous le marker (comme pour la trace "me").
      if (features.length === 0 && n === 1) {
        const only = pts[0];
        if (
          only &&
          typeof only.lng === 'number' &&
          typeof only.lat === 'number' &&
          typeof only.t === 'number' &&
          Number.isFinite(only.t)
        ) {
          const lng = only.lng;
          const lat = only.lat;
          features.push({
            type: 'Feature',
            properties: { userId, color, inactive: isInactive ? 1 : 0, opacity: opacities[0] ?? 0.9 },
            geometry: {
              type: 'LineString',
              coordinates: [
                [lng, lat],
                [lng + 1e-9, lat + 1e-9],
              ],
            },
          });
        }
      }

          // Si on change de bucket (mais pas de trou), dupliquer le point précédent pour éviter un trou visuel.
          if (!isGap && prevPoint) {
            segment.push(prevPoint, p);
          } else {
            segment.push(p);
          }
        } else {
          segment.push(p);
        }

        prevT = p.t;
        prevBucket = bucket;
        prevPoint = p;
      }

      flush(prevBucket);
    }

    src.setData({ type: 'FeatureCollection', features } as any);
  }, [otherPositions, memberColors, mapReady, traceRetentionMs, othersActivityTick, hiddenUserIds]);

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

      const segmentGapMs = 30_000;
      const opacities = [1, 0.8, 0.6, 0.4, 0.2];
      const n = filtered.length;

      const selfFeatures: any[] = [];
      let segment: { lng: number; lat: number; t: number }[] = [];
      let prevT: number | null = null;
      let prevBucket: number | null = null;
      let prevPoint: { lng: number; lat: number; t: number } | null = null;

      const flush = (bucket: number | null) => {
        if (segment.length >= 2 && bucket !== null) {
          selfFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: segment.map((x) => [x.lng, x.lat]) },
            properties: { opacity: opacities[bucket] ?? 0.9 },
          });
        }
        segment = [];
      };

      for (let i = 0; i < n; i++) {
        const p = filtered[i];
        const bucket = n > 0 ? Math.min(4, Math.max(0, Math.floor(((n - 1 - i) * 5) / n))) : 0;

        const isGap = prevT !== null && p.t - prevT > segmentGapMs;
        const bucketChanged = prevBucket !== null && bucket !== prevBucket;

        if ((isGap || bucketChanged) && segment.length) {
          flush(prevBucket);

          // Si on change de bucket (mais pas de trou), dupliquer le point précédent
          // pour éviter un micro-trou visuel entre les 2 opacités.
          if (!isGap && prevPoint) {
            segment.push(prevPoint, p);
          } else {
            segment.push(p);
          }
        } else {
          segment.push(p);
        }

        prevT = p.t;
        prevBucket = bucket;
        prevPoint = p;
      }

      flush(prevBucket);

      // If we only have a single point in the filtered trace, emit a tiny
      // 2-point LineString to keep the trace visible instead of clearing it.
      if (selfFeatures.length === 0 && filtered.length === 1) {
        const only = filtered[0];
        const lng = only.lng;
        const lat = only.lat;
        selfFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [lng, lat],
              [lng + 1e-9, lat + 1e-9],
            ],
          },
          properties: { opacity: opacities[0] ?? 0.9 },
        });
      }

      const fc = { type: 'FeatureCollection', features: selfFeatures } as any;
      traceSource.setData(fc);
    };

    update();
  }, [lastPos, tracePoints, mapReady, traceRetentionMs, memberColors, memberNames, user?.id]);

  return (
    <div className="relative w-full h-screen">
      {confirmDialogEl}
      <div ref={mapRef} className="w-full h-full" />

      <div className="pointer-events-none fixed bottom-[calc(max(env(safe-area-inset-bottom),16px)+104px)] left-1/2 z-[1000] w-full -translate-x-1/2 max-w-md px-3 sm:max-w-lg md:max-w-xl">
        <div id="map-scale-container" className="pointer-events-auto flex w-full justify-center" />
      </div>

      {selectedPoi ? (
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
                  const name = buildUserDisplayName(id);
                  return `Créé par ${name}`;
                })()}
              </div>
            </div>
            <div className="ml-2 flex flex-col items-end gap-2 self-start">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNavPickerTarget({ lng: selectedPoi.lng, lat: selectedPoi.lat, title: selectedPoi.title || 'POI' });
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                  title="Naviguer vers le point"
                >
                  <Navigation2 size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (hasActiveTestVehicleTrack) {
                      setActivityToast('une piste est deja en cours');
                      return;
                    }
                    if (!selectedPoi) return;
                    setPersonDraft((prev) => ({
                      ...prev,
                      lastKnownType: 'poi',
                      lastKnownQuery: selectedPoi.title || 'POI',
                      lastKnownPoiId: selectedPoi.id,
                      lastKnownLng: selectedPoi.lng,
                      lastKnownLat: selectedPoi.lat,
                      // Si aucune date/heure n'est encore définie, on pré-remplit avec "maintenant"
                      // pour permettre un démarrage rapide.
                      lastKnownWhen: prev.lastKnownWhen ? prev.lastKnownWhen : nowLocalMinute,
                    }));

                    // Ouvre le popup "Démarrer une piste" (fiche en édition).
                    setPersonEdit(true);
                    setPersonPanelCollapsed(false);
                    setPersonPanelOpen(true);
                    setShowActiveVehicleTrack(true);

                    // Ferme le popup POI.
                    setSelectedPoi(null);
                  }}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50 ${
                    hasActiveTestVehicleTrack ? 'opacity-40 cursor-not-allowed hover:bg-white' : ''
                  }`}
                  title="Démarrer une piste depuis ce POI"
                >
                  <PawPrint size={16} />
                </button>
              </div>
              {canEditMap ? (
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
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={async () => {
                      if (!selectedMissionId || !selectedPoi) return;
                      const ok = await confirmDialog({
                        title: 'Supprimer ce POI ?',
                        message: 'Cette action est définitive.',
                        confirmText: 'Supprimer',
                        cancelText: 'Annuler',
                        variant: 'danger',
                      });
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
                    <Trash2 size={16} />
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeletePersonCaseOpen ? (
        <div
          className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setConfirmDeletePersonCaseOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-base font-bold text-gray-900">Supprimer la piste ?</div>
            <div className="mt-2 text-sm text-gray-700">Cette action est définitive.</div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl border bg-white px-4 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
                onClick={() => setConfirmDeletePersonCaseOpen(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
                disabled={personLoading}
                onClick={() => void onConfirmDeletePersonCase()}
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {navPickerTarget ? (
        <div
          className="absolute inset-0 z-[1200] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setNavPickerTarget(null)}
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
                  const waze = `https://waze.com/ul?ll=${navPickerTarget.lat}%2C${navPickerTarget.lng}&navigate=yes`;
                  window.open(waze, '_blank');
                  setNavPickerTarget(null);
                }}
                className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
                title="Waze"
              >
                <img src="/icon/waze.png" alt="Waze" className="h-12 w-12 object-contain" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const q = encodeURIComponent(`${navPickerTarget.lat},${navPickerTarget.lng}`);
                  const gmaps = `https://www.google.com/maps/search/?api=1&query=${q}`;
                  window.open(gmaps, '_blank');
                  setNavPickerTarget(null);
                }}
                className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
                title="Google Maps"
              >
                <img src="/icon/maps.png" alt="Google Maps" className="h-12 w-12 object-contain" />
              </button>
              {!isAndroid ? (
                <button
                  type="button"
                  onClick={() => {
                    const label = encodeURIComponent(navPickerTarget.title || 'Cible');
                    const apple = `http://maps.apple.com/?ll=${navPickerTarget.lat},${navPickerTarget.lng}&q=${label}`;
                    window.open(apple, '_blank');
                    setNavPickerTarget(null);
                  }}
                  className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
                  title="Plans (Apple)"
                >
                  <img src="/icon/apple.png" alt="Plans (Apple)" className="h-12 w-12 object-contain" />
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="fixed right-4 top-[calc(env(safe-area-inset-top)+16px)] z-[1000] flex flex-col gap-2 touch-none"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={centerOnMe}
          className={`h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white ${
            followMyBearing ? 'ring-1 ring-inset ring-blue-500/25' : ''
          }`}
          title={followMyBearing ? 'Suivre mon orientation' : 'Centrer sur moi'}
        >
          {followMyBearing ? (
            <Navigation2 className="mx-auto text-blue-600" size={20} />
          ) : (
            <Crosshair className="mx-auto text-gray-600" size={20} />
          )}
        </button>

        <button
          type="button"
          onClick={toggleMapStyle}
          className="h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Changer le fond de carte"
        >
          <Layers className="mx-auto text-gray-600" size={20} />
        </button>

        {canEditMap ? (
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
              className={activeTool === 'poi' ? 'mx-auto text-blue-600' : 'mx-auto text-gray-600'}
              size={20}
            />
          </button>
        ) : null}

        {role !== 'viewer' ? (
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

                  if (canEditMap && (activeTool === 'zone_circle' || activeTool === 'zone_polygon')) {
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
                {canEditMap ? (
                  <>
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
                  </>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div
          className={`relative w-12 overflow-hidden rounded-2xl bg-white/0 shadow backdrop-blur p-px transition-all duration-200 ${
            settingsMenuOpen
              ? `${isAdmin ? 'h-[274px]' : 'h-[216px]'} ring-1 ring-inset ring-black/10`
              : 'h-12 ring-0'
          }`}
        >
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setActionError(null);

                setSettingsMenuOpen((v) => !v);
                // Ouverture du menu = on considère la notification comme vue
                setSettingsNotification(false);
                if (selectedMissionId && personCase) {
                  setDismissedPersonCaseId(selectedMissionId, personCase.id);
                }
              }}
              className={`relative h-12 w-12 rounded-2xl border bg-white/90 inline-flex items-center justify-center transition-colors hover:bg-white ${
                settingsMenuOpen || scaleEnabled || labelsEnabled || personPanelOpen || timerModalOpen
                  ? 'ring-1 ring-inset ring-blue-500/25'
                  : ''
              }`}
              title="Settings"
            >
              <Settings
                className={
                  settingsMenuOpen || scaleEnabled || labelsEnabled || personPanelOpen || timerModalOpen
                    ? 'mx-auto text-blue-600'
                    : 'mx-auto text-gray-600'
                }
                size={20}
              />
              {settingsNotification ? (
                <span className="absolute right-1 top-1 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white" />
              ) : null}
            </button>

            <div
              className={`flex flex-col gap-2 transition-all duration-200 ${
                settingsMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'
              }`}
            >
              <button
                type="button"
                onClick={() => setScaleEnabled((v) => !v)}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                  scaleEnabled ? 'ring-blue-500/25' : 'ring-black/10'
                }`}
                title="Règle"
              >
                <Ruler className={scaleEnabled ? 'text-blue-600' : 'text-gray-600'} size={20} />
              </button>

              <button
                type="button"
                onClick={() => setLabelsEnabled((v) => !v)}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                  labelsEnabled ? 'ring-blue-500/25' : 'ring-black/10'
                }`}
                title="Tag"
              >
                <Tag className={labelsEnabled ? 'text-blue-600' : 'text-gray-600'} size={18} />
              </button>

              <button
                type="button"
                onClick={() => {
                  const map = mapInstanceRef.current;

                  setProjectionNotification(false);
                  if (selectedMissionId && personCase && !(user?.id && personCase.createdBy === user.id)) {
                    setDismissedPersonCaseId(selectedMissionId, personCase.id);
                  }

                  if (!personCase) {
                    if (!isAdmin) {
                      setNoProjectionToast(true);
                      return;
                    }
                    setPersonEdit(true);
                    setPersonPanelCollapsed(false);
                    setPersonPanelOpen(true);
                    return;
                  }

                  if (!isAdmin) {
                    setSettingsNotification(false);
                  }

                  if (personPanelOpen && personPanelCollapsed) {
                    setShowActiveVehicleTrack(false);
                    setPersonPanelOpen(false);
                    setPersonPanelCollapsed(false);
                    if (map && mapReady) applyHeatmapVisibility(map, false);
                    return;
                  }

                  if (personPanelOpen && !personPanelCollapsed) {
                    setShowActiveVehicleTrack(true);
                    setPersonEdit(false);
                    setPersonPanelCollapsed(true);
                    if (map && mapReady) {
                      applyHeatmapVisibility(map, showEstimationHeatmapRef.current);
                    }
                    return;
                  }

                  setPersonEdit(false);
                  setPersonPanelCollapsed(true);
                  setPersonPanelOpen(true);
                  setShowActiveVehicleTrack(true);
                  if (map && mapReady) {
                    applyHeatmapVisibility(map, showEstimationHeatmapRef.current);
                  }
                }}
                className={`relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                  personPanelOpen ? 'ring-blue-500/25' : 'ring-black/10'
                } ${!isAdmin && !personCase ? 'opacity-60' : ''}`}
                title="Activité"
              >
                <PawPrint className={personPanelOpen && personCase ? 'text-blue-600' : 'text-gray-600'} size={20} />
                {projectionNotification && !(user?.id && personCase?.createdBy === user.id) ? (
                  <span className="absolute right-1 top-1 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white" />
                ) : null}
              </button>

              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    const rs = mission?.traceRetentionSeconds ?? 3600;
                    setTimerSecondsInput(String(rs));
                    setTimerError(null);
                    setTimerModalOpen(true);
                  }}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ring-black/10"
                  title="Minuteur"
                >
                  <Timer className="text-gray-600" size={20} />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {false ? (
          <button
            type="button"
            onClick={() => {
              if (!selectedMissionId) return;
              const next = historyWindowSeconds + 3600;
              historyWindowUserSetRef.current = true;
              setHistoryWindowSeconds(next);
              const socket = socketRef.current;
              if (socket) {
                socket.emit('mission:join', { missionId: selectedMissionId, retentionSeconds: next });
              }
            }}
            className={`h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white ${
              historyWindowSeconds > 1800 ? 'ring-1 ring-inset ring-blue-500/25' : ''
            }`}
          >
            <span
              className={
                historyWindowSeconds > 1800
                  ? 'mx-auto block text-blue-600 text-sm font-semibold'
                  : 'mx-auto block text-gray-600 text-sm font-semibold'
              }
            >
              +1h
            </span>
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

      {personPanelOpen && personPanelCollapsed && !personEdit ? (
        <div
          className="fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),16px)+80px)] z-[1250]"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div
            className="rounded-3xl border bg-white/80 shadow-xl backdrop-blur p-3"
            onClick={() => setPersonPanelCollapsed(false)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-gray-700">
                  {personCase ? (
                    <>
                      <span className="font-semibold text-gray-800">Départ depuis</span>{' '}
                      <span>
                        {personCase.lastKnown?.query || '—'}
                      </span>
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-700">
                  {personCase && personCase.lastKnown?.when ? (
                    <>
                      <span>{new Date(personCase.lastKnown.when).toLocaleString()}</span>{' '}
                      <span className="text-gray-500">
                        ({formatElapsedSince(personCase.lastKnown.when)})
                      </span>
                    </>
                  ) : personLoading ? (
                    'Chargement…'
                  ) : (
                    '—'
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPersonPanelCollapsed(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                  title="Déployer"
                >
                  <ChevronUp size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : personPanelOpen ? (
        <div
          className="absolute inset-0 z-[1250] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setPersonPanelCollapsed(true)}
        >
          <div
            className={
              personEdit || !personCase
                ? 'w-full max-w-3xl max-h-[calc(100vh-48px)] flex flex-col rounded-3xl bg-white p-4 shadow-xl'
                : 'w-full max-w-3xl max-h-[calc(100vh-48px)] flex flex-col rounded-3xl bg-white p-4 shadow-xl'
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="text-base font-bold text-gray-900">Démarrer une piste</div>
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                  {!personEdit && personCase ? (
                    <button
                      type="button"
                      onClick={() => setPersonPanelCollapsed(true)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                      title="Réduire"
                    >
                      <ChevronDown size={16} />
                    </button>
                  ) : null}
                  {canEditPerson && !personEdit && personCase ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPersonPanelCollapsed(false);
                        setPersonEdit(true);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                      title="Modifier la fiche"
                    >
                      <Pencil size={16} />
                    </button>
                  ) : null}
                  {canEditPerson && !personEdit && personCase ? (
                    <button
                      type="button"
                      disabled={personLoading || !selectedMissionId}
                      onClick={async () => {
                        if (!selectedMissionId || !personCase) return;
                        setConfirmDeletePersonCaseOpen(true);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                      title="Supprimer la fiche"
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>

                {null}
              </div>
            </div>

            <div className="mt-3 grid flex-1 gap-3 overflow-y-auto pr-1">
              {personLoading ? <div className="text-sm text-gray-600">Chargement…</div> : null}
              {personError ? <div className="text-sm text-red-600">{personError}</div> : null}

              {!personEdit && personCase ? (
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-2xl border p-3">
                    <div className="text-xs font-semibold text-gray-700">Dernier indice</div>
                    <div className="mt-1 text-sm text-gray-900">
                      {personCase.lastKnown.type === 'poi' ? 'POI' : 'Adresse'}: {personCase.lastKnown.query}
                    </div>
                    {personCase.lastKnown.when ? (
                      <div className="mt-1 text-xs text-gray-600">Heure: {new Date(personCase.lastKnown.when).toLocaleString()}</div>
                    ) : null}
                    <div className="mt-1 text-xs text-gray-600">Déplacement: {mobilityLabel(personCase.mobility)}</div>
                  </div>
                  {normalizeMobility(personCase.mobility as any) === 'none' ? (
                    <div className="rounded-2xl border p-3">
                      <div className="text-xs font-semibold text-gray-700">Profil</div>
                      <div className="mt-1 text-sm text-gray-900">
                        Âge: {personCase.age ?? '—'}
                        {' · '}Sexe: {sexLabel(personCase.sex)}
                        {' · '}État: {personCase.healthStatus}
                      </div>
                      {Array.isArray(personCase.diseases) && personCase.diseases.length ? (
                        <div className="mt-1 text-xs text-gray-600">Maladies: {personCase.diseases.join(', ')}</div>
                      ) : null}
                      {Array.isArray(personCase.injuries) && personCase.injuries.length ? (() => {
                        const clean = cleanInjuries(personCase.injuries);
                        if (!clean.length) return null;
                        const labels = clean.map((inj) => {
                          if (inj.id === 'plaie') return 'Plaie membre inférieur';
                          return inj.id;
                        });
                        return (
                          <div className="mt-1 text-xs text-gray-600">
                            Blessures: {labels.join(', ')}
                          </div>
                        );
                      })() : null}
                    </div>
                  ) : null}

                  <div className="rounded-2xl border p-3">
                    <div className="text-xs font-semibold text-gray-700">Météo (sur le dernier point)</div>
                    {weatherLoading ? <div className="mt-1 text-sm text-gray-600">Chargement météo…</div> : null}
                    {weatherError ? <div className="mt-1 text-sm text-red-600">Météo indisponible</div> : null}
                    {!weatherLoading && !weatherError && weather ? (
                      <div className="mt-1 text-sm text-gray-900">
                        {weatherStatusLabel(weather.weatherCode)}
                        {' · '}{typeof weather.temperatureC === 'number' ? `${weather.temperatureC.toFixed(1)}°C` : '—'}
                        {' · '}Vent {typeof weather.windSpeedKmh === 'number' ? `${weather.windSpeedKmh.toFixed(0)} km/h` : '—'}
                      </div>
                    ) : null}
                  </div>

                  {estimation && !hasActiveTestVehicleTrack ? (
                    <div className="rounded-2xl border p-3 md:col-span-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-gray-700">Estimation</div>
                      </div>
                      <div className="mt-1 text-sm text-gray-900">
                        Rayon probable: ~{estimation.probableKm.toFixed(1)} km
                        <br />
                        Max: ~{estimation.maxKm.toFixed(1)} km
                      </div>
                      <div className="mt-1 text-xs text-gray-600">
                        Vitesse estimée: ~{estimation.effectiveKmh.toFixed(1)} km/h
                        {estimation.hoursSince === null ? '' : (
                          <>
                            <br />
                            Temps écoulé: {formatHoursToHM(estimation.hoursSince)}
                          </>
                        )}
                      </div>

                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {estimation.needs.length ? (
                          <div>
                            <div className="text-[11px] font-semibold text-gray-600">Besoins prioritaires</div>
                            <div className="mt-1 grid gap-1">
                              {estimation.needs.map((n) => (
                                <div key={n} className="text-xs text-gray-700">
                                  - {n}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {estimation.likelyPlaces.length ? (
                          <div>
                            <div className="text-[11px] font-semibold text-gray-600">Lieux probables</div>
                            <div className="mt-1 grid gap-1">
                              {estimation.likelyPlaces.map((p) => (
                                <div key={p} className="text-xs text-gray-700">
                                  - {p}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                </div>
              ) : canEditPerson ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="relative">
                      <div className="text-xs font-semibold text-gray-700">Dernière position connue</div>
                      <input
                        type="text"
                        value={personDraft.lastKnownQuery}
                        onChange={(e) =>
                          setPersonDraft((p) => ({
                            ...p,
                            lastKnownQuery: e.target.value,
                            lastKnownType: 'address',
                            lastKnownPoiId: undefined,
                            lastKnownLng: undefined,
                            lastKnownLat: undefined,
                          }))
                        }
                        onFocus={() => setLastKnownSuggestionsOpen(true)}
                        onBlur={() => window.setTimeout(() => setLastKnownSuggestionsOpen(false), 150)}
                        placeholder="Soit un POI soit une adresse"
                        className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                      />

                      {lastKnownSuggestionsOpen &&
                      (lastKnownPoiSuggestions.length > 0 || lastKnownAddressSuggestions.length > 0) ? (
                        <div className="absolute left-0 right-0 top-[72px] z-10 rounded-2xl border bg-white shadow">
                          {lastKnownPoiSuggestions.length > 0 ? (
                            <div className="border-b p-2">
                              <div className="px-2 pb-1 text-[11px] font-semibold text-gray-600">POI</div>
                              <div className="grid gap-1">
                                {lastKnownPoiSuggestions.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className="rounded-xl px-2 py-2 text-left text-sm hover:bg-gray-50"
                                    onClick={() => {
                                      setPersonDraft((prev) => ({
                                        ...prev,
                                        lastKnownType: 'poi',
                                        lastKnownQuery: p.title,
                                        lastKnownPoiId: p.id,
                                        lastKnownLng: p.lng,
                                        lastKnownLat: p.lat,
                                      }));
                                      setLastKnownSuggestionsOpen(false);
                                    }}
                                  >
                                    {p.title}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {lastKnownAddressSuggestions.length > 0 ? (
                            <div className="p-2">
                              <div className="px-2 pb-1 text-[11px] font-semibold text-gray-600">Adresse</div>
                              <div className="grid gap-1">
                                {lastKnownAddressSuggestions.map((a) => (
                                  <button
                                    key={`${a.label}-${a.lng}-${a.lat}`}
                                    type="button"
                                    className="rounded-xl px-2 py-2 text-left text-sm hover:bg-gray-50"
                                    onClick={() => {
                                      setPersonDraft((prev) => ({
                                        ...prev,
                                        lastKnownType: 'address',
                                        lastKnownQuery: a.label,
                                        lastKnownPoiId: undefined,
                                        lastKnownLng: a.lng,
                                        lastKnownLat: a.lat,
                                      }));
                                      setLastKnownSuggestionsOpen(false);
                                    }}
                                  >
                                    {a.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div
                      onClick={() => {
                        if (hasActiveTestVehicleTrack) return;
                        const el = lastKnownWhenInputRef.current;
                        if (!el) return;
                        // showPicker est supporté par la plupart des navigateurs modernes
                        if (typeof (el as any).showPicker === 'function') {
                          (el as any).showPicker();
                        } else {
                          el.focus();
                        }
                      }}
                      className="cursor-pointer"
                    >
                      <div className="text-xs font-semibold text-gray-700">Date / heure</div>
                      <input
                        ref={lastKnownWhenInputRef}
                        type="datetime-local"
                        value={personDraft.lastKnownWhen}
                        max={nowLocalMinute}
                        disabled={hasActiveTestVehicleTrack}
                        onChange={(e) =>
                          setPersonDraft((p) => ({
                            ...p,
                            lastKnownWhen: e.target.value,
                          }))
                        }
                        className="mt-1 h-10 w-full rounded-2xl border px-3 text-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-gray-700">Mode de déplacement</div>
                    <select
                      value={personDraft.mobility}
                      onChange={(e) => setPersonDraft((p) => ({ ...p, mobility: e.target.value as any }))}
                      className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                    >
                      <option value="none">À pied</option>
                      <option value="bike_test">Vélo</option>
                      <option value="scooter_test">Scooter</option>
                      <option value="motorcycle_test">Moto</option>
                      <option value="car_test">Voiture</option>
                      <option value="truck_test">Camion</option>
                    </select>
                  </div>
                  {normalizeMobility(personDraft.mobility as any) === 'none' ? (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <div className="text-xs font-semibold text-gray-700">Âge</div>
                          <input
                            type="number"
                            min={0}
                            max={120}
                            value={personDraft.age}
                            onChange={(e) => setPersonDraft((p) => ({ ...p, age: e.target.value }))}
                            className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                          />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-700">Sexe</div>
                          <select
                            value={personDraft.sex}
                            onChange={(e) => setPersonDraft((p) => ({ ...p, sex: e.target.value as any }))}
                            className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                          >
                            <option value="unknown">Inconnu</option>
                            <option value="female">Femme</option>
                            <option value="male">Homme</option>
                          </select>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-700">État</div>
                          <select
                            value={personDraft.healthStatus}
                            onChange={(e) => setPersonDraft((p) => ({ ...p, healthStatus: e.target.value as any }))}
                            className="mt-1 h-10 w-full rounded-2xl border px-3 text-sm"
                          >
                            <option value="stable">Stable</option>
                            <option value="fragile">Fragile</option>
                            <option value="critique">Critique</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex flex-col gap-3 md:flex-row md:items-start">
                        <div className="rounded-2xl border p-3 md:flex-1">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between text-left"
                            onClick={() => setDiseasesOpen((v) => !v)}
                          >
                            <div className="text-xs font-semibold text-gray-700">Maladies connues</div>
                            <span className="text-xs text-gray-500">{diseasesOpen ? 'Masquer' : 'Afficher'}</span>
                          </button>
                          {diseasesOpen ? (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              {diseaseOptions.map((id) => {
                                const checked = personDraft.diseases.includes(id);
                                const raw = id.replace(/_/g, ' ');
                                const label = raw.replace(/\b\w/g, (c) => c.toUpperCase());
                                return (
                                  <div key={id} className="rounded-2xl border p-2">
                                    <label className="flex items-center gap-2 text-sm text-gray-800">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          const next = e.target.checked
                                            ? Array.from(new Set([...personDraft.diseases, id]))
                                            : personDraft.diseases.filter((x) => x !== id);
                                          setPersonDraft((p) => ({ ...p, diseases: next }));
                                        }}
                                      />
                                      <span className="font-normal">{label}</span>
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>

                        <div className="rounded-2xl border p-3 md:flex-1">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between text-left"
                            onClick={() => setInjuriesOpen((v) => !v)}
                          >
                            <div className="text-xs font-semibold text-gray-700">Blessures</div>
                            <span className="text-xs text-gray-500">{injuriesOpen ? 'Masquer' : 'Afficher'}</span>
                          </button>
                          {injuriesOpen ? (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              {injuryOptions.map((injuryId) => {
                                const injury = personDraft.injuries.find((x) => x.id === injuryId);
                                const checked = !!injury;
                                return (
                                  <div key={injuryId} className="rounded-2xl border p-2">
                                    <label className="flex items-center gap-2 text-sm text-gray-800">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          if (e.target.checked) {
                                            setPersonDraft((p) => ({
                                              ...p,
                                              injuries: [...p.injuries, { id: injuryId, locations: [] }],
                                            }));
                                          } else {
                                            setPersonDraft((p) => ({
                                              ...p,
                                              injuries: p.injuries.filter((x) => x.id !== injuryId),
                                            }));
                                          }
                                        }}
                                      />
                                      <span className="font-normal">
                                        {injuryId
                                          .replace(/_/g, ' ')
                                          .replace(/\b\w/g, (c) => c.toUpperCase())}
                                      </span>
                                    </label>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : null}

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      disabled={personLoading}
                      onClick={() => {
                        if (personCase) {
                          setPersonEdit(false);
                          const last = personCase.lastKnown;
                          const cleanDis = cleanDiseases(personCase.diseases ?? []);
                          const cleanInj = cleanInjuries(personCase.injuries ?? []);
                          setPersonDraft({
                            lastKnownQuery: last.query,
                            lastKnownType: last.type,
                            lastKnownPoiId: last.poiId,
                            lastKnownLng:
                              typeof last.lng === 'number' ? last.lng : undefined,
                            lastKnownLat:
                              typeof last.lat === 'number' ? last.lat : undefined,
                            lastKnownWhen: last.when ? last.when.slice(0, 16) : '',
                            mobility: personCase.mobility,
                            age:
                              typeof personCase.age === 'number'
                                ? String(personCase.age)
                                : '',
                            sex: personCase.sex ?? 'unknown',
                            healthStatus: personCase.healthStatus ?? 'stable',
                            diseases: cleanDis,
                            diseasesFreeText: personCase.diseasesFreeText ?? '',
                            injuries: cleanInj.map((x) => ({
                              id: x.id,
                              locations: x.locations,
                            })),
                            injuriesFreeText: personCase.injuriesFreeText ?? '',
                          });
                        } else {
                          setPersonPanelOpen(false);
                        }
                      }}
                      className="h-11 rounded-2xl border bg-white text-sm font-semibold text-gray-700 disabled:opacity-50"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      disabled={
                        personLoading ||
                        !selectedMissionId ||
                        !personDraft.lastKnownWhen ||
                        !(personDraft.lastKnownQuery ?? '').trim() ||
                        !personDraft.mobility
                      }
                      onClick={async () => {
                        if (!selectedMissionId) return;

                        const address = (personDraft.lastKnownQuery ?? '').trim();
                        if (!address) {
                          setPersonError('Adresse requise');
                          return;
                        }
                        if (!personDraft.lastKnownWhen) {
                          setPersonError('Date / heure requise');
                          return;
                        }

                        try {
                          const dt = new Date(personDraft.lastKnownWhen);
                          if (!Number.isNaN(dt.getTime()) && dt.getTime() > Date.now()) {
                            setPersonError("Date / heure ne peut pas être dans le futur");
                            return;
                          }
                        } catch {
                          // ignore
                        }
                        if (!personDraft.mobility) {
                          setPersonError('Mode de déplacement requis');
                          return;
                        }

                        setPersonLoading(true);
                        setPersonError(null);
                        try {
                          const ageTrimmed = personDraft.age.trim();
                          const ageParsed = ageTrimmed ? Number(ageTrimmed) : undefined;
                          const mobilityUi = personDraft.mobility as any as MobilityUi;
                          const mobility = normalizeMobility(mobilityUi);
                          const payload = {
                            lastKnown: {
                              type: personDraft.lastKnownType,
                              query: address,
                              poiId: personDraft.lastKnownPoiId,
                              lng: personDraft.lastKnownLng,
                              lat: personDraft.lastKnownLat,
                              when: personDraft.lastKnownWhen
                                ? new Date(personDraft.lastKnownWhen).toISOString()
                                : undefined,
                            },
                            mobility,
                            age: Number.isFinite(ageParsed as any)
                              ? Math.floor(ageParsed as number)
                              : undefined,
                            sex: personDraft.sex,
                            healthStatus: personDraft.healthStatus,
                            diseases: cleanDiseases(personDraft.diseases) as string[],
                            injuries: cleanInjuries(personDraft.injuries) as any,
                            diseasesFreeText: personDraft.diseasesFreeText,
                            injuriesFreeText: personDraft.injuriesFreeText,
                          };

                          const saved = await upsertPersonCase(selectedMissionId, payload);
                          setPersonCase(saved.case);
                          setPersonEdit(false);

                          if (isMobilityTest(mobilityUi) && canEditPerson) {
                            const whenIso = personDraft.lastKnownWhen
                              ? new Date(personDraft.lastKnownWhen).toISOString()
                              : undefined;
                            const vehicleType =
                              mobilityUi === 'motorcycle_test'
                                ? 'motorcycle'
                                : mobilityUi === 'scooter_test'
                                  ? 'scooter'
                                  : mobilityUi === 'bike_test'
                                    ? 'motorcycle'
                                  : mobilityUi === 'truck_test'
                                    ? 'truck'
                                    : 'car';
                            try {
                              const created = await createVehicleTrack(selectedMissionId, {
                                label:
                                  mobilityUi === 'motorcycle_test'
                                    ? 'Moto'
                                  : mobilityUi === 'scooter_test'
                                      ? 'Scooter'
                                      : mobilityUi === 'bike_test'
                                        ? 'Vélo'
                                      : mobilityUi === 'truck_test'
                                        ? 'Camion'
                                        : 'Voiture',
                                vehicleType: vehicleType as any,
                                origin: {
                                  type: personDraft.lastKnownType,
                                  query: address,
                                  poiId: personDraft.lastKnownPoiId,
                                  lng: personDraft.lastKnownLng,
                                  lat: personDraft.lastKnownLat,
                                  when: whenIso,
                                },
                                algorithm: 'road_graph',
                              });

                              const createdTrack = created.track;
                              if (createdTrack && createdTrack.id) {
                                setActiveVehicleTrackId(createdTrack.id);
                                try {
                                  const state = await getVehicleTrackState(selectedMissionId, createdTrack.id);
                                  if (state.cache?.payloadGeojson) {
                                    const provider = (state.cache.meta as any)?.provider as string | undefined;
                                    const isTest = isTestTrack(createdTrack as any);
                                    const allowTomtom =
                                      provider === 'tomtom_reachable_range' ||
                                      provider === 'tomtom_reachable_range_fallback_circle';
                                    if (!isTest || allowTomtom) {
                                      setVehicleTrackGeojsonById((prev) => ({
                                        ...prev,
                                        [createdTrack.id]: state.cache!.payloadGeojson as any,
                                      }));
                                    }
                                  }
                                } catch {
                                  // ignore state loading error
                                }
                              }
                            } catch {
                              // création de piste non bloquante pour la fiche personne
                            }
                          }
                        } catch (e: any) {
                          setPersonError(e?.message ?? 'Erreur');
                        } finally {
                          setPersonLoading(false);
                        }
                      }}
                      className="h-11 rounded-2xl bg-blue-600 text-sm font-semibold text-white shadow disabled:opacity-50"
                    >
                      Enregistrer
                    </button>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border p-3">
                  <div className="text-sm font-semibold text-gray-900">Aucune fiche personne</div>
                  <div className="mt-1 text-sm text-gray-600">Vous avez un accès en lecture seule.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
                className="h-11 w-full rounded-2xl bg-blue-600 text-sm font-semibold text-white shadow"
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {noProjectionToast ? (
        <div className="pointer-events-none fixed inset-0 z-[1400] flex items-center justify-center p-4">
          <div className="pointer-events-auto max-w-sm rounded-2xl bg-gray-900/90 px-4 py-3 text-xs text-white shadow-lg backdrop-blur">
            Aucune piste n'est active pour cette mission.
          </div>
        </div>
      ) : null}

      {roadGraphWarmingUp ? (
        <div className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+12px)] left-1/2 z-[1400] -translate-x-1/2 px-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-2xl bg-gray-900/90 px-4 py-3 text-xs text-white shadow-lg backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Chargement en cours</span>
          </div>
        </div>
      ) : null}

      {activityToast ? (
        <div className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+12px)] left-1/2 z-[1400] -translate-x-1/2 px-4">
          <div
            className={`pointer-events-auto w-[min(100vw-32px,1600px)] rounded-2xl bg-gray-900/90 px-6 py-3 text-sm text-white shadow-lg backdrop-blur transition-opacity duration-300 ${
              activityToastVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {activityToast}
          </div>
        </div>
      ) : null}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMapInstance, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CameraPopup, type SelectedCamera } from './CameraPopup';
import { ConfirmDeletePersonCaseModal } from './ConfirmDeletePersonCaseModal';
import { MapRightToolbar } from './MapRightToolbar';
import { NavPickerModal } from './NavPickerModal';
import { getPoiIconComponent, PoiPopup } from './PoiPopup';
import { PersonPanelCollapsedBar } from './PersonPanelCollapsedBar';
import { PersonPanelOverlay } from './PersonPanelOverlay';
import { TimerModal } from './TimerModal';
import { ValidationModal } from './ValidationModal';
import {
  AlertTriangle,
  Bike,
  Binoculars,
  Bomb,
  Car,
  Cctv,
  Church,
  Coffee,
  Crosshair,
  Dog,
  Flag,
  Flame,
  HelpCircle,
  House,
  Loader2,
  Mic,
  PawPrint,
  Radiation,
  ShieldPlus,
  Siren,
  Skull,
  Truck,
  UserRound,
  Warehouse,
  Zap,
} from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAuth } from '../contexts/AuthContext';
import { useMission } from '../contexts/MissionContext';
import { useGridView } from '../contexts/GridViewContext';
import { useZoneAssignments } from '../hooks/useZoneAssignments';
import { isTestTrack, useVehicleTrack } from '../hooks/useVehicleTrack';
import { useMapDraft } from '../hooks/useMapDraft';
import { useBaptism } from '../hooks/useBaptism';
import { AXIS_PALETTE, destinationPoint, type BaptismIcon } from '../lib/baptismAxes';
import {
  formatElapsedSince,
  formatHoursToHM,
  mobilityLabel,
  sexLabel,
  usePersonCase,
  weatherStatusLabel,
} from '../hooks/usePersonCase';
import { getSocket } from '../lib/socket';
import { roundCoord, shouldEmitPosition } from '../lib/gpsFilter.js';
import {
  circleToPolygon,
  clipGridColumn,
  clipGridRow,
  formatGridCellId,
  getZoneBbox,
  getZoneGridFrame,
  gridCellBounds,
  gridColumnLetter,
  isCellInGrid,
  isPointInZone,
  parseGridCellId,
  pickGridCell,
} from '../lib/zoneGeometry.js';
import {
  createPoi,
  createZone,
  deletePoi,
  deleteZone,
  getMission,
  listMissionMembers,
  listPois,
  listZones,
  upsertPersonCase,
  updatePoi,
  updateZone,
  updateMission,
  assignZoneToUsers,
  unassignZoneFromUser,
  createVehicleTrack,
  getVehicleTrackState,
  type ApiMission,
  type ApiPoi,
  type ApiZone,
  type ApiMissionMember,
} from '../lib/api';
import { useConfirmDialog } from './ConfirmDialog';
import { cleanDiseases, cleanInjuries } from '../lib/estimationWalking';

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

function getPolygonCenter(coords: [number, number][]): { lng: number; lat: number } {
  let x = 0;
  let y = 0;
  for (const [lng, lat] of coords) {
    x += lng;
    y += lat;
  }
  return { lng: x / coords.length, lat: y / coords.length };
}

function getGridCellSelection(lng: number, lat: number, z: ApiZone) {
  const frame = getZoneGridFrame(z);
  if (!frame) return null;
  const cell = pickGridCell(frame, lng, lat);
  if (!cell) return null;
  const bounds = gridCellBounds(frame, cell.row, cell.col);
  if (!bounds) return null;
  const text = formatGridCellId(cell.row, cell.col);
  return {
    id: `${z.id}:grid:${text}`,
    text,
    geometry: {
      type: 'Polygon',
      coordinates: [bounds.ring],
    },
  };
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

// Source unique de vérité pour les propriétés attachées aux features de la source `pois`:
// la couche `pois-labels` lit `title`, la couche `pois` lit `color`, et les popups lisent
// `id`/`type`/`icon`/`comment`. Tout écrivain de la source doit passer par ici.
function buildPoisFeatureCollection(pois: ApiPoi[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pois.map((p) => ({
      type: 'Feature',
      properties: { id: p.id, type: p.type, title: p.title, icon: p.icon, color: p.color, comment: p.comment },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    })) as any,
  };
}

const BAPTISM_EMOJI: Record<BaptismIcon, string> = { person: '🚶', car: '🚗', house: '🏠' };

function makeBaptismEl(icon: BaptismIcon, dashed: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = BAPTISM_EMOJI[icon];
  el.style.cssText = `font-size:20px;line-height:1;background:#fff;border-radius:9999px;padding:6px;border:2px ${dashed ? 'dashed #6b7280' : 'solid #111827'};box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer;`;
  return el;
}

export default function MapLibreMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapLibreMapInstance | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ lng: number; lat: number; t: number } | null>(null);
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
  const baptismMarkerRef = useRef<maplibregl.Marker | null>(null);
  const baptismDraftMarkerRef = useRef<maplibregl.Marker | null>(null);

  const otherColorsRef = useRef<Record<string, string>>({});
  const otherTracesRef = useRef<Record<string, { lng: number; lat: number; t: number }[]>>({});
  const persistSelfTraceTimeoutRef = useRef<number | null>(null);
  const persistOthersTraceTimeoutRef = useRef<number | null>(null);

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
  const [selectedCamera, setSelectedCamera] = useState<SelectedCamera | null>(null);
  const [navPickerTarget, setNavPickerTarget] = useState<{ lng: number; lat: number; title: string } | null>(null);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [mapReady, setMapReady] = useState(false);
  // Miroir de mapReady lisible depuis les closures longue durée (listeners MapLibre).
  const mapReadyRef = useRef(false);
  const [hiddenUserIds, setHiddenUserIds] = useState<Record<string, true>>({});
  // Compteur de version du style de carte pour forcer la resynchro des overlays (dont la zone d'estimation)
  const [styleVersion, setStyleVersion] = useState(0);

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

  const [baseStyleIndex, setBaseStyleIndex] = useState(0);

  const [trackingEnabled] = useState(true);

  const [zoneMenuOpen, setZoneMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);

  useEffect(() => {
    if (!selectedPoi) return;
    const next = pois.find((p) => p.id === selectedPoi.id);
    if (!next) return;
    if (next === selectedPoi) return;
    setSelectedPoi(next);
  }, [pois, selectedPoi]);

  const [labelsEnabled, setLabelsEnabled] = useState(false);
  const [scaleEnabled, setScaleEnabled] = useState(false);

  const [camerasEnabled, setCamerasEnabled] = useState(false);
  const camerasEnabledRef = useRef(camerasEnabled);
  useEffect(() => {
    camerasEnabledRef.current = camerasEnabled;
  }, [camerasEnabled]);

  const camerasGeojsonRef = useRef<any>({ type: 'FeatureCollection', features: [] });
  const camerasAbortRef = useRef<AbortController | null>(null);
  const camerasDebounceRef = useRef<number | null>(null);

  const labelsEnabledRef = useRef(labelsEnabled);
  useEffect(() => {
    labelsEnabledRef.current = labelsEnabled;
  }, [labelsEnabled]);

  useEffect(() => {
    mapReadyRef.current = mapReady;
  }, [mapReady]);

  // road_graph est désactivé pour l'instant : on ne montre plus le bandeau de chargement.
  const roadGraphWarmingUp = false;

  const poiColorOptions = useMemo(
    () => [
      '#ef4444',
      '#f97316',
      '#f59e0b',
      '#fde047',
      '#84cc16',
      '#10b981',
      '#3b82f6',
      '#6366f1',
      '#1e3a8a',
      '#a855f7',
      '#ec4899',
      '#9f1239',
      '#dc6b4a',
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
  const { user } = useAuth();
  const { selectedMissionId } = useMission();
  const { mode, selectedZoneIds, highlightedZoneIds, toggle, toggleSelection, resetBadge } = useGridView();
  const { assignmentsByZoneId, refetch: refetchAssignments } = useZoneAssignments(selectedMissionId);
  const baptismApi = useBaptism({ selectedMissionId });
  const [editingAxisId, setEditingAxisId] = useState<string | null>(null);
  const [baptismMenuOpen, setBaptismMenuOpen] = useState(false);
  const [baptismPanelOpen, setBaptismPanelOpen] = useState(false);
  // Déclaré ici (et non avec les autres états de toast plus bas) parce que useVehicleTrack
  // en a besoin et que ses valeurs de retour sont lues plus haut dans le rendu.
  const [activityToast, setActivityToast] = useState<string | null>(null);
  const {
    hasActiveTestVehicleTrack,
    setActiveVehicleTrackId,
    setShowActiveVehicleTrack,
    setVehicleTrackGeojsonById,
    deleteAllVehicleTracks,
    ensureVehicleTrackLayers,
    reinjectVehicleTrackData,
  } = useVehicleTrack({
    mapInstanceRef,
    mapReady,
    styleVersion,
    selectedMissionId,
    setActivityToast,
  });
  const [zoneAssignmentMembers, setZoneAssignmentMembers] = useState<ApiMissionMember[]>([]);
  const [zoneAssignmentSelectedMemberId, setZoneAssignmentSelectedMemberId] = useState('');

  const creatorLabel = (() => {
    if (!selectedPoi?.createdBy) return 'Créé par inconnu';
    const id = selectedPoi.createdBy as string;
    const name = buildUserDisplayName(id);
    return `Créé par ${name}`;
  })();

  const selectedGridCellAssignments = useMemo(() => {
    return selectedZoneIds.flatMap((selectionId) => {
      const zoneId = selectionId.split(':')[0];
      const isGrid = selectionId.includes(':grid:');
      const gridCellId = isGrid ? selectionId.split(':').slice(2).join(':') : undefined;
      const assignments = assignmentsByZoneId.get(zoneId) ?? [];
      return assignments
        .filter(a => isGrid ? a.gridCellId === gridCellId : !a.gridCellId)
        .map(a => ({
          selectionId,
          zoneId,
          gridCellId: a.gridCellId,
          userId: a.userId,
          name: buildUserDisplayName(a.userId),
          color: memberColors[a.userId] ?? '#3b82f6',
        }));
    });
  }, [selectedZoneIds, assignmentsByZoneId, memberColors, memberNames, user?.id, user?.displayName]);

  useEffect(() => {
    if (!selectedMissionId) {
      setZoneAssignmentMembers([]);
      setZoneAssignmentSelectedMemberId('');
      return;
    }

    let alive = true;
    listMissionMembers(selectedMissionId)
      .then((members) => {
        if (!alive) return;
        setZoneAssignmentMembers(members.filter((m) => m.isActive));
      })
      .catch(() => {
        if (!alive) return;
        setZoneAssignmentMembers([]);
      });

    return () => {
      alive = false;
    };
  }, [selectedMissionId]);

  const onCloseTimerModal = useCallback(() => {
    setTimerModalOpen(false);
  }, []);

  const onSaveTimerModal = useCallback(() => {
    void onSaveTraceRetentionSeconds();
  }, [onSaveTraceRetentionSeconds]);

  const onClosePoiPopup = useCallback(() => {
    setSelectedPoi(null);
  }, []);

  const onNavigateToPoi = useCallback(() => {
    if (!selectedPoi) return;
    setNavPickerTarget({ lng: selectedPoi.lng, lat: selectedPoi.lat, title: selectedPoi.title || 'POI' });
  }, [selectedPoi]);

  const onStartTrackFromPoi = useCallback(() => {
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
    }));

    setPersonEdit(true);
    setPersonPanelCollapsed(false);
    setPersonPanelOpen(true);
    setShowActiveVehicleTrack(true);

    setSelectedPoi(null);
  }, [hasActiveTestVehicleTrack, selectedPoi]);

  const onEditPoi = useCallback(() => {
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
  }, [selectedPoi]);

  const onDeletePoi = useCallback(async () => {
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
  }, [confirmDialog, selectedMissionId, selectedPoi]);

  const onCloseCameraPopup = useCallback(() => {
    setSelectedCamera(null);
  }, []);

  const onCloseNavPicker = useCallback(() => {
    setNavPickerTarget(null);
  }, []);

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

  const {
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
    weather,
    weatherLoading,
    weatherError,
    estimation,
    showEstimationHeatmap,
    applyHeatmapVisibility,
    syncHeatmapVisibility,
    ensurePersonEstimationLayers,
    onExpandPersonPanel,
    onCancelDeletePersonCase,
    onConfirmDeletePersonCaseClick,
  } = usePersonCase({
    mapInstanceRef,
    mapReady,
    styleVersion,
    selectedMissionId,
    mission,
    canEditPerson,
    pois,
    deleteAllVehicleTracks,
    setActivityToast,
    currentUserId: user?.id ?? null,
    buildUserDisplayName,
  });

  // Notifications settings (pour utilisateurs / visualisateurs)
  const [settingsNotification, setSettingsNotification] = useState(false);

  // Notification settings quand il y a des assignations de zones/cellules
  useEffect(() => {
    if (!selectedMissionId) return;
    let hasAssignments = false;
    for (const assignments of assignmentsByZoneId.values()) {
      if (assignments.length > 0) {
        hasAssignments = true;
        break;
      }
    }
    if (hasAssignments) {
      setSettingsNotification(true);
    }
  }, [assignmentsByZoneId, selectedMissionId, setSettingsNotification]);

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

  // Toast discret pour informer qu'aucune projection n'est active
  const [noProjectionToast, setNoProjectionToast] = useState(false);

  const [activityToastVisible, setActivityToastVisible] = useState(false);
  const activityToastTimerRef = useRef<number | null>(null);
  const activityToastHideRef = useRef<number | null>(null);
  const lastNoCameraToastAtRef = useRef<number>(0);

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
          if (!user?.id || user.id !== actorUserId) {
            setActivityToast(`${name} vient de passer le temps de suivi de ${prev} secondes à ${nextRetention} secondes`);
          }
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
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13), duration: 800 });
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
  // Debounced to avoid blocking the main thread on every position update.
  useEffect(() => {
    if (!selectedMissionId || !user?.id) return;
    const key = `geogn.trace.self.${selectedMissionId}.${user.id}`;

    if (persistSelfTraceTimeoutRef.current !== null) {
      window.clearTimeout(persistSelfTraceTimeoutRef.current);
    }
    persistSelfTraceTimeoutRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(tracePoints));
      } catch {
        // storage might be full; ignore
      }
    }, 1500);

    return () => {
      if (persistSelfTraceTimeoutRef.current !== null) {
        window.clearTimeout(persistSelfTraceTimeoutRef.current);
        persistSelfTraceTimeoutRef.current = null;
      }
    };
  }, [tracePoints, selectedMissionId, user?.id]);

  // Persist others traces for this mission based on the ref, whenever positions update.
  // Debounced to avoid blocking the main thread on every position update.
  useEffect(() => {
    if (!selectedMissionId) return;
    const key = `geogn.trace.others.${selectedMissionId}`;

    if (persistOthersTraceTimeoutRef.current !== null) {
      window.clearTimeout(persistOthersTraceTimeoutRef.current);
    }
    persistOthersTraceTimeoutRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(otherTracesRef.current));
      } catch {
        // ignore storage errors
      }
    }, 1500);

    return () => {
      if (persistOthersTraceTimeoutRef.current !== null) {
        window.clearTimeout(persistOthersTraceTimeoutRef.current);
        persistOthersTraceTimeoutRef.current = null;
      }
    };
  }, [selectedMissionId, othersActivityTick]);

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
  }, [labelsEnabled, mapReady, baseStyleIndex]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    const visibility = camerasEnabled ? 'visible' : 'none';
    try {
      if (map.getLayer('cameras')) map.setLayoutProperty('cameras', 'visibility', visibility);
      if (map.getLayer('cameras-labels')) map.setLayoutProperty('cameras-labels', 'visibility', visibility);
    } catch {
      // ignore
    }
  }, [camerasEnabled, mapReady, baseStyleIndex]);

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
  }, [mapReady, labelsEnabled, baseStyleIndex]);

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
  }, [mapReady, baseStyleIndex]);

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
  }, [mapReady, baseStyleIndex]);

  useEffect(() => {
    const onMapVisible = () => {
      if (mapReady && mapInstanceRef.current) {
        mapInstanceRef.current.resize();
      }
    };
    window.addEventListener('geogn:map:visible', onMapVisible);
    return () => {
      window.removeEventListener('geogn:map:visible', onMapVisible);
    };
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
          'OpenStreetMap contributors'
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
          'OpenStreetMap contributors CARTO'
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
          'OpenStreetMap contributors CARTO'
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
          'OpenStreetMap contributors, SRTM | Map style: OpenTopoMap (CC-BY-SA)'
        ),
      },
    ],
    []
  );

  const currentBaseStyle = useMemo(() => {
    const style = baseStyles[baseStyleIndex]?.style;
    return style ? cloneStyle(style) : undefined;
  }, [baseStyleIndex, baseStyles]);

  // Brouillon (POI/zone en cours de placement). Appelé ici, et non avec les autres
  // hooks en haut du composant, parce qu'il a besoin de `currentBaseStyle` comme
  // dépendance d'effet; ses valeurs de retour ne sont lues que plus bas (ou depuis
  // des closures), sauf `setActionBusy`/`setActionError` utilisés par onDeletePoi.
  const {
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
  } = useMapDraft({
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
    currentUserId: user?.id ?? null,
  });

  // Baptême terrain: annule aussi le brouillon baptême quand la toolbar bascule sur un
  // autre outil (POI/zone) ou coupe l'outil courant, sinon le marqueur de brouillon et
  // les axes resteraient affichés alors que activeTool n'est déjà plus 'baptism'.
  const cancelAnyDraft = useCallback(() => {
    if (activeTool === 'baptism') baptismApi.cancelDraft();
    cancelDraft();
  }, [activeTool, baptismApi, cancelDraft]);

  const onStartBaptism = useCallback(
    async (icon: BaptismIcon) => {
      if (baptismApi.baptism) {
        const ok = await confirmDialog({
          title: 'Remplacer le baptême actuel ?',
          message: 'Un baptême existe déjà pour cette mission. Le repositionner remplacera ses axes.',
          confirmText: 'Remplacer',
          cancelText: 'Annuler',
          variant: 'danger',
        });
        if (!ok) return;
      }
      cancelDraft();
      // Les panneaux (top-16 avant, bottom-24 depuis la feuille du bas) collisionneraient
      // avec la barre de confirmation du brouillon s'ils restaient ouverts pendant le
      // repositionnement d'un baptême existant.
      setEditingAxisId(null);
      setBaptismPanelOpen(false);
      baptismApi.startPlacing(icon);
      setActiveTool('baptism');
    },
    [baptismApi, cancelDraft, confirmDialog, setActiveTool]
  );

  // Dernier style réellement appliqué à la carte (à la création ou via setStyle),
  // pour éviter un setStyle redondant au premier rendu.
  const appliedStyleRef = useRef<unknown>(null);

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

    // Others traces should remain underneath my own trace.
    safeMoveToTop('others-traces-line');
    safeMoveToTop('trace-line');
    safeMoveToTop('others-points');
    safeMoveToTop('others-points-inactive-dot');
    safeMoveToTop('others-labels');
    safeMoveToTop('zones-labels');

    // Caméras au-dessus des zones/POI/labels
    safeMoveToTop('cameras');
    safeMoveToTop('cameras-labels');

    // Baptême terrain: chevrons/flèches/labels TION au-dessus des autres overlays
    safeMoveToTop('baptism-chevrons');
    safeMoveToTop('baptism-tion-casing');
    safeMoveToTop('baptism-tion-arrow');
    safeMoveToTop('baptism-tion-head');
    safeMoveToTop('baptism-tion-label');

    // Toujours au-dessus de tout le reste (POI, zones, traces, labels, caméras, etc.)
    safeMoveToTop('me-dot');
  }

  function ensureOverlays(map: MapLibreMapInstance) {
    if (!map.getSource('me')) {
      map.addSource('me', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('cameras')) {
      map.addSource('cameras', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    // Enregistrer les icônes losange caméra (public/privé) une seule fois
    try {
      const gl: any = (globalThis as any);
      const ImageCtor: any = (gl && gl.Image) || Image;

      if (!map.hasImage('camera-public')) {
        const svgBlue =
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
          '<polygon points="20,3 37,20 20,37 3,20" fill="#3b82f6" stroke="white" stroke-width="2"/>' +
          '<rect x="13" y="16" width="11" height="8" rx="1.5" fill="white" />' +
          '<circle cx="17" cy="20" r="1.7" fill="#3b82f6" />' +
          '<polygon points="24,17 29,15 29,25 24,23" fill="white" />' +
          '</svg>';
        const img = new ImageCtor(32, 32);
        img.onload = () => {
          try {
            if (!map.hasImage('camera-public')) map.addImage('camera-public', img, { pixelRatio: 2 } as any);
          } catch {
            // ignore
          }
        };
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgBlue);
      }

      if (!map.hasImage('camera-private')) {
        const svgGreen =
          '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">' +
          '<polygon points="20,3 37,20 20,37 3,20" fill="#22c55e" stroke="white" stroke-width="2"/>' +
          '<rect x="13" y="16" width="11" height="8" rx="1.5" fill="white" />' +
          '<circle cx="17" cy="20" r="1.7" fill="#22c55e" />' +
          '<polygon points="24,17 29,15 29,25 24,23" fill="white" />' +
          '</svg>';
        const img2 = new ImageCtor(32, 32);
        img2.onload = () => {
          try {
            if (!map.hasImage('camera-private')) map.addImage('camera-private', img2, { pixelRatio: 2 } as any);
          } catch {
            // ignore
          }
        };
        img2.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgGreen);
      }
    } catch {
      // ignore
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

    if (!map.getLayer('cameras')) {
      map.addLayer({
        id: 'cameras',
        type: 'symbol',
        source: 'cameras',
        layout: {
          'icon-image': [
            'case',
            ['==', ['coalesce', ['downcase', ['to-string', ['get', 'op_type']]], ''], 'public'],
            'camera-public',
            'camera-private',
          ],
          'icon-size': 2.2,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });
    }
    if (!map.getLayer('cameras-labels')) {
      map.addLayer({
        id: 'cameras-labels',
        type: 'symbol',
        source: 'cameras',
        layout: {
          'text-field': '',
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
            'line-opacity': 0.85,
          },
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
        },
        undefined,
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
          'line-opacity': 0.85,
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
    if (!map.getSource('zones-selected')) {
      map.addSource('zones-selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('zones-highlighted')) {
      map.addSource('zones-highlighted', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('zones-assignments-labels')) {
      map.addSource('zones-assignments-labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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

    if (!map.getLayer('zones-selected-fill')) {
      map.addLayer({
        id: 'zones-selected-fill',
        type: 'fill',
        source: 'zones-selected',
        paint: {
          'fill-color': '#3b82f6',
          'fill-opacity': 0.4,
        },
        layout: {
          visibility: 'none',
        },
      });
    }

    if (!map.getLayer('zones-highlighted-fill')) {
      map.addLayer({
        id: 'zones-highlighted-fill',
        type: 'fill',
        source: 'zones-highlighted',
        paint: {
          'fill-color': '#22c55e',
          'fill-opacity': 0.4,
        },
        layout: {
          visibility: 'none',
        },
      });
    }

    if (!map.getLayer('zones-assignments-labels')) {
      map.addLayer({
        id: 'zones-assignments-labels',
        type: 'fill',
        source: 'zones-assignments-labels',
        paint: {
          'fill-color': ['coalesce', ['get', 'memberColor'], '#3b82f6'],
          'fill-opacity': 1,
          'fill-outline-color': 'rgba(0, 0, 0, 0.5)',
        },
        layout: {
          visibility: 'none',
        },
      });
    }

    ensureVehicleTrackLayers(map);

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

    if (!map.getSource('cameras')) {
      map.addSource('cameras', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (!map.getSource('baptism-axes')) {
      map.addSource('baptism-axes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getSource('baptism-tion')) {
      map.addSource('baptism-tion', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }

    if (!map.getLayer('baptism-chevrons')) {
      map.addLayer({
        id: 'baptism-chevrons',
        type: 'symbol',
        source: 'baptism-axes',
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 45,
          'text-field': '>',
          'text-size': 22,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-keep-upright': false,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'text-rotation-alignment': 'map',
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': '#1f2937',
          'text-halo-width': 1.5,
        },
      });
    }

    if (!map.getLayer('baptism-tion-casing')) {
      map.addLayer({
        id: 'baptism-tion-casing',
        type: 'line',
        source: 'baptism-tion',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#ffffff', 'line-width': 6 },
      });
    }
    if (!map.getLayer('baptism-tion-arrow')) {
      map.addLayer({
        id: 'baptism-tion-arrow',
        type: 'line',
        source: 'baptism-tion',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#111827', 'line-width': 3 },
      });
    }
    if (!map.getLayer('baptism-tion-head')) {
      map.addLayer({
        id: 'baptism-tion-head',
        type: 'symbol',
        source: 'baptism-tion',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': '>',
          'text-size': 24,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-rotate': ['get', 'rotation'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      });
    }
    if (!map.getLayer('baptism-tion-label')) {
      map.addLayer({
        id: 'baptism-tion-label',
        type: 'symbol',
        source: 'baptism-tion',
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 13,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      });
    }

    // Couches du brouillon (POI et zone en cours de placement), à cet emplacement
    // précis pour ne pas changer l'ordre d'empilement.
    ensureDraftLayers(map);

    ensurePersonEstimationLayers(map);

    enforceLayerOrder(map);
  }

  async function fetchCamerasForCurrentView(map: MapLibreMapInstance) {
    const envUrl = (import.meta as any)?.env?.VITE_CAMERAS_API_URL as string | undefined;
    const urlBase = envUrl && envUrl.trim() ? envUrl.trim() : '/cameras.geojson';

    try {
      camerasAbortRef.current?.abort();
    } catch {
      // ignore
    }
    const ac = new AbortController();
    camerasAbortRef.current = ac;

    const b = map.getBounds();
    const params = new URLSearchParams({
      minLng: String(b.getWest()),
      minLat: String(b.getSouth()),
      maxLng: String(b.getEast()),
      maxLat: String(b.getNorth()),
    });

    const url = urlBase.includes('?') ? `${urlBase}&${params.toString()}` : `${urlBase}?${params.toString()}`;

    let data: any = null;
    try {
      const r = await fetch(url, { signal: ac.signal });
      data = await r.json();
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      return;
    }

    const fc = (() => {
      if (data && typeof data === 'object') {
        if ((data as any).type === 'FeatureCollection' && Array.isArray((data as any).features)) return data;
        if ((data as any).type === 'Feature' && (data as any).geometry) return { type: 'FeatureCollection', features: [data] };
        if (Array.isArray((data as any).features) && (data as any).features.length && (data as any).features[0]?.geometry) {
          return { type: 'FeatureCollection', features: (data as any).features };
        }
      }

      const arr = Array.isArray(data) ? data : Array.isArray((data as any)?.results) ? (data as any).results : null;
      if (!arr) return { type: 'FeatureCollection', features: [] };

      const feats = arr
        .map((it: any, idx: number) => {
          const lng =
            typeof it?.lng === 'number'
              ? it.lng
              : typeof it?.lon === 'number'
                ? it.lon
                : typeof it?.longitude === 'number'
                  ? it.longitude
                  : null;
          const lat =
            typeof it?.lat === 'number'
              ? it.lat
              : typeof it?.latitude === 'number'
                ? it.latitude
                : null;
          if (lng === null || lat === null) return null;
          return {
            type: 'Feature',
            properties: {
              id: it?.id ?? it?.identifier ?? idx,
              title: it?.title ?? it?.name ?? it?.nom ?? 'Caméra',
              ...it,
            },
            geometry: { type: 'Point', coordinates: [lng, lat] },
          };
        })
        .filter(Boolean);

      return { type: 'FeatureCollection', features: feats };
    })();

    // Filtrer côté client pour ne garder que les caméras dans la vue actuelle
    const fcFiltered = (() => {
      try {
        const feats = Array.isArray((fc as any)?.features) ? ((fc as any).features as any[]) : [];
        const minLng = b.getWest();
        const minLat = b.getSouth();
        const maxLng = b.getEast();
        const maxLat = b.getNorth();

        const inView = feats.filter((f) => {
          if (!f || !f.geometry || f.geometry.type !== 'Point') return false;
          const coords = f.geometry.coordinates;
          if (!Array.isArray(coords) || coords.length < 2) return false;
          const lng = coords[0];
          const lat = coords[1];
          if (typeof lng !== 'number' || typeof lat !== 'number') return false;
          return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
        });

        return { type: 'FeatureCollection', features: inView } as any;
      } catch {
        return fc as any;
      }
    })();

    camerasGeojsonRef.current = fcFiltered;
    const src = map.getSource('cameras') as GeoJSONSource | undefined;
    if (src) {
      src.setData(fcFiltered as any);
    }

    try {
      const empty =
        !fcFiltered ||
        !Array.isArray((fcFiltered as any).features) ||
        (fcFiltered as any).features.length === 0;
      if (camerasEnabledRef.current && empty) {
        const now = Date.now();
        if (now - lastNoCameraToastAtRef.current >= 6000) {
          lastNoCameraToastAtRef.current = now;
          setActivityToast('Aucune caméra connue dans le secteur');
        }
      }
    } catch {
      // ignore
    }
  }

  // Redessine uniquement les couches liées aux zones (contours, libellés, quadrillage).
  // Extrait de resyncAllOverlays pour que les changements de zones ne reconstruisent pas
  // aussi les traces des autres membres, les POI et les brouillons.
  function resyncZoneOverlays(map: MapLibreMapInstance) {
    const zonesSource = map.getSource('zones') as GeoJSONSource | undefined;
    const zonesLabelsSource = map.getSource('zones-labels') as GeoJSONSource | undefined;

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
          features.push({
            type: 'Feature',
            properties: { id: z.id, title: z.title, color: z.color },
            geometry: z.polygon,
          });
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
        // Toute la géométrie de la grille (et donc la correspondance case <-> terrain)
        // vient de `zoneGeometry`: `vertical` et `diag45` partagent le même repère,
        // seule la définition de l'espace grille change.
        const frame = getZoneGridFrame(z);
        if (!frame) continue;
        const { rows, cols } = frame;

        const pushLine = (u1: number, v1: number, u2: number, v2: number) => {
          const a = frame.toLngLat(u1, v1);
          const b = frame.toLngLat(u2, v2);
          features.push({
            type: 'Feature',
            properties: { kind: 'line', zoneId: z.id, color: z.color, rows, cols },
            geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
          });
        };

        // lignes verticales (séparateurs de colonnes)
        for (let c = 1; c < cols; c++) {
          const u = frame.minU + c * frame.cellU;
          for (const [v1, v2] of clipGridColumn(frame, u)) pushLine(u, v1, u, v2);
        }

        // lignes horizontales (séparateurs de lignes)
        for (let r = 1; r < rows; r++) {
          const v = frame.minV + r * frame.cellV;
          for (const [u1, u2] of clipGridRow(frame, v)) pushLine(u1, v, u2, v);
        }

        // libellés de colonnes (bord bas): A, B, C...
        for (let c = 0; c < cols; c++) {
          const u = frame.minU + (c + 0.5) * frame.cellU;
          const segs = clipGridColumn(frame, u);
          if (!segs.length) continue;
          const bottom = Math.min(...segs.map((s) => Math.min(s[0], s[1])));
          const p = frame.toLngLat(u, bottom);
          features.push({
            type: 'Feature',
            properties: { kind: 'label', axis: 'x', zoneId: z.id, text: gridColumnLetter(c), rows, cols },
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          });
        }

        // libellés de lignes (bord gauche): 1.. (dans le sens des `row` croissants)
        for (let r = 0; r < rows; r++) {
          const v = frame.minV + (r + 0.5) * frame.cellV;
          const segs = clipGridRow(frame, v);
          if (!segs.length) continue;
          const left = Math.min(...segs.map((s) => Math.min(s[0], s[1])));
          const p = frame.toLngLat(left, v);
          features.push({
            type: 'Feature',
            properties: { kind: 'label', axis: 'y', zoneId: z.id, text: String(r + 1), rows, cols },
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          });
        }

        // libellés de cases (centre): A1, B2, etc.
        // On les génère toujours; la taille est ensuite adaptée via text-size
        // en fonction de la densité (rows*cols) et du zoom.
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const p = frame.cellToLngLat(c + 0.5, r + 0.5);
            if (!isPointInZone(p.lng, p.lat, z)) continue;
            features.push({
              type: 'Feature',
              properties: { kind: 'cell', zoneId: z.id, text: formatGridCellId(r, c), rows, cols },
              geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            });
          }
        }
      }

      zonesGridSource.setData({ type: 'FeatureCollection', features } as any);
    }
  }

  function resyncAllOverlays(map: MapLibreMapInstance) {
    const meSource = map.getSource('me') as GeoJSONSource | undefined;
    const traceSource = map.getSource('trace') as GeoJSONSource | undefined;
    const othersSource = map.getSource('others') as GeoJSONSource | undefined;
    const othersTracesSource = map.getSource('others-traces') as GeoJSONSource | undefined;
    const poisSource = map.getSource('pois') as GeoJSONSource | undefined;

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

    // Bug 6: les couches de zones sont redessinées seules par resyncZoneOverlays,
    // qui est aussi appelée directement par l'effet déclenché sur `zones`.
    resyncZoneOverlays(map);

    if (poisSource) {
      poisSource.setData(buildPoisFeatureCollection(pois));
    }
  }

  // Baptême terrain: pousse les axes (chevrons) et les flèches/labels TION vers leurs
  // sources selon le mode d'affichage. Appelée par l'effet de sync ci-dessous ET
  // directement après un rebuild de style (onLoad / setStyle), comme resyncAllOverlays.
  function resyncBaptismOverlays(map: MapLibreMapInstance) {
    const axesSrc = map.getSource('baptism-axes') as GeoJSONSource | undefined;
    const tionSrc = map.getSource('baptism-tion') as GeoJSONSource | undefined;
    if (!axesSrc || !tionSrc) return;

    const b = baptismApi.baptism;
    const showChevrons = !!b && (b.displayMode === 'colors' || b.displayMode === 'both');
    const showTion = !!b && (b.displayMode === 'tion' || b.displayMode === 'both');

    axesSrc.setData({
      type: 'FeatureCollection',
      features: showChevrons
        ? b!.axes.map((a) => ({
            type: 'Feature' as const,
            properties: { axisId: a.axisId, color: a.color },
            geometry: a.geometry,
          }))
        : [],
    });

    const tionFeatures: GeoJSON.Feature[] = [];
    if (showTion && b) {
      for (const a of b.axes) {
        const origin: [number, number] = [b.point.lng, b.point.lat];
        const tip = destinationPoint(origin, a.bearing, 120);
        tionFeatures.push({
          type: 'Feature',
          properties: { axisId: a.axisId },
          geometry: { type: 'LineString', coordinates: [origin, tip] },
        });
        tionFeatures.push({
          type: 'Feature',
          properties: {
            axisId: a.axisId,
            rotation: (a.bearing - 90 + 360) % 360,
            label: a.name ? `TION ${a.name}` : 'TION ?',
          },
          geometry: { type: 'Point', coordinates: tip },
        });
      }
    }
    tionSrc.setData({ type: 'FeatureCollection', features: tionFeatures });
  }

  // Resynchro des sources baptism dès que les données changent (mêmes deps que
  // le pendant zones: [zones, mapReady]). Le cas "sources recréées par un rebuild
  // de style" est couvert séparément par les appels directs dans onLoad/onStyleData.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    resyncBaptismOverlays(map);
  }, [baptismApi.baptism, mapReady]);

  // Marqueur du point de baptême sauvegardé (icône pleine). Tap simple -> ouvre le
  // panneau baptême (mode d'affichage + suppression). Pas de tap long (cf. brief).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    baptismMarkerRef.current?.remove();
    baptismMarkerRef.current = null;
    const b = baptismApi.baptism;
    if (b) {
      const el = makeBaptismEl(b.icon, false);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        setBaptismPanelOpen(true);
        setEditingAxisId(null);
      });
      baptismMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([b.point.lng, b.point.lat])
        .addTo(map);
    }
    return () => {
      baptismMarkerRef.current?.remove();
      baptismMarkerRef.current = null;
    };
  }, [baptismApi.baptism, mapReady]);

  // Marqueur de brouillon (icône pointillée, déplaçable) pendant le placement.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    baptismDraftMarkerRef.current?.remove();
    baptismDraftMarkerRef.current = null;
    const d = baptismApi.draft;
    if (d?.point) {
      const marker = new maplibregl.Marker({ element: makeBaptismEl(d.icon, true), draggable: true })
        .setLngLat([d.point.lng, d.point.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        baptismApi.placeAt(p.lng, p.lat);
      });
      baptismDraftMarkerRef.current = marker;
    }
    return () => {
      baptismDraftMarkerRef.current?.remove();
      baptismDraftMarkerRef.current = null;
    };
  }, [baptismApi.draft, mapReady]);

  // Routage du clic carte pour l'outil baptême: place uniquement le point de
  // brouillon (pas de POI/zone/popup). Le handler de useMapDraft ne fait déjà rien
  // pour activeTool === 'baptism' (aucun de ses `if` ne matche), donc pas de risque
  // de double création: on ajoute juste ici l'action propre au baptême.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    const onBaptismClick = (e: maplibregl.MapMouseEvent) => {
      if (activeToolRef.current !== 'baptism') return;
      baptismApi.placeAt(e.lngLat.lng, e.lngLat.lat);
    };
    map.on('click', onBaptismClick);
    return () => {
      map.off('click', onBaptismClick);
    };
  }, [mapReady, baptismApi.placeAt]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const onZoneClick = (e: maplibregl.MapMouseEvent) => {
      // Baptême terrain: pendant un placement en cours, ce handler (édition d'axe ET
      // sélection grille) doit rester entièrement inerte — le clic est dédié à
      // poser/déplacer le point de brouillon (cf. l'effet onBaptismClick dédié).
      // Sans ce retour anticipé, un tap qui vise juste le brouillon peut aussi retomber
      // sur une feature zone/grille (toggleSelection) ou un chevron de l'ancien baptême
      // (toujours affiché tant que confirmDraft n'a pas remplacé baptismApi.baptism).
      if (activeToolRef.current === 'baptism') return;

      // Baptême terrain: un tap sur un chevron/flèche/label TION ouvre l'éditeur d'axe.
      // Vérifié avant le mode grille car l'édition d'axe doit marcher hors mode grille.
      const baptismHits = map.queryRenderedFeatures(e.point, {
        layers: ['baptism-chevrons', 'baptism-tion-label', 'baptism-tion-arrow'].filter((l) => !!map.getLayer(l)),
      });
      if (baptismHits.length > 0) {
        const axisId = baptismHits[0].properties?.axisId as string | undefined;
        if (axisId) {
          setEditingAxisId(axisId);
          setBaptismPanelOpen(false);
          return;
        }
      }

      if (mode === 'off') return;

      const features = map.queryRenderedFeatures(e.point, { layers: ['zones-fill', 'zones-outline', 'zones-grid-lines'] });
      if (!features || features.length === 0) return;

      const zoneId = (features[0].properties?.id ?? features[0].properties?.zoneId) as string;
      const sectorId = features[0].properties?.sectorId as string | undefined;
      if (!zoneId) return;
      const clickedZone = zones.find((z) => z.id === zoneId);
      const gridCell = clickedZone ? getGridCellSelection(e.lngLat.lng, e.lngLat.lat, clickedZone) : null;
      const selectionId = gridCell?.id ?? (sectorId ? `${zoneId}:${sectorId}` : zoneId);

      if (mode === 'admin-select') {
        toggleSelection(selectionId);
      } else if (mode === 'member-highlight') {
        // TODO: Show ZoneAssignmentsPopup with assigned members
        console.log('Zone clicked in member-highlight mode:', zoneId);
      }
    };

    map.on('click', onZoneClick);

    return () => {
      map.off('click', onZoneClick);
    };
  }, [mapReady, mode, toggleSelection, zones]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;

    const onCameraClick = (e: any) => {
      try {
        const feats = map.queryRenderedFeatures(e.point, { layers: ['cameras'] }) as any[];
        const feat = feats && feats.length ? feats[0] : null;
        if (!feat) return;
        const geom = feat.geometry as any;
        const coords = Array.isArray(geom?.coordinates) ? (geom.coordinates as [number, number]) : undefined;
        if (!coords || coords.length < 2) return;

        const props = feat.properties as any;
        const rawApp = (props?.apparence ?? '').toString();
        const apparence = rawApp ? rawApp : '';
        const rawOp = (props?.op_type ?? '').toString().toLowerCase();
        const opType: 'public' | 'prive' = rawOp === 'public' ? 'public' : 'prive';
        const idCamera = (props?.id_camera ?? '').toString();

        setSelectedCamera({
          lng: coords[0],
          lat: coords[1],
          apparence,
          opType,
          idCamera,
        });
      } catch {
        // ignore
      }
    };

    map.on('click', onCameraClick as any);

    return () => {
      try {
        map.off('click', onCameraClick as any);
      } catch {
        // ignore
      }
    };
  }, [mapReady]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const initialStyle = currentBaseStyle ?? baseStyles[0]?.style;
    appliedStyleRef.current = initialStyle;

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
      resyncDraftOverlays(map);
      resyncBaptismOverlays(map);
      syncHeatmapVisibility(map);
      setMapReady(true);
    };

    const onStyleData = () => {
      if (!mapReadyRef.current) return;
      // Après un changement de style (setStyle), toutes les couches custom sont perdues.
      // On recrée donc les overlays (zones, POI, estimation, etc.), on remet l'ordre,
      // puis on réapplique la visibilité de la heatmap.
      ensureOverlays(map);
      enforceLayerOrder(map);
      applyGridLabelStyle(map);
      syncHeatmapVisibility(map);

      reinjectVehicleTrackData(map);
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
    // La carte est créée UNE seule fois: un changement de fond de carte passe par
    // setStyle (voir effet dédié plus bas) et non par une destruction/recréation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Style déjà appliqué (création de la carte, ou re-run dû à user/memberColors):
    // pas de setStyle redondant, qui reconstruirait inutilement toutes les couches.
    if (appliedStyleRef.current === currentBaseStyle) return;
    appliedStyleRef.current = currentBaseStyle;
    const c = map.getCenter();
    const fallbackView = { lng: c.lng, lat: c.lat, zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    const view = lastViewRef.current ?? fallbackView;

    map.setStyle(currentBaseStyle);

    const onStyleData = () => {
      ensureOverlays(map);
      applyGridLabelStyle(map);
      resyncAllOverlays(map);
      resyncDraftOverlays(map);
      resyncBaptismOverlays(map);
      applyMyDynamicPaint(map);

      try {
        const csrc = map.getSource('cameras') as GeoJSONSource | undefined;
        if (csrc) csrc.setData(camerasGeojsonRef.current as any);
      } catch {
        // ignore
      }

      try {
        const visibility = camerasEnabledRef.current ? 'visible' : 'none';
        if (map.getLayer('cameras')) map.setLayoutProperty('cameras', 'visibility', visibility);
        if (map.getLayer('cameras-labels')) map.setLayoutProperty('cameras-labels', 'visibility', visibility);
      } catch {
        // ignore
      }

      try {
        const visibility = labelsEnabledRef.current ? 'visible' : 'none';
        if (map.getLayer('others-labels')) map.setLayoutProperty('others-labels', 'visibility', visibility);
        if (map.getLayer('pois-labels')) map.setLayoutProperty('pois-labels', 'visibility', visibility);
        if (map.getLayer('zones-labels')) map.setLayoutProperty('zones-labels', 'visibility', visibility);
      } catch {
        // ignore
      }

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

    const schedule = () => {
      if (!camerasEnabledRef.current) return;
      if (camerasDebounceRef.current) {
        window.clearTimeout(camerasDebounceRef.current);
      }
      camerasDebounceRef.current = window.setTimeout(() => {
        camerasDebounceRef.current = null;
        void fetchCamerasForCurrentView(map);
      }, 350);
    };

    const onMoveEnd = () => schedule();
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onMoveEnd);

    // Trigger immediately when enabling
    if (camerasEnabled) {
      schedule();
    }

    return () => {
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onMoveEnd);
    };
  }, [mapReady, camerasEnabled]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!mapReady) return;
    // Un create/update/delete de zone ne doit redessiner que les couches de zones,
    // pas reconstruire tous les overlays (traces des autres membres, POI, brouillons).
    resyncZoneOverlays(map);
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
            const fromSnapshot = normalizedSelf
              .filter((p) => p && typeof p.lng === 'number' && typeof p.lat === 'number' && typeof p.t === 'number')
              .sort((a, b) => a.t - b.t)
              .filter((p) => p.t >= effectiveCutoff);

            setTracePoints((prevLocal) => {
              // Si la trace locale est vide (ex: premier chargement, reload), le snapshot fait foi.
              if (prevLocal.length === 0) {
                const deduped: typeof fromSnapshot = [];
                for (const p of fromSnapshot) {
                  const last = deduped.length ? deduped[deduped.length - 1] : null;
                  if (last && last.lng === p.lng && last.lat === p.lat && Math.abs(last.t - p.t) < 500) continue;
                  deduped.push(p);
                }
                return deduped.slice(-effectiveMaxTracePoints);
              }

              // Sinon : on merge en gardant la résolution la plus haute (locale).
              // Le snapshot peut contenir des points plus anciens que ce qu'on a en local
              // (ex: après un reload partiel), on les ajoute au début.
              const localOldestT = prevLocal[0].t;
              const olderFromSnapshot = fromSnapshot.filter((p) => p.t < localOldestT);

              // Dédup par timestamp pour éviter les doublons exacts
              const tSeen = new Set<number>();
              const merged: typeof fromSnapshot = [];
              for (const p of olderFromSnapshot) {
                if (tSeen.has(p.t)) continue;
                tSeen.add(p.t);
                merged.push(p);
              }
              for (const p of prevLocal) {
                if (tSeen.has(p.t)) continue;
                tSeen.add(p.t);
                merged.push(p);
              }
              return merged
                .sort((a, b) => a.t - b.t)
                .filter((p) => p.t >= effectiveCutoff)
                .slice(-effectiveMaxTracePoints);
            });
          }
        }
      }

      // Pour les TRACES des autres : on merge avec ce qu'on a déjà reçu en live.
      // Le snapshot peut contenir des points anciens, et le live peut contenir
      // des points plus récents arrivés entre la demande et la réception du snapshot.
      const mergedOthersTraces: Record<string, { lng: number; lat: number; t: number }[]> = {};
      const allOtherUserIds = new Set([
        ...Object.keys(nextOthersTraces),
        ...Object.keys(otherTracesRef.current),
      ]);
      for (const uid of allOtherUserIds) {
        if (user?.id && uid === user.id) continue;
        const fromSnapshot = nextOthersTraces[uid] ?? [];
        const fromLocal = otherTracesRef.current[uid] ?? [];
        const tSeen = new Set<number>();
        const combined: { lng: number; lat: number; t: number }[] = [];
        for (const p of fromSnapshot) {
          if (tSeen.has(p.t)) continue;
          tSeen.add(p.t);
          combined.push(p);
        }
        for (const p of fromLocal) {
          if (tSeen.has(p.t)) continue;
          tSeen.add(p.t);
          combined.push(p);
        }
        const filtered = combined
          .sort((a, b) => a.t - b.t)
          .filter((p) => p.t >= cutoff)
          .slice(-maxTracePointsFromSnapshot);
        if (filtered.length) {
          mergedOthersTraces[uid] = filtered;
        }
      }
      otherTracesRef.current = mergedOthersTraces;

      // Pour les POSITIONS COURANTES : on garde le plus récent par user.
      // Si un user n'apparaît pas dans le snapshot, on le retire (il a peut-être quitté).
      setOtherPositions((prev) => {
        const merged: Record<string, { lng: number; lat: number; t: number }> = {};
        for (const [uid, p] of Object.entries(nextOthers)) {
          const existing = prev[uid];
          // Si on a une position locale plus récente, on la garde.
          if (existing && existing.t > p.t) {
            merged[uid] = existing;
          } else {
            merged[uid] = p;
          }
        }
        return merged;
      });
      setOthersActivityTick((v) => (v + 1) % 1_000_000);
    };

    const applyRemotePosition = (msg: any, opts?: { fromBulk?: boolean }) => {
      if (!msg?.userId) return;

      const lng =
        typeof msg.lng === 'number'
          ? msg.lng
          : typeof msg.lng === 'string'
            ? Number.parseFloat(msg.lng)
            : Number.NaN;
      const lat =
        typeof msg.lat === 'number'
          ? msg.lat
          : typeof msg.lat === 'string'
            ? Number.parseFloat(msg.lat)
            : Number.NaN;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

      // If it's me, also feed my local trace from socket events (update/bulk/snapshot)
      // so my rendering behaves the same way as other users.
      if (user?.id && msg.userId === user.id) {
        // Ignore les echos de bulk pour soi : ces points sont déjà dans tracePoints
        // (poussés directement par le watchPosition local), pas la peine de les ré-injecter.
        if (opts?.fromBulk) {
          return;
        }
        const now = normalizeRemoteTime(
          typeof msg.t === 'number'
            ? msg.t
            : typeof msg.t === 'string'
              ? Number.parseFloat(msg.t)
              : msg.t,
          Date.now(),
        );
        setLastPos({ lng, lat });
        setTracePoints((prev) => {
          const last = prev.length ? prev[prev.length - 1] : null;
          if (last && last.lng === lng && last.lat === lat && Math.abs(last.t - now) < 500) {
            return prev;
          }
          const cutoff = Date.now() - traceRetentionMs;
          const next = [...prev, { lng, lat, t: now }]
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
      const now = normalizeRemoteTime(
        typeof msg.t === 'number' ? msg.t : typeof msg.t === 'string' ? Number.parseFloat(msg.t) : msg.t,
        Date.now(),
      );

      const traces = otherTracesRef.current[msg.userId] ?? [];
      const cutoff = Date.now() - traceRetentionMs;
      const nextTraces = [...traces, { lng, lat, t: now }]
        .filter((p) => p.t >= cutoff)
        .slice(-maxTracePoints);
      otherTracesRef.current[msg.userId] = nextTraces;
      setOthersActivityTick((v) => (v + 1) % 1_000_000);

      setOtherPositions((prev) => ({
        ...prev,
        [msg.userId]: { lng, lat, t: now },
      }));
    };

    const onPosBatch = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      const points = Array.isArray(msg.points) ? msg.points : [];
      for (const p of points) {
        if (user?.id && p.userId === user.id) continue;
        applyRemotePosition(p);
      }
    };

    const onPosBulk = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      if (!msg.userId) return;
      const pts = Array.isArray(msg.points) ? msg.points : [];
      for (const p of pts) {
        applyRemotePosition({ ...p, userId: msg.userId }, { fromBulk: true });
      }
    };

    socket.on('mission:snapshot', onSnapshot);
    socket.on('position:batch', onPosBatch);
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
        if (createdBy) {
          const rawName = typeof msg.createdByDisplayName === 'string' ? msg.createdByDisplayName : null;
          const name = (rawName && rawName.trim()) || buildUserDisplayName(createdBy);
          if (!user?.id || user.id !== createdBy) {
            setActivityToast(`${name} vient de créer un POI`);
          }
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
          if (!user?.id || user.id !== createdBy) {
            setActivityToast(`${name} vient de créer une zone`);
          }
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

    const onZoneUpdated = (msg: any) => {
      if (msg?.missionId !== selectedMissionId) return;
      if (!msg?.zone?.id) return;
      setZones((prev) => prev.map((z) => (z.id === msg.zone.id ? (msg.zone as ApiZone) : z)));
    };
    const onZoneDeleted = (msg: any) => {
      if (!msg?.zoneId) return;
      setZones((prev) => prev.filter((z) => z.id !== msg.zoneId));
    };

    socket.on('poi:created', onPoiCreated);
    socket.on('poi:updated', onPoiUpdated);
    socket.on('poi:deleted', onPoiDeleted);

    socket.on('zone:created', onZoneCreated);
    socket.on('zone:updated', onZoneUpdated);
    socket.on('zone:deleted', onZoneDeleted);

    const onZoneAssignedToYou = (msg: any) => {
      if (!msg || msg.missionId !== selectedMissionId) return;
      if (!msg.assignedByUserName) return;
      setActivityToast(`${msg.assignedByUserName} vous a attribué une zone de recherche`);
    };

    socket.on('zone:assigned:you', onZoneAssignedToYou);

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
      socket.off('position:batch', onPosBatch);
      socket.off('position:bulk', onPosBulk);
      socket.off('position:clear', onPosClear);

      socket.off('poi:created', onPoiCreated);
      socket.off('poi:updated', onPoiUpdated);
      socket.off('poi:deleted', onPoiDeleted);

      socket.off('zone:created', onZoneCreated);
      socket.off('zone:updated', onZoneUpdated);
      socket.off('zone:deleted', onZoneDeleted);

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

    lastSentRef.current = null;

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
          const roundedLng = roundCoord(lng);
          const roundedLat = roundCoord(lat);
          const payload = {
            lng: roundedLng,
            lat: roundedLat,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            accuracy: pos.coords.accuracy ?? undefined,
            t,
          };

          if (socket.connected) {
            wasSocketConnectedRef.current = true;
            if (shouldEmitPosition(lastSentRef.current, { lng: roundedLng, lat: roundedLat, t })) {
              lastSentRef.current = { lng: roundedLng, lat: roundedLat, t };
              socket.emit('position:update', payload);
            }
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
    src.setData(buildPoisFeatureCollection(pois));
  }, [pois, mapReady]);

  // Détruire les marqueurs POI au démontage: ce sont des noeuds DOM ajoutés à la carte
  // en dehors de React, personne d'autre ne les enlève.
  useEffect(() => {
    const markers = poiMarkersRef.current;
    return () => {
      for (const marker of markers.values()) marker.remove();
      markers.clear();
    };
  }, []);

  // HTML markers for POIs (circles with inner icon).
  // Mise à jour différentielle: on ne touche qu'aux POI ajoutés/retirés/modifiés,
  // les marqueurs inchangés restent en place (pas de flash ni de fuite DOM).
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

    // Retirer les marqueurs dont le POI n'existe plus.
    const nextIds = new Set(pois.map((p) => p.id));
    for (const [id, marker] of markers) {
      if (!nextIds.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }

    // Ajouter les nouveaux, mettre à jour sur place ceux qui ont changé, ne rien faire
    // pour les autres. La signature est stockée sur l'élément DOM du marqueur: pas de
    // structure parallèle à garder synchronisée.
    for (const p of pois) {
      const sig = JSON.stringify(p);
      const existing = markers.get(p.id);
      if (existing) {
        const el = existing.getElement() as HTMLDivElement;
        if (el.dataset.poiSig === sig) continue;
        applyMarkerContent(el, p);
        el.dataset.poiSig = sig;
        existing.setLngLat([p.lng, p.lat]);
        continue;
      }
      const el = document.createElement('div');
      applyMarkerContent(el, p);
      el.dataset.poiSig = sig;
      markers.set(
        p.id,
        new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lng, p.lat]).addTo(map)
      );
    }
  }, [pois, mapReady, poiIconOptions, currentBaseStyle]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const selectedSource = map.getSource('zones-selected') as GeoJSONSource | undefined;
    const highlightedSource = map.getSource('zones-highlighted') as GeoJSONSource | undefined;
    const labelsSource = map.getSource('zones-assignments-labels') as GeoJSONSource | undefined;

    if (!selectedSource || !highlightedSource || !labelsSource) return;

    const selectedFeatures: any[] = [];
    const highlightedFeatures: any[] = [];
    const labelsFeatures: any[] = [];

    for (const z of zones) {
      if (selectedZoneIds.includes(z.id)) {
        if (z.type === 'circle' && z.circle) {
          selectedFeatures.push({
            type: 'Feature',
            properties: { id: z.id },
            geometry: circleToPolygon(z.circle.center, z.circle.radiusMeters),
          });
        }
        if (z.type === 'polygon' && z.polygon) {
          selectedFeatures.push({ type: 'Feature', properties: { id: z.id }, geometry: z.polygon });
        }
      }
      if (Array.isArray(z.sectors)) {
        for (const s of z.sectors) {
          if (selectedZoneIds.includes(`${z.id}:${s.sectorId}`)) {
            selectedFeatures.push({ type: 'Feature', properties: { id: z.id, sectorId: s.sectorId }, geometry: s.geometry });
          }
        }
      }
      {
        const frame = getZoneGridFrame(z);
        if (frame) {
          for (let r = 0; r < frame.rows; r++) {
            for (let c = 0; c < frame.cols; c++) {
              const text = formatGridCellId(r, c);
              if (!selectedZoneIds.includes(`${z.id}:grid:${text}`)) continue;
              const bounds = gridCellBounds(frame, r, c);
              if (!bounds) continue;
              selectedFeatures.push({
                type: 'Feature',
                properties: { id: z.id, gridCell: text },
                geometry: { type: 'Polygon', coordinates: [bounds.ring] },
              });
            }
          }
        }
      }

      const isAssignedToCurrentUser =
        !!user &&
        !!assignmentsByZoneId.get(z.id)?.some((assignment) => assignment.userId === user.id);

      // In member-highlight mode, highlight the entire zone if user is assigned (zone-level)
      if ((highlightedZoneIds.includes(z.id) || isAssignedToCurrentUser) && mode === 'member-highlight') {
        if (z.type === 'circle' && z.circle) {
          highlightedFeatures.push({
            type: 'Feature',
            properties: { id: z.id },
            geometry: circleToPolygon(z.circle.center, z.circle.radiusMeters),
          });
        }
        if (z.type === 'polygon' && z.polygon) {
          highlightedFeatures.push({ type: 'Feature', properties: { id: z.id }, geometry: z.polygon });
        }
        if (Array.isArray(z.sectors)) {
          for (const s of z.sectors) {
            highlightedFeatures.push({ type: 'Feature', properties: { id: z.id, sectorId: s.sectorId }, geometry: s.geometry });
          }
        }
      }

      // Highlight specific grid cells where the current user is assigned in grid modes
      if ((mode === 'member-highlight' || mode === 'admin-select') && user && z.grid?.rows && z.grid?.cols) {
        const assignments = assignmentsByZoneId.get(z.id);
        if (assignments) {
          const userAssignments = assignments.filter((a) => a.userId === user.id && a.gridCellId);
          if (userAssignments.length > 0) {
            const frame = getZoneGridFrame(z);
            if (frame) {
              for (const assignment of userAssignments) {
                if (!assignment.gridCellId) continue;
                const cell = parseGridCellId(assignment.gridCellId);
                if (!cell) continue;
                const bounds = gridCellBounds(frame, cell.row, cell.col);
                if (!bounds) continue;
                highlightedFeatures.push({
                  type: 'Feature',
                  properties: { id: z.id, gridCellId: assignment.gridCellId },
                  geometry: { type: 'Polygon', coordinates: [bounds.ring] },
                });
              }
            }
          }
        }
      }

      const assignments = assignmentsByZoneId.get(z.id);
      if (assignments && assignments.length > 0) {
        // Group assignments by gridCellId (or null for zone-level assignments)
        const assignmentsByCell = new Map<string | null, typeof assignments>();
        for (const assignment of assignments) {
          const key = assignment.gridCellId ?? null;
          if (!assignmentsByCell.has(key)) {
            assignmentsByCell.set(key, []);
          }
          assignmentsByCell.get(key)!.push(assignment);
        }

        for (const [cellKey, cellAssignments] of assignmentsByCell.entries()) {
          for (let i = 0; i < cellAssignments.length; i++) {
            const assignment = cellAssignments[i];
            const memberName = buildUserDisplayName(assignment.userId);
            const memberColor = memberColors[assignment.userId] ?? '#3b82f6';

            // If assignment has gridCellId, position label at that cell's center
            const cellFrame = cellKey ? getZoneGridFrame(z) : null;
            const cell = cellKey && cellFrame ? parseGridCellId(cellKey) : null;
            if (cellFrame && cell && isCellInGrid(cellFrame, cell.row, cell.col)) {
              // Petit carré positionné en unités de case (0.08 de case de côté, 0.035 d'écart),
              // puis projeté sur le terrain: il suit donc la rotation d'une grille diag45.
              const half = 0.04;
              const centerCol = cell.col + 0.85 - i * (0.08 + 0.035);
              const centerRow = cell.row + 0.85;
              const corners: [number, number][] = (
                [
                  [centerCol - half, centerRow - half],
                  [centerCol + half, centerRow - half],
                  [centerCol + half, centerRow + half],
                  [centerCol - half, centerRow + half],
                ] as [number, number][]
              ).map(([c, r]) => {
                const p = cellFrame.cellToLngLat(c, r);
                return [p.lng, p.lat] as [number, number];
              });
              labelsFeatures.push({
                type: 'Feature',
                properties: { zoneId: z.id, memberName, memberColor, userId: assignment.userId },
                geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]]] },
              });
            } else if (!cellKey || !cellFrame) {
              // Fallback: position at zone center with vertical offset
              const center = z.type === 'circle' && z.circle
                ? z.circle.center
                : z.type === 'polygon' && z.polygon
                ? getPolygonCenter(z.polygon.coordinates[0] as [number, number][])
                : null;

              if (center) {
                const size = 0.00008;
                const gap = 0.00004;
                const squareLng = center.lng - i * (size + gap);
                const squareLat = center.lat;
                labelsFeatures.push({
                  type: 'Feature',
                  properties: { zoneId: z.id, memberName, memberColor, userId: assignment.userId },
                  geometry: {
                    type: 'Polygon',
                    coordinates: [[
                      [squareLng - size / 2, squareLat - size / 2],
                      [squareLng + size / 2, squareLat - size / 2],
                      [squareLng + size / 2, squareLat + size / 2],
                      [squareLng - size / 2, squareLat + size / 2],
                      [squareLng - size / 2, squareLat - size / 2],
                    ]],
                  },
                });
              }
            }
          }
        }
      }
    }

    selectedSource.setData({ type: 'FeatureCollection', features: selectedFeatures });
    highlightedSource.setData({ type: 'FeatureCollection', features: highlightedFeatures });
    labelsSource.setData({ type: 'FeatureCollection', features: labelsFeatures });

    const selectedLayer = map.getLayer('zones-selected-fill');
    const highlightedLayer = map.getLayer('zones-highlighted-fill');
    const labelsLayer = map.getLayer('zones-assignments-labels');

    if (selectedLayer) {
      map.setLayoutProperty('zones-selected-fill', 'visibility', mode === 'admin-select' ? 'visible' : 'none');
    }
    if (highlightedLayer) {
      map.setLayoutProperty('zones-highlighted-fill', 'visibility', mode === 'member-highlight' || mode === 'admin-select' ? 'visible' : 'none');
    }
    if (labelsLayer) {
      map.setLayoutProperty('zones-assignments-labels', 'visibility', mode !== 'off' ? 'visible' : 'none');
    }
  }, [zones, selectedZoneIds, highlightedZoneIds, assignmentsByZoneId, memberColors, mode, mapReady]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('others') as GeoJSONSource | undefined;
    if (!src) return;

    const now = Date.now();
    const inactiveAfterMs = 45_000;
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
    const inactiveAfterMs = 45_000;
    const inactiveColor = '#9ca3af';
    const features: any[] = [];
    const segmentGapMs = 45_000;

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

      const flush = () => {
        if (segment.length >= 2) {
          features.push({
            type: 'Feature',
            properties: { userId, color, inactive: isInactive ? 1 : 0 },
            geometry: { type: 'LineString', coordinates: segment.map((x) => [x.lng, x.lat]) },
          });
        }
        segment = [];
      };

      for (let i = 0; i < n; i++) {
        const p = pts[i];
        if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') continue;
        if (typeof p.t !== 'number' || !Number.isFinite(p.t)) continue;
        const isGap = prevT !== null && p.t - prevT > segmentGapMs;

        if (isGap && segment.length) {
          flush();
          segment.push(p);
        } else {
          segment.push(p);
        }

        prevT = p.t;
      }

      flush();
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

      const segmentGapMs = 45_000;
      const n = filtered.length;

      const selfFeatures: any[] = [];
      let segment: { lng: number; lat: number; t: number }[] = [];
      let prevT: number | null = null;

      const flush = () => {
        if (segment.length >= 2) {
          selfFeatures.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: segment.map((x) => [x.lng, x.lat]) },
            properties: {},
          });
        }
        segment = [];
      };

      for (let i = 0; i < n; i++) {
        const p = filtered[i];
        const isGap = prevT !== null && p.t - prevT > segmentGapMs;

        if (isGap && segment.length) {
          flush();
          segment.push(p);
        } else {
          segment.push(p);
        }

        prevT = p.t;
      }

      flush();

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
          properties: {},
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

      <PoiPopup
        poi={selectedPoi}
        onClose={onClosePoiPopup}
        onNavigate={onNavigateToPoi}
        onStartTrack={onStartTrackFromPoi}
        onEdit={onEditPoi}
        onDelete={onDeletePoi}
        creatorLabel={creatorLabel}
        canEditMap={canEditMap}
        hasActiveTestVehicleTrack={hasActiveTestVehicleTrack}
        actionBusy={actionBusy}
      />

      <CameraPopup camera={selectedCamera} onClose={onCloseCameraPopup} />

      <ConfirmDeletePersonCaseModal
        open={confirmDeletePersonCaseOpen}
        loading={personLoading}
        onCancel={onCancelDeletePersonCase}
        onConfirm={onConfirmDeletePersonCaseClick}
      />

      <NavPickerModal
        target={navPickerTarget}
        isAndroid={isAndroid}
        onClose={onCloseNavPicker}
      />

      <MapRightToolbar
        followMyBearing={followMyBearing}
        centerOnMe={centerOnMe}
        toggleMapStyle={toggleMapStyle}
        canEditMap={canEditMap}
        role={role}
        activeTool={activeTool}
        cancelDraft={cancelAnyDraft}
        setZoneMenuOpen={setZoneMenuOpen}
        zoneMenuOpen={zoneMenuOpen}
        baptismMenuOpen={baptismMenuOpen}
        setBaptismMenuOpen={setBaptismMenuOpen}
        onStartBaptism={onStartBaptism}
        setDraftColor={setDraftColor}
        setDraftIcon={setDraftIcon}
        setDraftComment={setDraftComment}
        setActiveTool={setActiveTool}
        settingsMenuOpen={settingsMenuOpen}
        setSettingsMenuOpen={setSettingsMenuOpen}
        setSettingsNotification={setSettingsNotification}
        settingsNotification={settingsNotification}
        scaleEnabled={scaleEnabled}
        setScaleEnabled={setScaleEnabled}
        labelsEnabled={labelsEnabled}
        setLabelsEnabled={setLabelsEnabled}
        camerasEnabled={camerasEnabled}
        setCamerasEnabled={setCamerasEnabled}
        isAdmin={isAdmin}
        personPanelOpen={personPanelOpen}
        personPanelCollapsed={personPanelCollapsed}
        personEdit={personEdit}
        timerModalOpen={timerModalOpen}
        projectionNotification={projectionNotification}
        personCase={personCase}
        setNoProjectionToast={setNoProjectionToast}
        setPersonEdit={setPersonEdit}
        setPersonPanelCollapsed={setPersonPanelCollapsed}
        setPersonPanelOpen={setPersonPanelOpen}
        setShowActiveVehicleTrack={setShowActiveVehicleTrack}
        mapInstance={mapInstanceRef.current}
        mapReady={mapReady}
        applyHeatmapVisibility={applyHeatmapVisibility}
        showEstimationHeatmap={showEstimationHeatmap}
        missionTraceRetentionSeconds={mission?.traceRetentionSeconds ?? null}
        setTimerSecondsInput={setTimerSecondsInput}
        setTimerError={setTimerError}
        setTimerModalOpen={setTimerModalOpen}
        setActionError={setActionError}
        isMapRotated={isMapRotated}
        resetNorth={resetNorth}
        gridViewMode={mode}
        gridViewToggle={() => toggle(isAdmin ? 'admin-select' : 'member-highlight')}
        gridViewResetBadge={resetBadge}
        gridViewBadgeCount={
          mode === 'admin-select'
            ? selectedZoneIds.length
            : mode === 'member-highlight' && user
              ? (() => {
                  let count = 0;
                  for (const assignments of assignmentsByZoneId.values()) {
                    count += assignments.filter((a) => a.userId === user.id && a.gridCellId).length;
                  }
                  return count;
                })()
              : 0
        }
        gridHasAssignments={(() => {
          for (const assignments of assignmentsByZoneId.values()) {
            if (assignments.some((a) => a.gridCellId)) return true;
          }
          return false;
        })()}
      />

      {mode === 'admin-select' && selectedZoneIds.length > 0 ? (
        <div
          className="fixed bottom-4 left-4 right-4 z-[1200] rounded-3xl border bg-white/95 p-4 shadow-2xl backdrop-blur"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">Carrés sélectionnés ({selectedZoneIds.length} carré{selectedZoneIds.length > 1 ? 's' : ''})</div>
            </div>
            <button
              type="button"
              onClick={() => {
                for (const id of selectedZoneIds) toggleSelection(id);
              }}
              className="rounded-xl border bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Vider
            </button>
          </div>

          <div className="flex max-h-20 flex-wrap gap-2 overflow-auto">
            {selectedZoneIds.map((id) => {
              const parts = id.split(':').slice(1);
              const cell = parts.filter((p) => p !== 'grid').join(':') || parts[parts.length - 1] || id;
              return (
                <span key={id} className="rounded-full bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">
                  {cell}
                </span>
              );
            })}
          </div>

          {selectedGridCellAssignments.length > 0 ? (
            <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-auto">
              {selectedGridCellAssignments.map((assignment) => (
                <span
                  key={`${assignment.selectionId}:${assignment.userId}`}
                  className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-semibold text-gray-800 shadow-sm"
                  style={{
                    borderColor: assignment.color,
                    backgroundColor: `${assignment.color}22`,
                  }}
                >
                  <span
                    className="h-3 w-3 rounded-full border border-white shadow"
                    style={{ backgroundColor: assignment.color }}
                  />
                  <span>{assignment.name}</span>
                  <button
                    type="button"
                    className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700"
                    onClick={async () => {
                      const ok = await confirmDialog({
                        title: 'Retirer cette attribution ?',
                        message: `Voulez-vous retirer ${assignment.name} du carré ${assignment.gridCellId} uniquement ?`,
                        confirmText: 'Oui',
                        cancelText: 'Non',
                      });
                      if (!ok) return;
                      try {
                        await unassignZoneFromUser(assignment.zoneId, assignment.userId, assignment.gridCellId);
                        await refetchAssignments();
                        setActivityToast(`Attribution retirée pour ${assignment.name}`);
                      } catch (e: any) {
                        console.error('Unassignment failed:', e);
                        alert(`Erreur de retrait: ${e?.message || 'Erreur inconnue'}`);
                      }
                    }}
                    aria-label={`Retirer ${assignment.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-3 flex gap-2">
            <select
              value={zoneAssignmentSelectedMemberId}
              onChange={(e) => setZoneAssignmentSelectedMemberId(e.target.value)}
              className="h-11 min-w-0 flex-1 rounded-2xl border bg-white px-3 text-sm outline-none focus:border-blue-500"
            >
              <option value="">Choisir un membre</option>
              {zoneAssignmentMembers
                .filter((member) => member.user)
                .map((member) => (
                  <option key={member.user!.id} value={member.user!.id}>
                    {member.user!.id === user?.id ? 'Moi' : member.user!.displayName}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={!zoneAssignmentSelectedMemberId}
              onClick={async () => {
                if (!selectedMissionId || !zoneAssignmentSelectedMemberId || selectedZoneIds.length === 0) return;
                // Grouper par zoneId, déduire gridCellId de chaque selectionId
                const byZone = new Map<string, (string | undefined)[]>();
                for (const sid of selectedZoneIds) {
                  const zoneId = sid.split(':')[0];
                  const cell = sid.includes(':grid:') ? sid.split(':').slice(2).join(':') : undefined;
                  const arr = byZone.get(zoneId) ?? [];
                  arr.push(cell);
                  byZone.set(zoneId, arr);
                }
                try {
                  await Promise.all(
                    Array.from(byZone.entries()).flatMap(([zoneId, cells]) =>
                      cells.map((cell) => assignZoneToUsers(zoneId, [zoneAssignmentSelectedMemberId], cell))
                    )
                  );
                  setZoneAssignmentSelectedMemberId('');
                  const assigneeName = zoneAssignmentMembers.find(m => m.user?.id === zoneAssignmentSelectedMemberId)?.user?.displayName ?? 'ce membre';
                  setActivityToast(`${selectedZoneIds.length} carré(s) attribué(s) à ${assigneeName}`);
                  for (const id of selectedZoneIds) toggleSelection(id);
                  // Pas de refetchAssignments ici : zone:assignments:changed met à jour le state via socket
                } catch (e: any) {
                  console.error('Assignment failed:', e);
                  alert(`Erreur d'assignation: ${e?.message || 'Erreur inconnue'}`);
                }
              }}
              className="h-11 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Assigner
            </button>
          </div>
        </div>
      ) : null}

      {personPanelOpen && personPanelCollapsed && !personEdit ? (
        <PersonPanelCollapsedBar
          open={true}
          personCase={personCase}
          personLoading={personLoading}
          formatElapsedSince={formatElapsedSince}
          onExpand={onExpandPersonPanel}
        />
      ) : personPanelOpen ? (
        <PersonPanelOverlay
          open={true}
          personPanelCollapsed={personPanelCollapsed}
          personEdit={personEdit}
          setPersonEdit={setPersonEdit}
          personCase={personCase}
          personLoading={personLoading}
          personError={personError}
          setPersonError={setPersonError}
          selectedMissionId={selectedMissionId ?? null}
          canEditPerson={canEditPerson}
          setConfirmDeletePersonCaseOpen={setConfirmDeletePersonCaseOpen}
          setPersonPanelCollapsed={setPersonPanelCollapsed}
          setPersonPanelOpen={setPersonPanelOpen}
          hasActiveTestVehicleTrack={hasActiveTestVehicleTrack}
          estimation={estimation}
          mobilityLabel={mobilityLabel}
          sexLabel={sexLabel}
          cleanDiseases={cleanDiseases}
          cleanInjuries={cleanInjuries}
          weatherLoading={weatherLoading}
          weatherError={weatherError}
          weather={weather}
          weatherStatusLabel={weatherStatusLabel}
          formatHoursToHM={formatHoursToHM}
          personDraft={personDraft}
          setPersonDraft={setPersonDraft}
          lastKnownWhenInputRef={lastKnownWhenInputRef}
          minLiveTrackWhenLocalMinute={minLiveTrackWhenLocalMinute}
          nowLocalMinute={nowLocalMinute}
          lastKnownSuggestionsOpen={lastKnownSuggestionsOpen}
          setLastKnownSuggestionsOpen={setLastKnownSuggestionsOpen}
          lastKnownPoiSuggestions={lastKnownPoiSuggestions}
          lastKnownAddressSuggestions={lastKnownAddressSuggestions}
          diseasesOpen={diseasesOpen}
          setDiseasesOpen={setDiseasesOpen}
          diseaseOptions={diseaseOptions}
          injuriesOpen={injuriesOpen}
          setInjuriesOpen={setInjuriesOpen}
          injuryOptions={injuryOptions}
          upsertPersonCase={upsertPersonCase}
          setPersonCase={setPersonCase}
          isTestTrack={isTestTrack}
          createVehicleTrack={createVehicleTrack}
          getVehicleTrackState={getVehicleTrackState}
          setActiveVehicleTrackId={setActiveVehicleTrackId}
          setVehicleTrackGeojsonById={setVehicleTrackGeojsonById}
          setPersonLoading={setPersonLoading}
        />
      ) : null}

      {timerModalOpen ? (
        <TimerModal
          open={true}
          timerSecondsInput={timerSecondsInput}
          setTimerSecondsInput={setTimerSecondsInput}
          timerError={timerError}
          timerSaving={timerSaving}
          onClose={onCloseTimerModal}
          onSave={onSaveTimerModal}
        />
      ) : null}

      {showValidation ? (
        <ValidationModal
          open={true}
          cancelDraft={cancelDraft}
          activeTool={activeTool}
          draftTitle={draftTitle}
          setDraftTitle={setDraftTitle}
          poiColorOptions={poiColorOptions}
          poiIconOptions={poiIconOptions as any}
          draftColor={draftColor}
          setDraftColor={setDraftColor}
          draftIcon={draftIcon}
          setDraftIcon={setDraftIcon}
          draftComment={draftComment}
          setDraftComment={setDraftComment}
          actionError={actionError}
          actionBusy={actionBusy}
          submitDraft={submitDraft}
        />
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
            className={`pointer-events-auto inline-flex max-w-[min(100vw-32px,1600px)] rounded-2xl bg-gray-900/90 px-6 py-3 text-sm text-white shadow-lg backdrop-blur transition-opacity duration-300 ${
              activityToastVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className="w-full text-center">{activityToast}</span>
          </div>
        </div>
      ) : null}

      {baptismApi.draft?.point && (
        <div className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-xl bg-white p-3 shadow-xl">
          {baptismApi.computeError ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-red-600">
                {baptismApi.computeError === 'NO_ROAD_NEARBY'
                  ? 'Aucune route trouvée à proximité (500 m).'
                  : baptismApi.computeError === 'OVERPASS_UNAVAILABLE'
                    ? 'Overpass indisponible. Vérifie ta connexion.'
                    : `Échec de l'enregistrement (${baptismApi.computeError}).`}
              </span>
              <button
                type="button"
                className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm"
                onClick={() => {
                  baptismApi.cancelDraft();
                  setActiveTool('none');
                }}
              >
                Annuler
              </button>
              <button type="button" className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white" onClick={() => void baptismApi.confirmDraft()}>
                Réessayer
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-700">Placer le point puis valider</span>
              <button
                type="button"
                className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm"
                onClick={() => {
                  baptismApi.cancelDraft();
                  setActiveTool('none');
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={baptismApi.computing}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                onClick={() => {
                  void baptismApi.confirmDraft().then((ok) => {
                    if (ok) setActiveTool('none');
                  });
                }}
              >
                {baptismApi.computing ? 'Calcul…' : 'Valider'}
              </button>
            </div>
          )}
        </div>
      )}

      {editingAxisId && baptismApi.baptism && (() => {
        const axis = baptismApi.baptism.axes.find((a) => a.axisId === editingAxisId);
        if (!axis) return null;
        return (
          <div key={axis.axisId} className="absolute inset-x-0 bottom-24 z-20 mx-auto w-full max-w-xl px-3">
            <div className="rounded-xl bg-white p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Axe {axis.name ? `TION ${axis.name}` : ''}</span>
                <button type="button" onClick={() => setEditingAxisId(null)} className="text-gray-500">✕</button>
              </div>
              {baptismApi.mutationError && (
                <p className="mb-2 text-xs text-red-600">
                  {baptismApi.mutationError === 'MIN_AXES'
                    ? 'Dernier axe : supprime le baptême pour tout effacer.'
                    : baptismApi.mutationError}
                </p>
              )}
              <input
                type="text"
                defaultValue={axis.name ?? ''}
                placeholder="Nom (ex. AUCHAN)"
                maxLength={40}
                className="mb-2 w-full rounded-lg border px-2 py-1.5 text-sm uppercase"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  void baptismApi.renameAxis(axis.axisId, v ? v : null);
                }}
              />
              {axis.suggestions.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {axis.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`rounded-full px-2 py-1 text-xs ${axis.name === s ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}
                      onClick={() => void baptismApi.renameAxis(axis.axisId, s)}
                    >
                      TION {s}
                    </button>
                  ))}
                </div>
              )}
              <div className="mb-2 flex flex-wrap gap-1">
                {AXIS_PALETTE.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="h-6 w-6 rounded-full border-2"
                    style={{ backgroundColor: c, borderColor: c === axis.color ? '#111827' : 'transparent' }}
                    onClick={() => void baptismApi.recolorAxis(axis.axisId, c)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="w-full rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600"
                onClick={() => {
                  void baptismApi.removeAxis(axis.axisId).then((ok) => {
                    if (ok) setEditingAxisId(null);
                  });
                }}
              >
                Supprimer cet axe
              </button>
            </div>
          </div>
        );
      })()}

      {baptismPanelOpen && baptismApi.baptism && (
        <div className="absolute inset-x-0 bottom-24 z-20 mx-auto w-full max-w-xl px-3">
          <div className="rounded-xl bg-white p-3 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Baptême terrain</span>
              <button type="button" onClick={() => setBaptismPanelOpen(false)} className="text-gray-500">✕</button>
            </div>
            {baptismApi.mutationError && (
              <p className="mb-2 text-xs text-red-600">
                {baptismApi.mutationError === 'MIN_AXES'
                  ? 'Dernier axe : supprime le baptême pour tout effacer.'
                  : baptismApi.mutationError}
              </p>
            )}
            <div className="mb-2 flex flex-wrap gap-1">
              {(['colors', 'tion', 'both'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`flex-1 rounded-lg px-2 py-1.5 text-xs ${baptismApi.baptism!.displayMode === m ? 'bg-gray-900 text-white' : 'bg-gray-100'}`}
                  onClick={() => void baptismApi.setDisplayMode(m)}
                >
                  {m === 'colors' ? 'Couleurs' : m === 'tion' ? 'TION' : 'Les deux'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="w-full rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-600"
              onClick={() => {
                void baptismApi.removeBaptism();
                setBaptismPanelOpen(false);
              }}
            >
              Supprimer le baptême
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

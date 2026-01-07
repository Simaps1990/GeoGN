import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMapInstance, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Circle, Crosshair, Layers, MapPin, Pencil, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useMission } from '../contexts/MissionContext';
import { getSocket } from '../lib/socket';
import { createPoi, createZone, listPois, listZones, type ApiPoi, type ApiPoiType, type ApiZone } from '../lib/api';

type MapStyleMode = 'streets' | 'topo';

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

export default function MapLibreMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<MapLibreMapInstance | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const socketRef = useRef<ReturnType<typeof getSocket> | null>(null);

  const polygonDraftRef = useRef<[number, number][]>([]);

  const [styleMode, setStyleMode] = useState<MapStyleMode>('streets');
  const [lastPos, setLastPos] = useState<{ lng: number; lat: number } | null>(null);
  const [tracePoints, setTracePoints] = useState<{ lng: number; lat: number; t: number }[]>([]);
  const [otherPositions, setOtherPositions] = useState<Record<string, { lng: number; lat: number; t: string }>>({});
  const [pois, setPois] = useState<ApiPoi[]>([]);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [mapStyleMode, setMapStyleMode] = useState<'city' | 'satellite'>('city');
  const [mapReady, setMapReady] = useState(false);

  const [zoneMenuOpen, setZoneMenuOpen] = useState(false);

  const [activeTool, setActiveTool] = useState<'none' | 'poi' | 'zone_circle' | 'zone_polygon'>('none');
  const [draftLngLat, setDraftLngLat] = useState<{ lng: number; lat: number } | null>(null);
  const [draftCircleRadius, setDraftCircleRadius] = useState(250);

  const [showValidation, setShowValidation] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftComment, setDraftComment] = useState('');
  const [draftColor, setDraftColor] = useState('#f97316');
  const [draftIcon, setDraftIcon] = useState('marker');
  const [draftPoiType, setDraftPoiType] = useState<ApiPoiType>('doute');

  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { user } = useAuth();
  const { selectedMissionId } = useMission();

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

  function toggleMapStyle() {
    setMapStyleMode((m: 'city' | 'satellite') => (m === 'city' ? 'satellite' : 'city'));
    setStyleMode((m: MapStyleMode) => (m === 'streets' ? 'topo' : 'streets'));
  }

  function openValidation() {
    setActionError(null);
    setShowValidation(true);
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

    const onDblClick = (e: any) => {
      if (activeTool !== 'zone_polygon') return;
      e.preventDefault();
      if (polygonDraftRef.current.length >= 3) {
        openValidation();
      }
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);

    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
    };
  }, [activeTool, mapReady, styleMode]);

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

    setActionBusy(true);
    setActionError(null);
    try {
      if (activeTool === 'poi') {
        const created = await createPoi(selectedMissionId, {
          type: draftPoiType,
          title: draftTitle.trim(),
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
          title: draftTitle.trim(),
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
          title: draftTitle.trim(),
          color: draftColor,
          polygon: { type: 'Polygon', coordinates: [ring] },
        });
        setZones((prev: ApiZone[]) => [created, ...prev]);
      }

      setDraftTitle('');
      setDraftComment('');
      setDraftColor('#f97316');
      setDraftIcon('marker');
      setDraftPoiType('doute');
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

  const styles = useMemo(
    () => ({
      streets: getRasterStyle(
        [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        '© OpenStreetMap contributors'
      ),
      topo: getRasterStyle(
        [
          'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
          'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
        ],
        '© OpenTopoMap (CC-BY-SA) / © OpenStreetMap contributors'
      ),
    }),
    []
  );

  useEffect(() => {
    if (!mapRef.current) return;
    if (mapInstanceRef.current) return;

    setMapReady(false);

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: styles[styleMode],
      center: [2.3522, 48.8566],
      zoom: 13,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-left');

    map.on('load', () => {
      setMapReady(true);

      map.addSource('me', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

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

      map.addSource('trace', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: 'trace-line',
        type: 'line',
        source: 'trace',
        paint: {
          'line-color': '#00ff00',
          'line-width': 4,
        },
      });

      map.addSource('others', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });
      map.addLayer({
        id: 'others-points',
        type: 'circle',
        source: 'others',
        paint: {
          'circle-radius': 6,
          'circle-color': '#2563eb',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      map.addSource('pois', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'pois',
        type: 'circle',
        source: 'pois',
        paint: {
          'circle-radius': 7,
          'circle-color': ['coalesce', ['get', 'color'], '#f97316'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      map.addSource('zones', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'zones-fill',
        type: 'fill',
        source: 'zones',
        paint: {
          'fill-color': ['coalesce', ['get', 'color'], '#22c55e'],
          'fill-opacity': 0.12,
        },
      });
      map.addLayer({
        id: 'zones-outline',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#16a34a'],
          'line-width': 2,
        },
      });
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, [styles, styleMode]);

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
  }, [pois]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('zones') as GeoJSONSource | undefined;
    if (!src) return;

    const features: any[] = [];
    for (const z of zones) {
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
  }, [zones]);

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
  }, [otherPositions]);

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
          title={mapStyleMode === 'city' ? 'Passer en satellite' : 'Passer en plan'}
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
      </div>

      {activeTool !== 'none' && !showValidation ? (
        <div className="absolute left-1/2 top-4 -translate-x-1/2 z-[1000] rounded-2xl border bg-white/90 px-4 py-2 text-sm shadow backdrop-blur">
          {activeTool === 'poi'
            ? 'Mode POI: clique sur la carte'
            : activeTool === 'zone_circle'
              ? 'Zone ronde: clique sur le centre'
              : 'Zone libre: clique pour poser des points, double-clic pour valider'}
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
                  <select
                    value={draftPoiType}
                    onChange={(e) => setDraftPoiType(e.target.value as ApiPoiType)}
                    className="h-11 w-full rounded-2xl border px-3 text-sm"
                  >
                    <option value="doute">Doute</option>
                    <option value="danger">Danger</option>
                    <option value="cible_trouvee">Cible trouvée</option>
                    <option value="zone_a_verifier">Zone à vérifier</option>
                    <option value="autre">Autre</option>
                  </select>
                  <select
                    value={draftIcon}
                    onChange={(e) => setDraftIcon(e.target.value)}
                    className="h-11 w-full rounded-2xl border px-3 text-sm"
                  >
                    <option value="marker">Marker</option>
                    <option value="warning">Warning</option>
                    <option value="target">Target</option>
                    <option value="eye">Eye</option>
                  </select>
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

              <div className="rounded-2xl border p-3">
                <div className="text-xs font-semibold text-gray-700">Couleur</div>
                <div className="mt-2 flex items-center gap-3">
                  <input type="color" value={draftColor} onChange={(e) => setDraftColor(e.target.value)} />
                  <div className="text-xs font-mono text-gray-600">{draftColor}</div>
                </div>
              </div>

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

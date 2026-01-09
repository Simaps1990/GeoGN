import { Outlet, useLocation, useParams } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useMission } from '../contexts/MissionContext';
import { useAuth } from '../contexts/AuthContext';
import MissionTabs from '../components/MissionTabs';
import { getSocket } from '../lib/socket';

export default function MissionLayout() {
  const { missionId } = useParams();
  const { selectedMissionId, selectMission } = useMission();
  const { user } = useAuth();
  const location = useLocation();
  const isMapRoute = !!missionId && location.pathname.endsWith(`/mission/${missionId}/map`);
  const watchIdRef = useRef<number | null>(null);
  const pendingBulkRef = useRef<{ lng: number; lat: number; t: number; speed?: number; heading?: number; accuracy?: number }[]>([]);

  useEffect(() => {
    if (!missionId) return;
    if (selectedMissionId !== missionId) {
      selectMission(missionId);
    }
  }, [missionId, selectedMissionId, selectMission]);

  // Keep sending position updates while navigating mission menus.
  useEffect(() => {
    if (!missionId) return;
    if (!user?.id) return;

    const socket = getSocket();
    // Always (re)join the mission room so we continue receiving updates / snapshots.
    const ensureJoined = () => {
      socket.emit('mission:join', { missionId });
    };
    ensureJoined();

    const pendingKey = `geogn.pendingPos.${missionId}.${user.id}`;
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

    const persistPending = () => {
      try {
        localStorage.setItem(pendingKey, JSON.stringify(pendingBulkRef.current.slice(-5000)));
      } catch {
        // ignore
      }
    };

    const flushPending = () => {
      const pts = pendingBulkRef.current;
      if (!pts || pts.length === 0) return;
      if (!socket.connected) return;
      socket.emit('position:bulk', { points: pts }, (res: any) => {
        if (res && res.ok) {
          pendingBulkRef.current = [];
          persistPending();
        }
      });
    };

    const onConnect = () => {
      ensureJoined();
      flushPending();
    };

    socket.on('connect', onConnect);
    socket.on('reconnect', onConnect as any);
    setTimeout(flushPending, 300);

    const pushOnePositionNow = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const payload = {
            lng: pos.coords.longitude,
            lat: pos.coords.latitude,
            speed: pos.coords.speed ?? undefined,
            heading: pos.coords.heading ?? undefined,
            accuracy: pos.coords.accuracy ?? undefined,
            t: Date.now(),
          };
          if (socket.connected) {
            socket.emit('position:update', payload);
          } else {
            pendingBulkRef.current = [...pendingBulkRef.current, payload].slice(-5000);
            persistPending();
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    };

    const onVisibilityOrFocus = () => {
      if (document.visibilityState !== 'visible') return;
      // iOS: after backgrounding, socket may be reconnected but not re-joined.
      ensureJoined();
      flushPending();
      pushOnePositionNow();
    };

    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    if (navigator.geolocation && !isMapRoute) {
      // Clear any previous watcher.
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const lng = pos.coords.longitude;
          const lat = pos.coords.latitude;
          const t = Date.now();
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
            persistPending();
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('reconnect', onConnect as any);
      persistPending();

      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);

      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [missionId, user?.id, location.pathname]);

  return (
    <div className={isMapRoute ? 'min-h-screen bg-gray-50' : 'min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]'}>
      <div className="w-full">
        <Outlet />
      </div>
      <MissionTabs />
    </div>
  );
}

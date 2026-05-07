import { useEffect, useRef } from 'react';
import { getSocket } from '../lib/socket';

type PendingPoint = {
  lng: number;
  lat: number;
  t: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
};

const MAX_PENDING = 5000;
const PERSIST_DEBOUNCE_MS = 2000;

/**
 * Lance UN watcher de géolocalisation tant que `enabled` est vrai.
 * - Si `enabled` passe à false (ex: on entre sur la route map qui a son propre
 *   watcher), le watcher est arrêté proprement.
 * - Émet `position:update` quand le socket est connecté, sinon empile dans
 *   une queue persistée en localStorage et flush via `position:bulk` au
 *   prochain `connect`.
 *
 * NOTE: `MapLibreMap.tsx` gère son propre watcher quand on est sur la route
 * map — ne pas dupliquer ici. Ce hook est désactivé sur la map via `enabled`.
 */
export function useMissionGeolocation(params: {
  missionId: string | null;
  userId: string | null;
  enabled: boolean;
}) {
  const { missionId, userId, enabled } = params;
  const watchIdRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingPoint[]>([]);
  const persistTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!missionId || !userId) return;
    if (!enabled) return; // MapLibreMap gère socket + watcher quand on est sur la map

    const socket = getSocket();
    const pendingKey = `geogn.pendingPos.${missionId}.${userId}`;

    // 1) Restaurer la queue persistée depuis localStorage (1x au montage)
    try {
      const raw = localStorage.getItem(pendingKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          pendingRef.current = parsed
            .filter(
              (p: any) =>
                p &&
                typeof p.lng === 'number' &&
                typeof p.lat === 'number' &&
                typeof p.t === 'number'
            )
            .slice(-MAX_PENDING);
        }
      }
    } catch {
      // ignore parse errors
    }

    // 2) Persistance debouncée pour ne pas bloquer le main thread
    const persistPending = () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
      persistTimeoutRef.current = window.setTimeout(() => {
        try {
          localStorage.setItem(
            pendingKey,
            JSON.stringify(pendingRef.current.slice(-MAX_PENDING))
          );
        } catch {
          // quota exceeded ou storage indisponible — ignore
        }
      }, PERSIST_DEBOUNCE_MS);
    };

    // 3) Flush des points en attente quand socket se reconnecte
    const flushPending = () => {
      const pts = pendingRef.current;
      if (!pts || pts.length === 0) return;
      if (!socket.connected) return;
      socket.emit('position:bulk', { points: pts }, (res: any) => {
        if (res && res.ok) {
          pendingRef.current = [];
          persistPending();
        }
      });
    };

    const ensureJoined = () => {
      socket.emit('mission:join', { missionId });
    };

    const onConnect = () => {
      ensureJoined();
      flushPending();
    };

    socket.on('connect', onConnect);
    socket.on('reconnect', onConnect as any);
    ensureJoined();
    // Petite latence pour laisser le socket finir son init avant le flush.
    window.setTimeout(flushPending, 300);

    // 4) Push immédiat d'une position au focus/visibility (hors watch)
    const pushOnePositionNow = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const payload: PendingPoint = {
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
            pendingRef.current = [...pendingRef.current, payload].slice(-MAX_PENDING);
            persistPending();
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    };

    const onVisibilityOrFocus = () => {
      if (document.visibilityState !== 'visible') return;
      ensureJoined();
      flushPending();
      pushOnePositionNow();
    };

    window.addEventListener('focus', onVisibilityOrFocus);
    document.addEventListener('visibilitychange', onVisibilityOrFocus);

    // 5) Watch GPS continu (uniquement si `enabled`)
    if (enabled && navigator.geolocation) {
      // Sécurité : on tue tout watcher orphelin précédent
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const payload: PendingPoint = {
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
            pendingRef.current = [...pendingRef.current, payload].slice(-MAX_PENDING);
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
      window.removeEventListener('focus', onVisibilityOrFocus);
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);

      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }

      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }

      // Persistance synchrone finale au démontage (acceptable car non répétitif)
      try {
        localStorage.setItem(
          pendingKey,
          JSON.stringify(pendingRef.current.slice(-MAX_PENDING))
        );
      } catch {
        // ignore
      }
    };
  }, [missionId, userId, enabled]);
}

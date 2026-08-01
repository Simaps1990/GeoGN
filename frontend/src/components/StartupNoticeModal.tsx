import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getApiBaseUrl } from '../lib/api';

const POLL_INTERVAL_MS = 2500;
// First health check gets this long to answer before we assume a cold start
// and show the countdown — avoids a blank screen if Render is slow to refuse
// the connection outright while still booting.
const COLD_START_GUARD_MS = 1500;
// Purely a UX estimate for the progress bar / countdown text, not a real
// deadline — Render's actual cold-start time varies.
const COLD_START_ESTIMATE_MS = 60_000;

// TODO: retirer cette modale une fois le backend basculé sur les serveurs de l'unité
export default function StartupNoticeModal(props: { open: boolean; onReady: () => void }) {
  const { open, onReady } = props;
  const [phase, setPhase] = useState<'checking' | 'cold'>('checking');
  const [coldStartAt, setColdStartAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timeoutRef = useRef<number | null>(null);

  // Ping /health immediately in the background — no button, no waiting for
  // user input. If the server answers right away, onReady() fires before the
  // countdown UI ever appears.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    let resolved = false;

    const markCold = () => {
      if (cancelled || resolved) return;
      setPhase((p) => (p === 'cold' ? p : 'cold'));
      setColdStartAt((prev) => prev ?? Date.now());
    };

    const guardId = window.setTimeout(markCold, COLD_START_GUARD_MS);

    const poll = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/health`);
        if (res.ok) {
          resolved = true;
          if (!cancelled) onReady();
          return;
        }
      } catch {
        // Backend still cold-booting (connection refused) — just retry.
      }
      markCold();
      if (!cancelled) {
        timeoutRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();

    return () => {
      cancelled = true;
      window.clearTimeout(guardId);
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, [open, onReady]);

  // Live-update the progress bar / countdown while waiting on a cold start.
  useEffect(() => {
    if (phase !== 'cold') return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [phase]);

  if (!open || phase !== 'cold') return null;

  const elapsedMs = coldStartAt ? now - coldStartAt : 0;
  const percent = Math.min(96, Math.max(4, (elapsedMs / COLD_START_ESTIMATE_MS) * 100));
  const secondsLeft = Math.max(0, Math.ceil((COLD_START_ESTIMATE_MS - elapsedMs) / 1000));
  const countdownLabel = secondsLeft > 0 ? `encore ~${secondsLeft}s` : 'presque prêt…';

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center text-center">
          <img
            src="/icon/patte.png"
            alt="GeoGN"
            className="h-28 w-28 object-contain drop-shadow -mt-4 -mb-4"
          />
          <h1 className="text-2xl font-semibold tracking-wide text-gray-900">GeoGN</h1>
          <div className="mt-2 text-sm font-medium text-gray-700">Le serveur s'initialise…</div>
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-gray-500">{countdownLabel}</div>
          <div className="mt-4 text-xs text-gray-400">
            Hébergement temporaire — ceci n'arrive qu'au premier chargement.
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

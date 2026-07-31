import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getApiBaseUrl } from '../lib/api';

const POLL_INTERVAL_MS = 2500;

// TODO: retirer cette modale une fois le backend basculé sur les serveurs de l'unité
export default function StartupNoticeModal(props: { open: boolean; onReady: () => void }) {
  const { open, onReady } = props;
  const [starting, setStarting] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !starting) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`${getApiBaseUrl()}/health`);
        if (res.ok) {
          if (!cancelled) onReady();
          return;
        }
      } catch {
        // Backend still cold-booting (connection refused) — just retry.
      }
      if (!cancelled) {
        timeoutRef.current = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    };
  }, [open, starting, onReady]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {!starting ? (
          <>
            <div className="text-base font-bold text-gray-900">Version limitée</div>
            <div className="mt-2 text-sm text-gray-700">
              GeoGN fonctionne actuellement sur une offre d'hébergement temporaire.
              Le premier chargement peut prendre jusqu'à une minute, le temps que
              le serveur redémarre. Cette limitation disparaîtra dès le
              basculement sur les serveurs de l'unité.
            </div>
            <div className="mt-5 flex items-center justify-end">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                onClick={() => setStarting(true)}
              >
                Démarrer
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center text-center">
            <img
              src="/icon/patte.png"
              alt="GeoGN"
              className="h-32 w-32 object-contain drop-shadow -mt-4 -mb-6"
            />
            <h1 className="text-2xl font-semibold tracking-wide text-gray-900">GeoGN</h1>
            <div className="mt-6 flex items-center justify-center gap-2">
              <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-2 w-2 rounded-full bg-gray-400 animate-bounce" />
            </div>
            <div className="mt-4 text-sm font-medium text-gray-700">Démarrage du serveur en cours…</div>
            <div className="mt-1 text-xs text-gray-500">Cela peut prendre jusqu'à une minute.</div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

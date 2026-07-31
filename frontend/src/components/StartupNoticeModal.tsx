import { createPortal } from 'react-dom';

// TODO: retirer cette modale une fois le backend basculé sur les serveurs de l'unité
export default function StartupNoticeModal(props: { open: boolean; onDismiss: () => void }) {
  const { open, onDismiss } = props;
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
            onClick={onDismiss}
          >
            J'ai compris
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

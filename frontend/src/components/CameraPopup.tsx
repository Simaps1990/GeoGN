import { memo } from 'react';
import { Cctv, X } from 'lucide-react';

export type SelectedCamera = {
  lng: number;
  lat: number;
  apparence: string;
  opType: 'public' | 'prive';
  idCamera: string;
};

type CameraPopupProps = {
  camera: SelectedCamera | null;
  onClose: () => void;
};

export const CameraPopup = memo(function CameraPopup({ camera, onClose }: CameraPopupProps) {
  if (!camera) return null;

  const raw = (camera.apparence || '').toString().trim().toLowerCase();
  const label = raw === 'nue' ? 'fixe' : camera.apparence || '';
  const camBg = camera.opType === 'public' ? '#3b82f6' : '#22c55e';

  return (
    <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl bg-white shadow-xl flex items-start gap-3 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mt-0.5 flex-shrink-0 flex items-center justify-center">
          <div
            className="h-7 w-7 border-2 border-white shadow flex items-center justify-center rotate-45"
            style={{ backgroundColor: camBg }}
          >
            <div className="-rotate-45 flex items-center justify-center h-full w-full">
              <Cctv size={16} color="#ffffff" strokeWidth={2.5} />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="truncate text-sm font-semibold text-gray-900">{`Caméra${label ? ` ${label}` : ''}`}</div>
          <div className="mt-1 text-xs text-gray-700 break-words">
            {camera.opType === 'public' ? 'Exploitant : public' : 'Exploitant : privé'}
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500">{camera.idCamera ? `N° ${camera.idCamera}` : 'N° inconnu'}</div>
        </div>
        <div className="ml-2 flex items-start">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
            title="Fermer"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
});

import { memo } from 'react';
import { ChevronUp } from 'lucide-react';
import type { ApiPersonCase } from '../lib/api';

type PersonPanelCollapsedBarProps = {
  open: boolean;
  personCase: ApiPersonCase | null;
  personLoading: boolean;
  formatElapsedSince: (iso: string | null | undefined) => string;
  onExpand: () => void;
};

export const PersonPanelCollapsedBar = memo(function PersonPanelCollapsedBar({
  open,
  personCase,
  personLoading,
  formatElapsedSince,
  onExpand,
}: PersonPanelCollapsedBarProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-[calc(max(env(safe-area-inset-bottom),16px)+80px)] z-[1250]"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <div className="rounded-3xl border bg-white/80 shadow-xl backdrop-blur p-3" onClick={onExpand}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-700">
              {personCase ? (
                <>
                  <span className="font-semibold text-gray-800">Départ depuis</span>{' '}
                  <span>{personCase.lastKnown?.query || '—'}</span>
                </>
              ) : (
                '—'
              )}
            </div>
            <div className="mt-1 text-xs text-gray-700">
              {personCase && personCase.lastKnown?.when ? (
                <>
                  <span>{new Date(personCase.lastKnown.when).toLocaleString()}</span>{' '}
                  <span className="text-gray-500">({formatElapsedSince(personCase.lastKnown.when)})</span>
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
              onClick={onExpand}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
              title="Déployer"
            >
              <ChevronUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

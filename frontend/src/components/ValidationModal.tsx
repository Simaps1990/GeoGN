import { memo } from 'react';
import { X } from 'lucide-react';

type ValidationModalProps = {
  open: boolean;
  cancelDraft: () => void;
  activeTool: 'none' | 'poi' | 'zone_circle' | 'zone_polygon';
  draftTitle: string;
  setDraftTitle: (v: string) => void;
  poiColorOptions: string[];
  poiIconOptions: { id: string; Icon: any; label: string }[];
  draftColor: string;
  setDraftColor: (v: string) => void;
  draftIcon: string;
  setDraftIcon: (v: string) => void;
  draftComment: string;
  setDraftComment: (v: string) => void;
  actionError: string | null;
  actionBusy: boolean;
  submitDraft: () => Promise<void> | void;
};

export const ValidationModal = memo(function ValidationModal({
  open,
  cancelDraft,
  activeTool,
  draftTitle,
  setDraftTitle,
  poiColorOptions,
  poiIconOptions,
  draftColor,
  setDraftColor,
  draftIcon,
  setDraftIcon,
  draftComment,
  setDraftComment,
  actionError,
  actionBusy,
  submitDraft,
}: ValidationModalProps) {
  if (!open) return null;

  return (
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
                          backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))',
                          borderColor:
                            (draftColor || '#ffffff').toLowerCase() === '#ffffff' ? '#9ca3af' : 'rgba(0,0,0,0.12)',
                        }}
                        aria-label={id}
                      >
                        {(() => {
                          const colorLower = (draftColor || '#ffffff').toLowerCase();
                          const iconColor = colorLower === '#ffffff' || colorLower === '#fde047' ? '#000000' : '#ffffff';
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
  );
});

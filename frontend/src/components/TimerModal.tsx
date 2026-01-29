import { memo } from 'react';
import { X } from 'lucide-react';

type TimerModalProps = {
  open: boolean;
  timerSecondsInput: string;
  setTimerSecondsInput: (v: string) => void;
  timerError: string | null;
  timerSaving: boolean;
  onClose: () => void;
  onSave: () => void;
};

export const TimerModal = memo(function TimerModal({
  open,
  timerSecondsInput,
  setTimerSecondsInput,
  timerError,
  timerSaving,
  onClose,
  onSave,
}: TimerModalProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[1300] flex items-center justify-center bg-black/30 px-4 pt-6 pb-28">
      <div className="w-full max-w-sm rounded-3xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-base font-bold text-gray-900">Durée de la piste</div>
          <button type="button" onClick={onClose} className="h-10 w-10 rounded-2xl border bg-white">
            <X className="mx-auto" size={18} />
          </button>
        </div>

        <div className="mt-3 grid gap-3">
          <div className="text-xs font-semibold text-gray-700">Durée (secondes)</div>
          <div className="text-[11px] text-gray-600">
            Ceci règle combien de temps la trace reste visible avant de commencer à s'effacer.
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            {[
              { label: "10'", value: 600 },
              { label: "20'", value: 1200 },
              { label: "30'", value: 1800 },
              { label: '1h', value: 3600 },
              { label: '2h', value: 7200 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setTimerSecondsInput(String(p.value))}
                className="h-8 rounded-2xl border bg-white px-3 text-xs font-semibold text-gray-800 hover:bg-gray-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="mt-1 flex items-center justify-center gap-3">
            <input
              type="text"
              inputMode="numeric"
              value={timerSecondsInput}
              onChange={(e) => setTimerSecondsInput(e.target.value)}
              className="h-10 w-24 rounded-2xl border px-3 text-sm text-center"
            />
            {(() => {
              const trimmed = timerSecondsInput.trim();
              const parsed = trimmed ? Number(trimmed) : NaN;
              if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed < 0) return null;
              const total = Math.floor(parsed);
              const h = Math.floor(total / 3600);
              const m = Math.floor((total % 3600) / 60);
              const s = total % 60;
              const parts: string[] = [];
              if (h > 0) parts.push(`${h} h`);
              if (h > 0 || m > 0) parts.push(`${m} min`);
              parts.push(`${s} s`);
              return <div className="text-sm font-medium text-gray-700">{parts.join(' ')}</div>;
            })()}
          </div>

          {timerError ? <div className="text-sm text-red-600">{timerError}</div> : null}

          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-11 rounded-2xl border bg-white text-sm font-semibold text-gray-700"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={timerSaving}
              onClick={onSave}
              className="h-11 rounded-2xl bg-blue-600 text-sm font-semibold text-white shadow disabled:opacity-50"
            >
              Valider
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

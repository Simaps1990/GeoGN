import { memo } from 'react';

type ConfirmDeletePersonCaseModalProps = {
  open: boolean;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export const ConfirmDeletePersonCaseModal = memo(function ConfirmDeletePersonCaseModal({
  open,
  loading,
  onCancel,
  onConfirm,
}: ConfirmDeletePersonCaseModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold text-gray-900">Supprimer la piste ?</div>
        <div className="mt-2 text-sm text-gray-700">Cette action est définitive.</div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-xl border bg-white px-4 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
            onClick={onCancel}
          >
            Annuler
          </button>
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
            disabled={loading}
            onClick={onConfirm}
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
});

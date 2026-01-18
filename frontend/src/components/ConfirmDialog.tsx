import { useCallback, useMemo, useState } from 'react';

type ConfirmVariant = 'danger' | 'primary';

export type ConfirmDialogOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
};


function ConfirmDialog(props: {
  open: boolean;
  options: ConfirmDialogOptions;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { open, options, busy, onCancel, onConfirm } = props;
  if (!open) return null;

  const variant = options.variant ?? 'danger';
  const confirmClass =
    variant === 'danger'
      ? 'inline-flex h-10 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50'
      : 'inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-base font-bold text-gray-900">{options.title}</div>
        {options.message ? <div className="mt-2 text-sm text-gray-700">{options.message}</div> : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-10 items-center justify-center rounded-xl border bg-white px-4 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
            onClick={onCancel}
          >
            {options.cancelText ?? 'Annuler'}
          </button>
          <button type="button" className={confirmClass} disabled={busy} onClick={onConfirm}>
            {options.confirmText ?? 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<ConfirmDialogOptions>({ title: '' });
  const [resolver, setResolver] = useState<((v: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmDialogOptions) => {
    setOptions(next);
    setBusy(false);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      setResolver(() => resolve);
    });
  }, []);

  const onCancel = useCallback(() => {
    setOpen(false);
    if (resolver) resolver(false);
    setResolver(null);
  }, [resolver]);

  const onConfirm = useCallback(() => {
    setOpen(false);
    if (resolver) resolver(true);
    setResolver(null);
  }, [resolver]);

  const dialog = useMemo(
    () => (
      <ConfirmDialog
        open={open}
        options={options}
        busy={busy}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    ),
    [open, options, busy, onCancel, onConfirm]
  );

  return {
    confirm,
    dialog,
    setBusy,
  };
}

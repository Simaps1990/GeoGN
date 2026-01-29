import { memo } from 'react';

type NavPickerTarget = { lng: number; lat: number; title: string } | null;

type NavPickerModalProps = {
  target: NavPickerTarget;
  isAndroid: boolean;
  onClose: () => void;
};

export const NavPickerModal = memo(function NavPickerModal({ target, isAndroid, onClose }: NavPickerModalProps) {
  if (!target) return null;

  return (
    <div className="absolute inset-0 z-[1200] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 pt-4 text-sm font-semibold text-gray-900">Selectionnez votre moyen de navigation</div>
        <div className="flex items-center justify-center gap-4 p-4">
          <button
            type="button"
            onClick={() => {
              const waze = `https://waze.com/ul?ll=${target.lat}%2C${target.lng}&navigate=yes`;
              window.open(waze, '_blank');
              onClose();
            }}
            className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
            title="Waze"
          >
            <img src="/icon/waze.png" alt="Waze" className="h-12 w-12 object-contain" />
          </button>
          <button
            type="button"
            onClick={() => {
              const q = encodeURIComponent(`${target.lat},${target.lng}`);
              const gmaps = `https://www.google.com/maps/search/?api=1&query=${q}`;
              window.open(gmaps, '_blank');
              onClose();
            }}
            className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
            title="Google Maps"
          >
            <img src="/icon/maps.png" alt="Google Maps" className="h-12 w-12 object-contain" />
          </button>
          {!isAndroid ? (
            <button
              type="button"
              onClick={() => {
                const label = encodeURIComponent(target.title || 'Cible');
                const apple = `http://maps.apple.com/?ll=${target.lat},${target.lng}&q=${label}`;
                window.open(apple, '_blank');
                onClose();
              }}
              className="inline-flex h-16 w-16 items-center justify-center rounded-2xl border bg-white shadow-sm hover:bg-gray-50"
              title="Plans (Apple)"
            >
              <img src="/icon/apple.png" alt="Plans (Apple)" className="h-12 w-12 object-contain" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
});

import { memo } from 'react';
import {
  AlertTriangle,
  Binoculars,
  Bomb,
  Bike,
  Car,
  Cctv,
  Church,
  CircleDot,
  Coffee,
  Dog,
  Flag,
  Flame,
  HelpCircle,
  House,
  MapPin,
  Mic,
  Navigation2,
  PawPrint,
  Pencil,
  Radiation,
  ShieldPlus,
  Siren,
  Skull,
  Trash2,
  Truck,
  UserRound,
  Warehouse,
  Zap,
} from 'lucide-react';
import type { ApiPoi } from '../lib/api';

type PoiPopupProps = {
  poi: ApiPoi | null;
  onClose: () => void;
  onNavigate: () => void;
  onStartTrack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  creatorLabel: string;
  canEditMap: boolean;
  hasActiveTestVehicleTrack: boolean;
  actionBusy: boolean;
};

export function getPoiIconComponent(iconId: string): typeof MapPin {
  switch (iconId) {
    case 'target':
      return CircleDot;
    case 'flag':
      return Flag;
    case 'alert':
      return AlertTriangle;
    case 'help':
      return HelpCircle;
    case 'flame':
      return Flame;
    case 'radiation':
      return Radiation;
    case 'bomb':
      return Bomb;
    case 'skull':
      return Skull;
    case 'user_round':
      return UserRound;
    case 'house':
      return House;
    case 'warehouse':
      return Warehouse;
    case 'church':
      return Church;
    case 'coffee':
      return Coffee;
    case 'car':
      return Car;
    case 'truck':
      return Truck;
    case 'motorcycle':
      return Bike;
    case 'cctv':
      return Cctv;
    case 'mic':
      return Mic;
    case 'dog':
      return Dog;
    case 'paw':
      return PawPrint;
    case 'siren':
      return Siren;
    case 'zap':
      return Zap;
    case 'shield_plus':
      return ShieldPlus;
    case 'binoculars':
      return Binoculars;
    default:
      return MapPin;
  }
}

export const PoiPopup = memo(function PoiPopup({
  poi,
  onClose,
  onNavigate,
  onStartTrack,
  onEdit,
  onDelete,
  creatorLabel,
  canEditMap,
  hasActiveTestVehicleTrack,
  actionBusy,
}: PoiPopupProps) {
  if (!poi) return null;

  const Icon = getPoiIconComponent(poi.icon);
  const bg = poi.color || '#f97316';
  const bgLower = bg.toLowerCase();
  const iconColor = bgLower === '#ffffff' || bgLower === '#fde047' ? '#000000' : '#ffffff';

  return (
    <div className="absolute inset-0 z-[1100] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-3xl bg-white shadow-xl flex items-start gap-3 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mt-0.5 flex-shrink-0 flex items-center justify-center">
          <div className="h-9 w-9 rounded-full border-2 border-white shadow" style={{ backgroundColor: bg }}>
            <div className="flex h-full w-full items-center justify-center">
              <Icon size={16} color={iconColor} strokeWidth={2.5} />
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="truncate text-sm font-semibold text-gray-900">{poi.title}</div>
          <div className="mt-1 text-xs text-gray-700 break-words">{poi.comment || 'Aucune description'}</div>
          <div className="mt-0.5 text-[11px] text-gray-500">{creatorLabel}</div>
        </div>
        <div className="ml-2 flex flex-col items-end gap-2 self-start">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onNavigate}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
              title="Naviguer vers le point"
            >
              <Navigation2 size={16} />
            </button>
            <button
              type="button"
              onClick={onStartTrack}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50 ${
                hasActiveTestVehicleTrack ? 'opacity-40 cursor-not-allowed hover:bg-white' : ''
              }`}
              title="Démarrer une piste depuis ce POI"
            >
              <PawPrint size={16} />
            </button>
          </div>
          {canEditMap ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-gray-800 shadow-sm hover:bg-gray-50"
                title="Éditer le POI"
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={onDelete}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border bg-white text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                title="Supprimer le POI"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

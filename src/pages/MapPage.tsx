import MapLibreMap from '../components/MapLibreMap';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function MapPage() {
  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => navigate('/mission')}
        className="fixed left-4 top-[calc(env(safe-area-inset-top)+16px)] z-[1200] inline-flex h-14 w-14 items-center justify-center rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
        title="Retour"
      >
        <ArrowLeft size={22} />
      </button>
      <MapLibreMap />
    </div>
  );
}

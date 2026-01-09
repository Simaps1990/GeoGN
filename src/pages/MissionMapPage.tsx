import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import MapLibreMap from '../components/MapLibreMap';

export default function MissionMapPage() {
  const navigate = useNavigate();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => navigate('/home')}
        className="absolute left-4 top-[calc(env(safe-area-inset-top)+16px)] z-[1200] inline-flex h-12 w-12 items-center justify-center rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
        title="Retour"
      >
        <ArrowLeft size={20} />
      </button>
      <MapLibreMap />
    </div>
  );
}

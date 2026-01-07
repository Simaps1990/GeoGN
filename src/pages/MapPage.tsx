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
        className="absolute left-4 top-4 z-[1200] inline-flex h-12 w-12 items-center justify-center rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
        title="Retour"
      >
        <ArrowLeft size={20} />
      </button>
      <MapLibreMap />
    </div>
  );
}

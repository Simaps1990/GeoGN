import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { listZones, type ApiZone } from '../lib/api';

export default function MissionZonesPage() {
  const { missionId } = useParams();
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!missionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const z = await listZones(missionId);
        if (cancelled) return;
        setZones(z);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-900">Zones</h1>
      {loading ? (
        <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
      ) : zones.length === 0 ? (
        <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucune zone.</div>
      ) : (
        <div className="mt-3 grid gap-2">
          {zones.map((z) => (
            <div key={z.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">{z.title}</div>
                <div className="text-xs text-gray-600">{z.type}</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-4 w-4 rounded" style={{ backgroundColor: z.color }} />
                <div className="text-xs font-mono text-gray-600">{z.color}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

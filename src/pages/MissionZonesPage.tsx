import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Map as MapIcon } from 'lucide-react';
import { deleteZone, listZones, updateZone, type ApiZone } from '../lib/api';

export default function MissionZonesPage() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [loading, setLoading] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

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
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl border-2 border-white shadow"
                    style={{ backgroundColor: z.color || '#22c55e' }}
                    title={z.title}
                  />
                  <div>
                    <div className="text-sm font-semibold text-gray-900">{z.title}</div>
                    <div className="mt-1 text-xs text-gray-600">Zone</div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!missionId}
                  onClick={() => {
                    if (!missionId) return;

                    let lng = 0;
                    let lat = 0;

                    if (z.type === 'circle' && z.circle?.center) {
                      lng = z.circle.center.lng;
                      lat = z.circle.center.lat;
                    } else if (z.type === 'polygon' && z.polygon?.coordinates?.[0]?.length) {
                      const ring = z.polygon.coordinates[0];
                      const pts = ring.slice(0, Math.max(0, ring.length - 1));
                      if (pts.length) {
                        lng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
                        lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
                      }
                    }

                    sessionStorage.setItem('geogn.centerZone', JSON.stringify({ missionId, lng, lat, zoom: 15 }));
                    navigate(`/mission/${missionId}/map`);
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border bg-white text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  title="Voir sur la carte"
                >
                  <MapIcon size={18} />
                </button>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={!missionId || busyId === z.id}
                  onClick={async () => {
                    if (!missionId) return;
                    const title = window.prompt('Titre zone', z.title);
                    if (title === null) return;
                    const color = window.prompt('Couleur (hex)', z.color);
                    if (color === null) return;

                    setBusyId(z.id);
                    try {
                      const updated = await updateZone(missionId, z.id, { title: title.trim(), color: color.trim() });
                      setZones((prev) => prev.map((x) => (x.id === z.id ? updated : x)));
                    } finally {
                      setBusyId(null);
                    }
                  }}
                  className="h-10 rounded-xl border bg-white px-3 text-sm text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  Modifier
                </button>
                <button
                  type="button"
                  disabled={!missionId || busyId === z.id}
                  onClick={async () => {
                    if (!missionId) return;
                    const ok = window.confirm('Supprimer cette zone ?');
                    if (!ok) return;
                    setBusyId(z.id);
                    try {
                      await deleteZone(missionId, z.id);
                      setZones((prev) => prev.filter((x) => x.id !== z.id));
                    } finally {
                      setBusyId(null);
                    }
                  }}
                  className="h-10 rounded-xl border bg-white px-3 text-sm text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

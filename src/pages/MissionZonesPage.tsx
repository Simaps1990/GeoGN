import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Map as MapIcon } from 'lucide-react';
import { deleteZone, listZones, updateZone, type ApiZone } from '../lib/api';

export default function MissionZonesPage() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [loading, setLoading] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    color: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const colorOptions = useMemo(
    () => ['#3b82f6', '#22c55e', '#f97316', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#64748b'],
    []
  );

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
      <h1 className="text-xl font-bold text-gray-900">Gestion des Zones</h1>
      {loading ? (
        <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
      ) : zones.length === 0 ? (
        <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucune zone.</div>
      ) : (
        <div className="mt-3 grid gap-2">
          {zones.map((z) => (
            <div key={z.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              {editingId === z.id && editDraft ? (
                <div className="grid gap-2">
                  <div className="text-sm font-semibold text-gray-900">Édition zone</div>

                  <input
                    value={editDraft.title}
                    onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                    placeholder="Titre"
                    className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
                  />

                  <div className="rounded-2xl border p-3">
                    <div className="text-xs font-semibold text-gray-700">Couleur</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {colorOptions.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditDraft({ ...editDraft, color: c })}
                          className={`h-9 w-9 rounded-xl border ${editDraft.color === c ? 'ring-2 ring-blue-500' : ''}`}
                          style={{ backgroundColor: c }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                    <div className="mt-2 text-xs font-mono text-gray-600">{editDraft.color}</div>
                  </div>

                  {editError ? <div className="text-sm text-red-700">{editError}</div> : null}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!missionId || busyId === z.id}
                      onClick={async () => {
                        if (!missionId || !editDraft) return;
                        setEditError(null);
                        const nextTitle = editDraft.title.trim();
                        if (!nextTitle) {
                          setEditError('Titre requis');
                          return;
                        }

                        setBusyId(z.id);
                        try {
                          const updated = await updateZone(missionId, z.id, {
                            title: nextTitle,
                            color: editDraft.color.trim(),
                          });
                          setZones((prev) => prev.map((x) => (x.id === z.id ? updated : x)));
                          setEditingId(null);
                          setEditDraft(null);
                        } catch (e: any) {
                          setEditError(e?.message ?? 'Erreur');
                        } finally {
                          setBusyId(null);
                        }
                      }}
                      className="h-10 flex-1 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow disabled:opacity-50"
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      disabled={busyId === z.id}
                      onClick={() => {
                        setEditingId(null);
                        setEditDraft(null);
                        setEditError(null);
                      }}
                      className="h-10 flex-1 rounded-xl border bg-white px-3 text-sm text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}

              {editingId !== z.id && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={!missionId || busyId === z.id}
                    onClick={async () => {
                      if (!missionId) return;
                      setEditingId(z.id);
                      setEditError(null);
                      setEditDraft({
                        title: z.title,
                        color: z.color,
                      });
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
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

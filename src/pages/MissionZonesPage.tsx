import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CircleDot, Spline, Grid2X2, Map as MapIcon } from 'lucide-react';
import { deleteZone, getMission, listZones, updateZone, type ApiMission, type ApiZone } from '../lib/api';

export default function MissionZonesPage() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const [mission, setMission] = useState<ApiMission | null>(null);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [loading, setLoading] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    comment: string;
    color: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [gridErrorByZoneId, setGridErrorByZoneId] = useState<Record<string, string>>({});

  const colorOptions = useMemo(
    () => [
      '#ef4444',
      '#f97316',
      '#fde047',
      '#4ade80',
      '#596643',
      '#60a5fa',
      '#1e3a8a',
      '#a855f7',
      '#ec4899',
      '#6b3f35',
      '#a19579',
      '#000000',
      '#ffffff',
    ],
    []
  );

  useEffect(() => {
    if (!missionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const m = await getMission(missionId);
        if (!cancelled) setMission(m);
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

  // Tant que la mission n'est pas chargée, ne pas afficher les contrôles d'édition
  const canEdit = !!mission && mission.membership?.role !== 'viewer';
  const isAdmin = mission?.membership?.role === 'admin';

  async function setZoneGrid(zoneId: string, nextGrid: ApiZone['grid']) {
    if (!missionId) return;
    setGridErrorByZoneId((prev) => {
      const { [zoneId]: _ignored, ...rest } = prev;
      return rest;
    });

    const prevZone = zones.find((x) => x.id === zoneId);
    setZones((prev) => prev.map((x) => (x.id === zoneId ? { ...x, grid: nextGrid } : x)));

    setBusyId(zoneId);
    try {
      const updated = await updateZone(missionId, zoneId, { grid: nextGrid });
      setZones((prev) => prev.map((x) => (x.id === zoneId ? updated : x)));
    } catch (e: any) {
      if (prevZone) setZones((prev) => prev.map((x) => (x.id === zoneId ? prevZone : x)));
      setGridErrorByZoneId((prev) => ({ ...prev, [zoneId]: e?.message ?? 'Erreur' }));
    } finally {
      setBusyId(null);
    }
  }

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

                  <input
                    value={editDraft.comment}
                    onChange={(e) => setEditDraft({ ...editDraft, comment: e.target.value })}
                    placeholder="Commentaire"
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
                          style={{
                            backgroundColor: c,
                            backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))',
                            borderColor: c.toLowerCase() === '#ffffff' ? '#9ca3af' : 'rgba(0,0,0,0.12)',
                          }}
                          aria-label={c}
                        />
                      ))}
                    </div>
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
                            comment: editDraft.comment.trim(),
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
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-1 items-start gap-3 overflow-hidden">
                    <div
                      className="mt-0.5 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border-2 border-white shadow"
                      style={{ backgroundColor: z.color || '#22c55e' }}
                      title={z.title}
                    >
                      {z.type === 'circle' ? (
                        <CircleDot size={18} className="text-white" />
                      ) : (
                        <Spline size={18} className="text-white" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900">{z.title}</div>
                      <div className="mt-1 text-xs text-gray-600 break-words">
                        {z.comment?.trim() ? z.comment : z.type === 'circle' ? 'Zone circulaire' : z.type === 'polygon' ? 'Zone polygonale' : 'Zone'}
                      </div>
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
                    className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border bg-white text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                    title="Voir sur la carte"
                  >
                    <MapIcon size={18} />
                  </button>
                </div>
              )}

              {editingId !== z.id && (
                <div className="mt-3 space-y-3">
                  {isAdmin ? (
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, { rows: 2, cols: 2 });
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          z.grid?.rows === 2 && z.grid?.cols === 2 ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Carroyage 2x2"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>2x2</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, { rows: 3, cols: 3 });
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          z.grid?.rows === 3 && z.grid?.cols === 3 ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Carroyage 3x3"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>3x3</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, { rows: 4, cols: 4 });
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          z.grid?.rows === 4 && z.grid?.cols === 4 ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Carroyage 4x4"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>4x4</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, { rows: 5, cols: 5 });
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          z.grid?.rows === 5 && z.grid?.cols === 5 ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Carroyage 5x5"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>5x5</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, { rows: 6, cols: 6 });
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          z.grid?.rows === 6 && z.grid?.cols === 6 ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Carroyage 6x6"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>6x6</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, { rows: 8, cols: 8 });
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          z.grid?.rows === 8 && z.grid?.cols === 8 ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Carroyage 8x8"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>8x8</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, { rows: 10, cols: 10 });
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          z.grid?.rows === 10 && z.grid?.cols === 10 ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Carroyage 10x10"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>10x10</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, { rows: 12, cols: 12 });
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          z.grid?.rows === 12 && z.grid?.cols === 12 ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Carroyage 12x12"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>12x12</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          await setZoneGrid(z.id, null);
                        }}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm shadow-sm hover:bg-gray-50 disabled:opacity-50 ${
                          !z.grid ? 'ring-2 ring-blue-500' : ''
                        }`}
                        title="Désactiver le carroyage"
                      >
                        <span className="inline-flex items-center gap-2">
                          <Grid2X2 size={16} />
                          <span>Sans</span>
                        </span>
                      </button>
                    </div>
                  ) : null}

                  {canEdit ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!missionId || busyId === z.id}
                        onClick={async () => {
                          if (!missionId) return;
                          setEditingId(z.id);
                          setEditError(null);
                          setEditDraft({
                            title: z.title,
                            comment: z.comment ?? '',
                            color: z.color,
                          });
                        }}
                        className="h-10 flex-1 rounded-xl border bg-white px-3 text-sm text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
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
                        className="h-10 flex-1 rounded-xl border bg-white px-3 text-sm text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                      >
                        Supprimer
                      </button>
                    </div>
                  ) : null}
                </div>
              )}

              {gridErrorByZoneId[z.id] ? <div className="mt-2 text-sm text-red-700">{gridErrorByZoneId[z.id]}</div> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

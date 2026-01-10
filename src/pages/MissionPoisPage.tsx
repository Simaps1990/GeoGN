import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Binoculars,
  Bomb,
  Bike,
  Car,
  Cctv,
  Church,
  Coffee,
  Flag,
  Flame,
  HelpCircle,
  House,
  Map as MapIcon,
  Mic,
  PawPrint,
  Radiation,
  ShieldPlus,
  Siren,
  Skull,
  Target,
  Truck,
  UserRound,
  Warehouse,
  Dog,
  Zap,
} from 'lucide-react';
import { deletePoi, getMission, listPois, updatePoi, type ApiMission, type ApiPoi } from '../lib/api';

export default function MissionPoisPage() {
  const { missionId } = useParams();
  const navigate = useNavigate();
  const [mission, setMission] = useState<ApiMission | null>(null);
  const [pois, setPois] = useState<ApiPoi[]>([]);
  const [loading, setLoading] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    title: string;
    icon: string;
    color: string;
    comment: string;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

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

  const iconOptions = useMemo(
    () => [
      { id: 'target', Icon: Target },
      { id: 'flag', Icon: Flag },
      { id: 'alert', Icon: AlertTriangle },
      { id: 'help', Icon: HelpCircle },
      { id: 'flame', Icon: Flame },
      { id: 'radiation', Icon: Radiation },
      { id: 'bomb', Icon: Bomb },
      { id: 'skull', Icon: Skull },
      { id: 'user_round', Icon: UserRound },
      { id: 'house', Icon: House },
      { id: 'warehouse', Icon: Warehouse },
      { id: 'church', Icon: Church },
      { id: 'coffee', Icon: Coffee },
      { id: 'car', Icon: Car },
      { id: 'truck', Icon: Truck },
      { id: 'motorcycle', Icon: Bike },
      { id: 'cctv', Icon: Cctv },
      { id: 'mic', Icon: Mic },
      { id: 'dog', Icon: Dog },
      { id: 'paw', Icon: PawPrint },
      { id: 'siren', Icon: Siren },
      { id: 'zap', Icon: Zap },
      { id: 'shield_plus', Icon: ShieldPlus },
      { id: 'binoculars', Icon: Binoculars },
    ],
    []
  );

  const iconById = useMemo(() => {
    const m: Record<string, typeof Target> = {};
    for (const { id, Icon } of iconOptions) {
      m[id] = Icon;
    }
    return m;
  }, [iconOptions]);

  function IconForId({ id, size }: { id: string; size?: number }) {
    const Icon = iconById[id] ?? Target;
    return <Icon size={size ?? 18} />;
  }

  useEffect(() => {
    if (!missionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const m = await getMission(missionId);
        if (!cancelled) setMission(m);
        const p = await listPois(missionId);
        if (cancelled) return;
        setPois(p);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionId]);

  // Tant que la mission n'est pas chargée, masquer les contrôles d'édition
  const canEdit = !!mission && mission.membership?.role !== 'viewer';

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-900">Gestion des Points d'Interet</h1>
      {loading ? (
        <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
      ) : pois.length === 0 ? (
        <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucun POI.</div>
      ) : (
        <div className="mt-3 grid gap-2">
          {pois.map((p) => (
            <div key={p.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              {editingId === p.id && editDraft ? (
                <div className="grid gap-2">
                  <div className="text-sm font-semibold text-gray-900">Édition POI</div>

                  <input
                    value={editDraft.title}
                    onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                    placeholder="Titre"
                    className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
                  />

                  <div className="rounded-2xl border p-3">
                    <div className="text-xs font-semibold text-gray-700">Couleur</div>
                    <div className="mt-2 grid grid-cols-8 gap-2">
                      {colorOptions.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditDraft({ ...editDraft, color: c })}
                          className={`h-7 w-7 rounded-xl border ${editDraft.color === c ? 'ring-2 ring-blue-500' : ''}`}
                          style={{
                            backgroundColor: c,
                            backgroundImage:
                              'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))',
                            borderColor: c.toLowerCase() === '#ffffff' ? '#9ca3af' : 'rgba(0,0,0,0.12)',
                          }}
                          aria-label={c}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border p-3">
                    <div className="text-xs font-semibold text-gray-700">Icône</div>
                    <div className="mt-2 grid grid-cols-6 gap-2">
                      {iconOptions.map(({ id, Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setEditDraft({ ...editDraft, icon: id })}
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl border ${
                            editDraft.icon === id ? 'ring-2 ring-blue-500' : ''
                          }`}
                          style={{
                            backgroundColor: editDraft.color || '#ffffff',
                            backgroundImage:
                              'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))',
                            borderColor:
                              (editDraft.color || '#ffffff').toLowerCase() === '#ffffff'
                                ? '#9ca3af'
                                : 'rgba(0,0,0,0.12)',
                          }}
                          aria-label={id}
                        >
                          {(() => {
                            const colorLower = (editDraft.color || '#ffffff').toLowerCase();
                            const iconColor =
                              colorLower === '#ffffff' || colorLower === '#fde047' ? '#000000' : '#ffffff';
                            return <Icon size={18} color={iconColor} />;
                          })()}
                        </button>
                      ))}
                    </div>
                  </div>

                  <textarea
                    value={editDraft.comment}
                    onChange={(e) => setEditDraft({ ...editDraft, comment: e.target.value })}
                    placeholder="Commentaire"
                    className="min-h-[80px] w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-blue-500"
                  />

                  {editError ? <div className="text-sm text-red-700">{editError}</div> : null}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!missionId || busyId === p.id}
                      onClick={async () => {
                        if (!missionId || !editDraft) return;
                        setEditError(null);
                        const nextTitle = editDraft.title.trim();
                        if (!nextTitle) {
                          setEditError('Titre requis');
                          return;
                        }
                        const key = nextTitle.toLowerCase();
                        const duplicate = pois.some((x) => x.id !== p.id && x.title.trim().toLowerCase() === key);
                        if (duplicate) {
                          setEditError('Ce titre est déjà utilisé');
                          return;
                        }

                        setBusyId(p.id);
                        try {
                          const updated = await updatePoi(missionId, p.id, {
                            title: nextTitle,
                            icon: editDraft.icon,
                            color: editDraft.color.trim(),
                            comment: editDraft.comment.trim() || '-',
                          });
                          setPois((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
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
                      disabled={busyId === p.id}
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
                        className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-white shadow"
                        style={{ backgroundColor: p.color || '#f97316' }}
                        title={p.title}
                      >
                        {(() => {
                          const colorLower = (p.color || '#f97316').toLowerCase();
                          const iconColor =
                            colorLower === '#ffffff' || colorLower === '#fde047' ? '#000000' : '#ffffff';
                          return (
                            <div style={{ color: iconColor }}>
                              <IconForId id={p.icon} size={18} />
                            </div>
                          );
                        })()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{p.title}</div>
                        <div className="mt-1 text-xs text-gray-600">{p.comment}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!missionId}
                      onClick={() => {
                        if (!missionId) return;
                        sessionStorage.setItem(
                          'geogn.centerPoi',
                          JSON.stringify({ missionId, lng: p.lng, lat: p.lat, zoom: 17 })
                        );
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

              {editingId !== p.id && canEdit ? (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={!missionId || busyId === p.id}
                    onClick={async () => {
                      if (!missionId) return;
                      setEditingId(p.id);
                      setEditError(null);
                      setEditDraft({
                        title: p.title,
                        icon: p.icon,
                        color: p.color,
                        comment: p.comment,
                      });
                    }}
                    className="h-10 rounded-xl border bg-white px-3 text-sm text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    disabled={!missionId || busyId === p.id}
                    onClick={async () => {
                      if (!missionId) return;
                      const ok = window.confirm('Supprimer ce POI ?');
                      if (!ok) return;
                      setBusyId(p.id);
                      try {
                        await deletePoi(missionId, p.id);
                        setPois((prev) => prev.filter((x) => x.id !== p.id));
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    className="h-10 rounded-xl border bg-white px-3 text-sm text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                  >
                    Supprimer
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

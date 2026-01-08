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
  Plane,
  Radiation,
  Shield,
  Skull,
  Target,
  Tent,
  Truck,
  Warehouse,
  MessageCircle,
  Users,
  Dog,
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
    () => ['#3b82f6', '#22c55e', '#f97316', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#64748b', '#ec4899', '#000000', '#ffffff'],
    []
  );

  const iconOptions = useMemo(
    () => [
      { id: 'target', Icon: Target },
      { id: 'skull', Icon: Skull },
      { id: 'help', Icon: HelpCircle },
      { id: 'alert', Icon: AlertTriangle },
      { id: 'flag', Icon: Flag },
      { id: 'binoculars', Icon: Binoculars },
      { id: 'bomb', Icon: Bomb },
      { id: 'car', Icon: Car },
      { id: 'cctv', Icon: Cctv },
      { id: 'church', Icon: Church },
      { id: 'coffee', Icon: Coffee },
      { id: 'flame', Icon: Flame },
      { id: 'helicopter', Icon: Plane },
      { id: 'mic', Icon: Mic },
      { id: 'paw', Icon: PawPrint },
      { id: 'radiation', Icon: Radiation },
      { id: 'warehouse', Icon: Warehouse },
      { id: 'truck', Icon: Truck },
      { id: 'motorcycle', Icon: Bike },
      { id: 'shield', Icon: Shield },
      { id: 'tent', Icon: Tent },
      { id: 'house', Icon: House },
      { id: 'speech', Icon: MessageCircle },
      { id: 'users', Icon: Users },
      { id: 'dog', Icon: Dog },
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

  const canEdit = mission?.membership?.role !== 'viewer';

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
                    <div className="text-xs font-semibold text-gray-700">Icône</div>
                    <div className="mt-2 grid grid-cols-5 gap-2">
                      {iconOptions.map(({ id, Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setEditDraft({ ...editDraft, icon: id })}
                          className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl border bg-white ${
                            editDraft.icon === id ? 'ring-2 ring-blue-500' : 'hover:bg-gray-50'
                          }`}
                          aria-label={id}
                        >
                          <Icon size={20} />
                        </button>
                      ))}
                    </div>
                  </div>

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
                        <div className={p.color?.toLowerCase() === '#ffffff' ? 'text-black' : 'text-white'}>
                          <IconForId id={p.icon} size={18} />
                        </div>
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

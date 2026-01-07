import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Flag, HelpCircle, Skull, Target } from 'lucide-react';
import { deletePoi, listPois, updatePoi, type ApiPoi } from '../lib/api';

export default function MissionPoisPage() {
  const { missionId } = useParams();
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
    () => ['#3b82f6', '#22c55e', '#f97316', '#ef4444', '#a855f7', '#14b8a6', '#eab308', '#64748b'],
    []
  );

  const iconOptions = useMemo(
    () => [
      { id: 'target', Icon: Target },
      { id: 'skull', Icon: Skull },
      { id: 'help', Icon: HelpCircle },
      { id: 'alert', Icon: AlertTriangle },
      { id: 'flag', Icon: Flag },
    ],
    []
  );

  useEffect(() => {
    if (!missionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
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

  return (
    <div className="p-4 pb-24">
      <h1 className="text-xl font-bold text-gray-900">POI</h1>
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
                    <div className="mt-2 text-xs font-mono text-gray-600">{editDraft.color}</div>
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
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">{p.title}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-4 w-4 rounded" style={{ backgroundColor: p.color }} />
                    <div className="text-xs font-mono text-gray-600">{p.color}</div>
                    <div className="ml-auto text-xs text-gray-500">{p.icon}</div>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">{p.comment}</div>
                </>
              )}

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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

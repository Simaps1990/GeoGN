import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { deletePoi, listPois, updatePoi, type ApiPoi } from '../lib/api';

export default function MissionPoisPage() {
  const { missionId } = useParams();
  const [pois, setPois] = useState<ApiPoi[]>([]);
  const [loading, setLoading] = useState(true);

  const [busyId, setBusyId] = useState<string | null>(null);

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
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-gray-900">{p.title}</div>
                <div className="text-xs text-gray-600">{p.type}</div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-4 w-4 rounded" style={{ backgroundColor: p.color }} />
                <div className="text-xs font-mono text-gray-600">{p.color}</div>
              </div>
              <div className="mt-2 text-xs text-gray-600">{p.comment}</div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={!missionId || busyId === p.id}
                  onClick={async () => {
                    if (!missionId) return;
                    const title = window.prompt('Titre POI', p.title);
                    if (title === null) return;
                    const comment = window.prompt('Commentaire', p.comment);
                    if (comment === null) return;
                    const color = window.prompt('Couleur (hex)', p.color);
                    if (color === null) return;

                    setBusyId(p.id);
                    try {
                      const updated = await updatePoi(missionId, p.id, {
                        title: title.trim(),
                        comment: comment.trim(),
                        color: color.trim(),
                      });
                      setPois((prev) => prev.map((x) => (x.id === p.id ? updated : x)));
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

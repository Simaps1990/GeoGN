import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Plus, RefreshCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createMission, listMissions, sendMissionInvite, type ApiMission } from '../lib/api';
import { useMission } from '../contexts/MissionContext';

function formatDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

export default function MissionsPage() {
  const navigate = useNavigate();
  const { selectedMissionId, selectMission } = useMission();
  const [missions, setMissions] = useState<ApiMission[]>([]);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inviteAppUserIdByMission, setInviteAppUserIdByMission] = useState<Record<string, string>>({});
  const [inviteBusyMissionId, setInviteBusyMissionId] = useState<string | null>(null);
  const [inviteMessageByMission, setInviteMessageByMission] = useState<Record<string, string>>({});

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const data = await listMissions();
      setMissions(data);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createMission(title.trim());
      setTitle('');
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSendInvite(missionId: string) {
    const invitedAppUserId = (inviteAppUserIdByMission[missionId] ?? '').trim();
    if (!invitedAppUserId) return;

    setInviteBusyMissionId(missionId);
    setInviteMessageByMission((prev) => ({ ...prev, [missionId]: '' }));
    try {
      await sendMissionInvite(missionId, invitedAppUserId);
      setInviteAppUserIdByMission((prev) => ({ ...prev, [missionId]: '' }));
      setInviteMessageByMission((prev) => ({ ...prev, [missionId]: 'Invitation envoyée' }));
    } catch (e: any) {
      setInviteMessageByMission((prev) => ({ ...prev, [missionId]: e?.message ?? 'Erreur' }));
    } finally {
      setInviteBusyMissionId(null);
    }
  }

  const sorted = useMemo(() => {
    return [...missions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [missions]);

  function onOpenMission(missionId: string) {
    selectMission(missionId);
    navigate('/map');
  }

  return (
    <div className="p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Missions</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <RefreshCcw size={16} />
          Actualiser
        </button>
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Créer une mission</div>
        <div className="mt-3 flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nom de la mission (ex: Opération Alpha)"
            className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={submitting || !title.trim()}
            onClick={() => void onCreate()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow disabled:opacity-50"
          >
            <Plus size={16} />
            Créer
          </button>
        </div>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">
            Aucune mission pour le moment.
          </div>
        ) : (
          <div className="grid gap-3">
            {sorted.map((m) => (
              <div key={m.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900">{m.title}</div>
                    <div className="mt-1 text-xs text-gray-500">Dernière mise à jour: {formatDate(m.updatedAt)}</div>
                    {selectedMissionId === m.id ? (
                      <div className="mt-2 inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                        Mission sélectionnée
                      </div>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                      {m.status}
                    </div>
                    {m.membership?.role ? (
                      <div className="mt-2 text-xs font-medium text-gray-700">Rôle: {m.membership.role}</div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => onOpenMission(m.id)}
                      className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow"
                    >
                      Ouvrir
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>

                {m.membership?.role === 'admin' ? (
                  <div className="mt-4 rounded-2xl border bg-gray-50 p-3">
                    <div className="text-xs font-semibold text-gray-700">Inviter un membre (appUserId)</div>
                    <div className="mt-2 flex gap-2">
                      <input
                        value={inviteAppUserIdByMission[m.id] ?? ''}
                        onChange={(e) =>
                          setInviteAppUserIdByMission((prev) => ({ ...prev, [m.id]: e.target.value }))
                        }
                        placeholder="ex: 7F3K9Q"
                        className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
                      />
                      <button
                        type="button"
                        disabled={inviteBusyMissionId === m.id || !(inviteAppUserIdByMission[m.id] ?? '').trim()}
                        onClick={() => void onSendInvite(m.id)}
                        className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow disabled:opacity-50"
                      >
                        Inviter
                      </button>
                    </div>
                    {inviteMessageByMission[m.id] ? (
                      <div
                        className={`mt-2 text-xs ${
                          inviteMessageByMission[m.id] === 'Invitation envoyée' ? 'text-green-700' : 'text-red-700'
                        }`}
                      >
                        {inviteMessageByMission[m.id]}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

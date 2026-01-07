import { useEffect, useState } from 'react';
import { ArrowRight, Check, RefreshCcw, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  acceptInvite,
  createMission,
  declineInvite,
  getMission,
  listInvites,
  listMissions,
  updateMission,
  type ApiInvite,
  type ApiMission,
} from '../lib/api';
import { useMission } from '../contexts/MissionContext';

export default function CurrentMissionPage() {
  const navigate = useNavigate();
  const { selectedMissionId, selectMission } = useMission();

  const [missions, setMissions] = useState<ApiMission[]>([]);
  const [missionsLoading, setMissionsLoading] = useState(true);

  const [newMissionTitle, setNewMissionTitle] = useState('');
  const [creatingMission, setCreatingMission] = useState(false);

  const [mission, setMission] = useState<ApiMission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [invites, setInvites] = useState<ApiInvite[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesBusyToken, setInvitesBusyToken] = useState<string | null>(null);

  const [retentionSeconds, setRetentionSeconds] = useState<number>(3600);
  const [savingSettings, setSavingSettings] = useState(false);

  async function refreshSelectedMission() {
    if (!selectedMissionId) {
      setMission(null);
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const data = await getMission(selectedMissionId);
      setMission(data);
      setRetentionSeconds(data.traceRetentionSeconds ?? 3600);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  async function refreshMissions() {
    setMissionsLoading(true);
    try {
      const data = await listMissions();
      setMissions(data);
    } catch {
      setMissions([]);
    } finally {
      setMissionsLoading(false);
    }
  }

  async function refreshInvites() {
    setInvitesLoading(true);
    try {
      const data = await listInvites();
      setInvites(data);
    } catch {
      setInvites([]);
    } finally {
      setInvitesLoading(false);
    }
  }

  useEffect(() => {
    void refreshMissions();
    void refreshInvites();
  }, []);

  useEffect(() => {
    void refreshSelectedMission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMissionId]);

  

  function onOpenMission(missionId: string) {
    selectMission(missionId);
    navigate(`/mission/${missionId}`);
  }

  async function onCreateMission() {
    if (!newMissionTitle.trim()) return;
    setCreatingMission(true);
    try {
      const created = await createMission(newMissionTitle.trim());
      setNewMissionTitle('');
      await refreshMissions();
      onOpenMission(created.id);
    } finally {
      setCreatingMission(false);
    }
  }

  async function onAcceptInvite(token: string) {
    setInvitesBusyToken(token);
    try {
      await acceptInvite(token);
      await refreshInvites();
      await refreshMissions();
    } finally {
      setInvitesBusyToken(null);
    }
  }

  async function onDeclineInvite(token: string) {
    setInvitesBusyToken(token);
    try {
      await declineInvite(token);
      await refreshInvites();
    } finally {
      setInvitesBusyToken(null);
    }
  }


  async function onSaveSettings() {
    if (!selectedMissionId) return;
    setSavingSettings(true);
    try {
      const updated = await updateMission(selectedMissionId, { traceRetentionSeconds: retentionSeconds });
      setMission(updated);
      setRetentionSeconds(updated.traceRetentionSeconds ?? retentionSeconds);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Accueil</h1>
        <button
          type="button"
          onClick={() => {
            void refreshMissions();
            void refreshInvites();
            void refreshSelectedMission();
          }}
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <RefreshCcw size={16} />
          Actualiser
        </button>
      </div>

      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-900">Invitations</div>
          <div className="text-xs font-semibold text-gray-600">{invites.length}</div>
        </div>
        {invitesLoading ? (
          <div className="mt-2 text-sm text-gray-600">Chargement…</div>
        ) : invites.length === 0 ? (
          <div className="mt-2 text-sm text-gray-600">Aucune invitation.</div>
        ) : (
          <div className="mt-3 grid gap-2">
            {invites.map((i) => (
              <div key={i.id} className="rounded-xl border bg-white p-3">
                <div className="text-sm font-semibold text-gray-900">{i.mission?.title ?? 'Mission'}</div>
                <div className="mt-1 text-xs text-gray-500">Invité par: {i.invitedBy?.displayName ?? '-'}</div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={invitesBusyToken === i.token}
                    onClick={() => void onDeclineInvite(i.token)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold text-gray-800"
                  >
                    <X size={16} />
                    Refuser
                  </button>
                  <button
                    type="button"
                    disabled={invitesBusyToken === i.token}
                    onClick={() => void onAcceptInvite(i.token)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white"
                  >
                    <Check size={16} />
                    Accepter
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Missions</div>
        <div className="mt-3 rounded-2xl border p-3">
          <div className="text-xs font-semibold text-gray-700">Créer une mission</div>
          <div className="mt-2 flex gap-2">
            <input
              value={newMissionTitle}
              onChange={(e) => setNewMissionTitle(e.target.value)}
              placeholder="Nom de mission"
              className="h-11 w-full rounded-xl border px-3 text-sm"
            />
            <button
              type="button"
              disabled={creatingMission || !newMissionTitle.trim()}
              onClick={() => void onCreateMission()}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Créer
            </button>
          </div>
        </div>
        {missionsLoading ? (
          <div className="mt-2 text-sm text-gray-600">Chargement…</div>
        ) : missions.length === 0 ? (
          <div className="mt-2 text-sm text-gray-600">Aucune mission.</div>
        ) : (
          <div className="mt-3 grid gap-2">
            {missions.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onOpenMission(m.id)}
                className={`w-full rounded-2xl border p-4 text-left shadow-sm ${
                  selectedMissionId === m.id ? 'border-blue-300 bg-blue-50' : 'bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900">{m.title}</div>
                    <div className="mt-1 text-xs text-gray-500">statut: {m.status}</div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white">
                    Ouvrir
                    <ArrowRight size={16} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
      ) : selectedMissionId && mission && mission.membership?.role === 'admin' ? (
        <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-gray-900">Réglages</div>
          <div className="mt-3 rounded-2xl border p-3">
            <div className="text-xs font-semibold text-gray-700">Durée de traînée (secondes)</div>
            <input
              type="number"
              value={retentionSeconds}
              onChange={(e) => setRetentionSeconds(Number(e.target.value))}
              className="mt-2 h-11 w-full rounded-xl border px-3 text-sm"
            />
            <button
              type="button"
              disabled={savingSettings}
              onClick={() => void onSaveSettings()}
              className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>

          
        </div>
      ) : null}
    </div>
  );
}

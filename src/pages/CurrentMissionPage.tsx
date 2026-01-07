import { useEffect, useState } from 'react';
import { Pencil, RefreshCcw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createMission, deleteMission, getMission, listMissions, requestMissionJoin, updateMission, type ApiMission } from '../lib/api';
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

  const [joinMissionId, setJoinMissionId] = useState('');
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | null>(null);

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

  useEffect(() => {
    void refreshMissions();
  }, []);

  useEffect(() => {
    void refreshSelectedMission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMissionId]);

  

  function onOpenMission(missionId: string) {
    selectMission(missionId);
    navigate(`/mission/${missionId}`);
  }

  async function onDeleteMission(missionId: string) {
    const ok = window.confirm('Supprimer cette mission ?');
    if (!ok) return;
    try {
      await deleteMission(missionId);
      if (selectedMissionId === missionId) {
        // If we deleted the currently selected mission, clear it.
        selectMission('');
      }
      await refreshMissions();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    }
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

  async function onRequestJoin() {
    if (!joinMissionId.trim()) return;
    setJoinSubmitting(true);
    setJoinMsg(null);
    try {
      await requestMissionJoin(joinMissionId.trim());
      setJoinMissionId('');
      setJoinMsg('Demande envoyée');
    } catch (e: any) {
      setJoinMsg(e?.message ?? 'Erreur');
    } finally {
      setJoinSubmitting(false);
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
            void refreshSelectedMission();
          }}
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <RefreshCcw size={16} />
          Actualiser
        </button>
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Rejoindre une mission</div>
        <div className="mt-1 text-xs text-gray-600">Entre le code (ID) de la mission.</div>
        <div className="mt-3 grid gap-2">
          <input
            value={joinMissionId}
            onChange={(e) => setJoinMissionId(e.target.value)}
            placeholder="ID mission"
            className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={joinSubmitting || !joinMissionId.trim()}
            onClick={() => void onRequestJoin()}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow disabled:opacity-50"
          >
            Envoyer la demande
          </button>
          {joinMsg ? <div className="text-sm text-gray-700">{joinMsg}</div> : null}
        </div>
      </div>

      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

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
                className="w-full rounded-2xl border bg-white p-4 text-left shadow-sm hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900">{m.title}</div>
                    <div className="mt-1 text-xs text-gray-500">statut: {m.status}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenMission(m.id);
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      <Pencil size={16} />
                      Éditer
                    </button>
                    {m.membership?.role === 'admin' ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeleteMission(m.id);
                        }}
                        className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                        Supprimer
                      </button>
                    ) : null}
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

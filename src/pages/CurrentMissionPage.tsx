import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
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
  const [missionTitle, setMissionTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [joinMissionId, setJoinMissionId] = useState('');
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | null>(null);

  const [retentionSeconds, setRetentionSeconds] = useState<number>(3600);
  const [retentionSecondsInput, setRetentionSecondsInput] = useState('3600');
  const [savingSettings, setSavingSettings] = useState(false);

  async function refreshSelectedMission() {
    if (!selectedMissionId) {
      setMission(null);
      setMissionTitle('');
      setLoading(false);
      setShowSettings(false);
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const data = await getMission(selectedMissionId);
      setMission(data);
      setMissionTitle(data.title ?? '');
      const rs = data.traceRetentionSeconds ?? 3600;
      setRetentionSeconds(rs);
      setRetentionSecondsInput(String(rs));
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
      let nextRetention = retentionSeconds;
      const trimmedRetention = retentionSecondsInput.trim();
      if (trimmedRetention) {
        const parsed = Number(trimmedRetention);
        if (!Number.isNaN(parsed)) {
          nextRetention = parsed;
        }
      }

      const payload: { traceRetentionSeconds?: number; title?: string } = {
        traceRetentionSeconds: nextRetention,
      };
      const trimmedTitle = missionTitle.trim();
      if (trimmedTitle && trimmedTitle !== mission?.title) {
        (payload as any).title = trimmedTitle;
      }

      const updated = await updateMission(selectedMissionId, payload);
      setMission(updated);

      // Mettre à jour la liste des missions pour refléter immédiatement
      // le nouveau nom et la nouvelle durée de traînée sans rechargement.
      setMissions((prev) =>
        prev.map((m) =>
          m.id === updated.id
            ? { ...m, title: updated.title, traceRetentionSeconds: updated.traceRetentionSeconds }
            : m
        )
      );

      const rs = updated.traceRetentionSeconds ?? nextRetention;
      setRetentionSeconds(rs);
      setRetentionSecondsInput(String(rs));
      setMissionTitle(updated.title ?? missionTitle);
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

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Créer une mission</div>
        <div className="mt-1 text-xs text-gray-600">Crée une nouvelle mission et deviens son administrateur.</div>
        <div className="mt-3 flex gap-2">
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

      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">
          {missions.length === 1 ? 'Mission en cours' : 'Missions en cours'}
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
                    <div className="text-base font-semibold text-gray-900">
                      {m.title}
                      {m.membership ? (
                        <span className="ml-2 text-xs font-medium text-gray-600">
                          ({
                            m.membership.role === 'admin'
                              ? 'Admin'
                              : m.membership.role === 'viewer'
                              ? 'Visualisateur'
                              : 'Utilisateur'
                          })
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {m.membership?.role === 'admin' ? (
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Sélectionner la mission pour afficher les réglages (nom + durée de traînée)
                          selectMission(m.id);
                          // Initialiser immédiatement l'état local pour afficher la section Réglages sans attendre la requête API
                          setMission(m);
                          setMissionTitle(m.title ?? '');
                          const rs = m.traceRetentionSeconds ?? 3600;
                          setRetentionSeconds(rs);
                          setRetentionSecondsInput(String(rs));
                          setLoading(false);
                          setShowSettings(true);
                          // Faire descendre la vue vers la section Réglages
                          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
                        title="Éditer la mission"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeleteMission(m.id);
                        }}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-red-600 hover:bg-red-50"
                        title="Supprimer la mission"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-4 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
      ) : showSettings && selectedMissionId && mission && mission.membership?.role === 'admin' ? (
        <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-gray-900">Réglages</div>
          <div className="mt-3 rounded-2xl border p-3">
            <div className="text-xs font-semibold text-gray-700">Nom de la mission</div>
            <input
              type="text"
              value={missionTitle}
              onChange={(e) => setMissionTitle(e.target.value)}
              className="mt-2 h-11 w-full rounded-xl border px-3 text-sm"
            />
            <div className="mt-3 text-xs font-semibold text-gray-700">Durée de traînée (secondes)</div>
            <input
              type="text"
              inputMode="numeric"
              value={retentionSecondsInput}
              onChange={(e) => setRetentionSecondsInput(e.target.value)}
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

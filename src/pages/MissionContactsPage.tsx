import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Copy, MessageCircle, RefreshCcw, Send, X } from 'lucide-react';
import {
  acceptMissionJoinRequest,
  declineMissionJoinRequest,
  getMission,
  listMissionJoinRequests,
  listMissionMembers,
  type ApiMission,
  type ApiMissionJoinRequest,
  type ApiMissionMember,
} from '../lib/api';

export default function MissionContactsPage() {
  const { missionId } = useParams();

  const [mission, setMission] = useState<ApiMission | null>(null);
  const [members, setMembers] = useState<ApiMissionMember[]>([]);
  const [joinRequests, setJoinRequests] = useState<ApiMissionJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    if (!missionId) return;
    setLoading(true);
    setError(null);
    try {
      const m = await getMission(missionId);
      setMission(m);

      const mem = await listMissionMembers(missionId);
      setMembers(mem);

      if (m.membership?.role === 'admin') {
        const reqs = await listMissionJoinRequests(missionId);
        setJoinRequests(reqs);
      } else {
        setJoinRequests([]);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  const shareText = useMemo(() => {
    const title = mission?.title?.trim() ? mission.title.trim() : 'Mission';
    const code = missionId ?? '-';
    return `GeoGN — ${title}\n\nCode mission (à copier) :\n${code}\n`;
  }, [mission?.title, missionId]);

  const whatsappUrl = useMemo(() => {
    return `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  }, [shareText]);

  const smsUrl = useMemo(() => {
    return `sms:?&body=${encodeURIComponent(shareText)}`;
  }, [shareText]);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const ar = a.role === 'admin' ? 0 : 1;
      const br = b.role === 'admin' ? 0 : 1;
      if (ar !== br) return ar - br;
      const an = a.user?.displayName ?? '';
      const bn = b.user?.displayName ?? '';
      return an.localeCompare(bn);
    });
  }, [members]);

  async function onAcceptRequest(requestId: string) {
    if (!missionId) return;
    setBusyKey(`accept:${requestId}`);
    setError(null);
    try {
      await acceptMissionJoinRequest(missionId, requestId);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyKey(null);
    }
  }

  async function onDeclineRequest(requestId: string) {
    if (!missionId) return;
    setBusyKey(`decline:${requestId}`);
    setError(null);
    try {
      await declineMissionJoinRequest(missionId, requestId);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Contacts mission</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <RefreshCcw size={16} />
          Actualiser
        </button>
      </div>

      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Code mission</div>
        <div className="mt-1 text-xs text-gray-500">
          Ce code permet de rejoindre directement cette mission.
        </div>
        <div className="mt-2 rounded-xl border bg-gray-50 p-3 text-xs text-gray-800 whitespace-pre-wrap">{shareText}</div>
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            disabled={!missionId}
            onClick={() => {
              window.open(whatsappUrl, '_blank');
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Send size={18} />
            WhatsApp
          </button>
          <button
            type="button"
            disabled={!missionId}
            onClick={() => {
              window.location.href = smsUrl;
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            <MessageCircle size={18} />
            SMS
          </button>
          <button
            type="button"
            disabled={!missionId}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(missionId ?? '');
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              } catch {
                // ignore
              }
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold text-gray-900 disabled:opacity-50"
          >
            <Copy size={18} />
            {copied ? 'Copié' : 'Copier le code'}
          </button>
        </div>
      </div>

      {mission?.membership?.role === 'admin' ? (
        <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-gray-900">Demandes en attente</div>
          {loading ? (
            <div className="mt-2 text-sm text-gray-600">Chargement…</div>
          ) : joinRequests.length === 0 ? (
            <div className="mt-2 text-sm text-gray-600">Aucune demande.</div>
          ) : (
            <div className="mt-3 grid gap-2">
              {joinRequests.map((r) => (
                <div key={r.id} className="rounded-2xl border p-3">
                  <div className="text-sm font-semibold text-gray-900">{r.requestedBy?.displayName ?? 'Utilisateur'}</div>
                  <div className="mt-1 text-xs text-gray-500">{r.requestedBy?.appUserId ?? '-'}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busyKey === `accept:${r.id}`}
                      onClick={() => void onAcceptRequest(r.id)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-green-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Check size={16} />
                      Valider
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `decline:${r.id}`}
                      onClick={() => void onDeclineRequest(r.id)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <X size={16} />
                      Refuser
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-sm font-semibold text-gray-900">Contacts mission</div>

        {loading ? (
          <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
        ) : sortedMembers.length === 0 ? (
          <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucun membre.</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {sortedMembers.map((m) => (
              <div key={m.user?.id ?? Math.random()} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900">{m.user?.displayName ?? 'Membre'}</div>
                    <div className="mt-1 text-xs text-gray-500">{m.user?.appUserId ?? '-'}</div>
                    <div className="mt-1 text-xs text-gray-500">{m.role === 'admin' ? 'Admin' : 'Membre'}</div>
                  </div>
                  <div className="mt-1 h-8 w-8 rounded-full border-2 border-white shadow" style={{ backgroundColor: m.color }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

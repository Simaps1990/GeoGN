import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, RefreshCcw, X } from 'lucide-react';
import {
  acceptInvite,
  addContact,
  declineInvite,
  listContacts,
  listInvites,
  sendMissionInvite,
  type ApiContact,
  type ApiInvite,
} from '../lib/api';

export default function MissionContactsPage() {
  const { missionId } = useParams();

  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [invites, setInvites] = useState<ApiInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [appUserId, setAppUserId] = useState('');
  const [alias, setAlias] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function refresh() {
    if (!missionId) return;
    setLoading(true);
    setError(null);
    try {
      const [c, i] = await Promise.all([listContacts(), listInvites()]);
      setContacts(c);
      setInvites(i);
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

  const missionInvites = useMemo(() => {
    if (!missionId) return [];
    return invites.filter((x) => x.mission?.id === missionId && x.status === 'pending');
  }, [invites, missionId]);

  const sortedContacts = useMemo(() => {
    return [...contacts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [contacts]);

  async function inviteAppUserId(targetAppUserId: string) {
    if (!missionId) return;
    setBusyKey(`invite:${targetAppUserId}`);
    setError(null);
    try {
      await sendMissionInvite(missionId, targetAppUserId);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyKey(null);
    }
  }

  async function addAndInvite() {
    if (!missionId) return;
    if (!appUserId.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      await addContact(appUserId.trim(), alias.trim() ? alias.trim() : undefined);
      await sendMissionInvite(missionId, appUserId.trim());
      setAppUserId('');
      setAlias('');
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  async function onAcceptInvite(token: string) {
    setBusyKey(`accept:${token}`);
    setError(null);
    try {
      await acceptInvite(token);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyKey(null);
    }
  }

  async function onDeclineInvite(token: string) {
    setBusyKey(`decline:${token}`);
    setError(null);
    try {
      await declineInvite(token);
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
        <div className="text-sm font-semibold text-gray-900">Ajouter par code</div>
        <div className="mt-1 text-xs text-gray-600">
          Entre un <span className="font-mono">appUserId</span> : il sera ajouté à tes contacts (niveau Accueil) et invité dans la mission.
        </div>
        <div className="mt-3 grid gap-2">
          <input
            value={appUserId}
            onChange={(e) => setAppUserId(e.target.value)}
            placeholder="appUserId (ex: 7F3K9Q)"
            className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder="Alias (optionnel)"
            className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={submitting || !missionId || !appUserId.trim()}
            onClick={() => void addAndInvite()}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow disabled:opacity-50"
          >
            Ajouter + Inviter
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Invitations en attente (toi)</div>
        {loading ? (
          <div className="mt-2 text-sm text-gray-600">Chargement…</div>
        ) : missionInvites.length === 0 ? (
          <div className="mt-2 text-sm text-gray-600">Aucune invitation en attente.</div>
        ) : (
          <div className="mt-3 grid gap-2">
            {missionInvites.map((inv) => (
              <div key={inv.id} className="rounded-2xl border p-3">
                <div className="text-sm font-semibold text-gray-900">{inv.mission?.title ?? 'Mission'}</div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busyKey === `accept:${inv.token}`}
                    onClick={() => void onAcceptInvite(inv.token)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-green-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    <Check size={16} />
                    Accepter
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === `decline:${inv.token}`}
                    onClick={() => void onDeclineInvite(inv.token)}
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

      <div className="mt-4">
        <div className="text-sm font-semibold text-gray-900">Contacts (global)</div>
        <div className="mt-1 text-xs text-gray-600">Clique "Inviter" pour inviter un contact dans cette mission (admin requis).</div>

        {loading ? (
          <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
        ) : sortedContacts.length === 0 ? (
          <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucun contact.</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {sortedContacts.map((c) => (
              <div key={c.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900">
                      {c.alias?.trim() ? c.alias : c.contact?.displayName ?? 'Contact'}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{c.contact?.appUserId ?? '-'}</div>
                    {c.alias?.trim() ? <div className="mt-1 text-xs text-gray-500">Nom: {c.contact?.displayName ?? '-'}</div> : null}
                  </div>
                  <button
                    type="button"
                    disabled={!missionId || busyKey === `invite:${c.contact?.appUserId ?? ''}` || !c.contact?.appUserId}
                    onClick={() => void inviteAppUserId(c.contact!.appUserId)}
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow disabled:opacity-50"
                  >
                    Inviter
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

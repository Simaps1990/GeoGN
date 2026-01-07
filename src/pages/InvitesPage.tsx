import { useEffect, useState } from 'react';
import { Check, RefreshCcw, X } from 'lucide-react';
import { acceptInvite, declineInvite, listInvites, type ApiInvite } from '../lib/api';

function formatDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

export default function InvitesPage() {
  const [invites, setInvites] = useState<ApiInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const data = await listInvites();
      setInvites(data);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onAccept(token: string) {
    setBusyToken(token);
    setError(null);
    try {
      await acceptInvite(token);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyToken(null);
    }
  }

  async function onDecline(token: string) {
    setBusyToken(token);
    setError(null);
    try {
      await declineInvite(token);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyToken(null);
    }
  }

  return (
    <div className="p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Invitations</h1>
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

      <div className="mt-4">
        {loading ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
        ) : invites.length === 0 ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucune invitation.</div>
        ) : (
          <div className="grid gap-3">
            {invites.map((i) => (
              <div key={i.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900">{i.mission?.title ?? 'Mission'}</div>
                    <div className="mt-1 text-xs text-gray-500">
                      Invité par: {i.invitedBy?.displayName ?? '-'} ({i.invitedBy?.appUserId ?? '-'})
                    </div>
                    <div className="mt-1 text-xs text-gray-500">Expire: {formatDate(i.expiresAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyToken === i.token}
                      onClick={() => void onDecline(i.token)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                    >
                      <X size={16} />
                      Refuser
                    </button>
                    <button
                      type="button"
                      disabled={busyToken === i.token}
                      onClick={() => void onAccept(i.token)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow disabled:opacity-50"
                    >
                      <Check size={16} />
                      Accepter
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

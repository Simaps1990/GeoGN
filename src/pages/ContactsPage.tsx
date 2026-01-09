import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { addContact, deleteContact, listContacts, type ApiContact } from '../lib/api';

export default function ContactsPage() {
  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [appUserId, setAppUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const data = await listContacts();
      setContacts(data);
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function onAdd() {
    if (!appUserId.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addContact(appUserId.trim());
      setAppUserId('');
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await deleteContact(id);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyId(null);
    }
  }

  const sorted = useMemo(() => {
    const base = [...contacts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const q = search.trim().toLowerCase();
    if (!q) return base;

    return base.filter((c) => {
      const name = (c.alias?.trim() || c.contact?.displayName || '').toLowerCase();
      const id = (c.contact?.appUserId || '').toLowerCase();
      return name.includes(q) || id.includes(q);
    });
  }, [contacts, search]);

  return (
    <div className="p-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Mon équipe</h1>
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Ajouter un contact</div>
        <div className="mt-3 grid gap-2">
          <input
            value={appUserId}
            onChange={(e) => setAppUserId(e.target.value)}
            placeholder="N° d'identification du contact (ex: 7F3K9Q)"
            className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={submitting || !appUserId.trim()}
            onClick={() => void onAdd()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow disabled:opacity-50"
          >
            <Plus size={16} />
            Ajouter
          </button>
        </div>
        {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}
      </div>

      <div className="mt-4">
        <div className="mb-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou n° d'identification"
            className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
        </div>
        {loading ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucun contact.</div>
        ) : (
          <div className="grid gap-3">
            {sorted.map((c) => (
              <div key={c.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-gray-900">
                      {c.alias?.trim() ? c.alias : c.contact?.displayName ?? 'Contact'}
                    </div>
                    <div className="mt-1 text-xs text-gray-500">{c.contact?.appUserId ?? '-'}</div>
                    {c.alias?.trim() ? (
                      <div className="mt-1 text-xs text-gray-500">Nom: {c.contact?.displayName ?? '-'}</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    disabled={busyId === c.id}
                    onClick={() => void onDelete(c.id)}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-white px-3 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                    Supprimer
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BookPlus, Check, ChevronDown, Copy, LogOut, MessageCircle, Pencil, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useMission } from '../contexts/MissionContext';
import {
  acceptMissionJoinRequestWithRole,
  addContact,
  addMissionMemberByAppUserId,
  declineMissionJoinRequest,
  getMission,
  listMissionJoinRequests,
  listContacts,
  listMissionMembers,
  removeMissionMember,
  updateMissionMember,
  type ApiMission,
  type ApiContact,
  type ApiMissionJoinRequest,
  type ApiMissionMember,
} from '../lib/api';

export default function MissionContactsPage() {
  const { missionId } = useParams();

  const { user } = useAuth();
  const { clearMission } = useMission();
  const navigate = useNavigate();

  const roleDescriptions = useMemo(
    () => ({
      admin: "Accès complet à la mission + gestion de l'équipe.",
      member: 'Peut créer, modifier et supprimer POI, zones et traces.',
      viewer: 'Peut uniquement voir POI, zones et traces (lecture seule).',
    }),
    []
  );

  const colorPalette = useMemo(
    () => [
      '#ec4899',
      '#ffffff',
      '#1e3a8a',
      '#60a5fa',
      '#000000',
      '#fde047',
      '#f97316',
      '#ef4444',
      '#a855f7',
      '#6b3f35',
      '#4ade80',
      '#a19579',
      '#596643',
    ],
    []
  );

  const [mission, setMission] = useState<ApiMission | null>(null);
  const [members, setMembers] = useState<ApiMissionMember[]>([]);
  const [joinRequests, setJoinRequests] = useState<ApiMissionJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [acceptingRequest, setAcceptingRequest] = useState<ApiMissionJoinRequest | null>(null);
  const [acceptRole, setAcceptRole] = useState<'admin' | 'member' | 'viewer'>('member');

  const [editingMember, setEditingMember] = useState<ApiMissionMember | null>(null);
  const [editRole, setEditRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [editColor, setEditColor] = useState<string>('');

  const [contacts, setContacts] = useState<ApiContact[]>([]);
  const [addContactId, setAddContactId] = useState<string>('');
  const [addRole, setAddRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [addContactOpen, setAddContactOpen] = useState(false);
  const addContactMenuRef = useRef<HTMLDivElement | null>(null);

  const contactsByUserId = useMemo(() => {
    const map = new Map<string, ApiContact>();
    for (const c of contacts) {
      const uid = c.contact?.id;
      if (uid) map.set(uid, c);
    }
    return map;
  }, [contacts]);

  async function refresh() {
    if (!missionId) return;
    setLoading(true);
    setError(null);
    try {
      const m = await getMission(missionId);
      setMission(m);

      const mem = await listMissionMembers(missionId);
      setMembers(mem);

      try {
        const c = await listContacts();
        setContacts(c);
      } catch {
        setContacts([]);
      }

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

  async function onAddContactFromMember(member: ApiMissionMember) {
    const appUserId = member.user?.appUserId;
    const userId = member.user?.id;
    if (!appUserId || !userId) return;

    // Éviter les doublons côté UI si déjà dans les contacts.
    if (contactsByUserId.has(userId)) return;

    setBusyKey(`addContact:${userId}`);
    setError(null);
    try {
      await addContact(appUserId);
      try {
        const c = await listContacts();
        setContacts(c);
      } catch {
        // non bloquant, les contacts seront rechargés plus tard si besoin
      }
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyKey(null);
    }
  }

  const sortedContacts = useMemo(() => {
    return [...contacts].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [contacts]);

  const availableContacts = useMemo(() => {
    const memberUserIds = new Set(members.map((m) => m.user?.id).filter(Boolean) as string[]);
    return sortedContacts.filter((c) => {
      const id = c.contact?.id;
      if (!id) return false;
      return !memberUserIds.has(id);
    });
  }, [members, sortedContacts]);

  const selectedAddContact = useMemo(() => {
    return availableContacts.find((c) => c.id === addContactId) ?? null;
  }, [addContactId, availableContacts]);

  useEffect(() => {
    if (!addContactId) return;
    if (!availableContacts.some((c) => c.id === addContactId)) {
      setAddContactId('');
    }
  }, [addContactId, availableContacts]);

  useEffect(() => {
    if (!addContactOpen) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = addContactMenuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setAddContactOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('touchstart', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('touchstart', onDown);
    };
  }, [addContactOpen]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionId]);

  const shareText = useMemo(() => {
    // Ne partager que le code mission brut, sans texte additionnel
    return missionId ?? '-';
  }, [missionId]);

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

  const usedColorsByOtherMembers = useMemo(() => {
    const currentEditingUserId = editingMember?.user?.id ?? '';
    const used = new Set<string>();
    for (const m of members) {
      if (!m?.user?.id) continue;
      if (currentEditingUserId && m.user.id === currentEditingUserId) continue;
      if (m.color) used.add(m.color);
    }
    return used;
  }, [members, editingMember?.user?.id]);

  async function onAcceptRequest(requestId: string) {
    if (!missionId) return;
    const req = joinRequests.find((r) => r.id === requestId) ?? null;
    if (!req) return;
    setAcceptRole('member');
    setAcceptingRequest(req);
  }

  async function submitAcceptRequest() {
    if (!missionId || !acceptingRequest) return;
    setBusyKey(`accept:${acceptingRequest.id}`);
    setError(null);
    try {
      await acceptMissionJoinRequestWithRole(missionId, acceptingRequest.id, acceptRole);
      setAcceptingRequest(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Erreur');
    } finally {
      setBusyKey(null);
    }
  }

  async function submitMemberEdit() {
    if (!missionId || !editingMember?.user?.id) return;
    setBusyKey(`memberEdit:${editingMember.user.id}`);
    setError(null);
    try {
      await updateMissionMember(missionId, editingMember.user.id, { role: editRole, color: editColor });
      setMembers((prev) =>
        prev.map((m) => (m.user?.id === editingMember.user?.id ? { ...m, role: editRole, color: editColor } : m))
      );
      setEditingMember(null);
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
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">Gestion de mon équipe</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
          title="Rafraîchir l'équipe"
        >
          <RefreshCw size={14} />
          Actualiser
        </button>
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

      {mission?.membership?.role === 'admin' ? (
        <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-gray-900">Ajouter un membre</div>
          <div className="mt-1 text-xs text-gray-500">
            Sélectionne un contact depuis ton répertoire "Mon équipe".
          </div>

          <div className="mt-3 grid gap-2">
            <div ref={addContactMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setAddContactOpen((v) => !v)}
                className="inline-flex h-11 w-full items-center justify-between rounded-xl border bg-white px-3 text-sm text-gray-900 shadow-sm hover:bg-gray-50"
              >
                <span className="truncate">
                  {selectedAddContact?.contact?.appUserId
                    ? `${selectedAddContact?.alias?.trim() || selectedAddContact?.contact?.displayName || 'Contact'} (${selectedAddContact.contact.appUserId})`
                    : 'Choisir un contact…'}
                </span>
                <ChevronDown size={18} className="ml-2 shrink-0 text-gray-500" />
              </button>

              {addContactOpen ? (
                <div className="absolute left-0 right-0 z-[2100] mt-2 max-h-64 overflow-auto rounded-2xl border bg-white shadow-xl">
                  {availableContacts.length === 0 ? (
                    <div className="p-3 text-sm text-gray-600">Aucun contact.</div>
                  ) : (
                    <div className="p-2">
                      {availableContacts.map((c) => {
                        const name = c.alias?.trim() || c.contact?.displayName || 'Contact';
                        const id = c.contact?.appUserId || '-';
                        const active = c.id === addContactId;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setAddContactId(c.id);
                              setAddContactOpen(false);
                            }}
                            className={`w-full rounded-xl px-3 py-2 text-left hover:bg-gray-50 ${active ? 'bg-blue-50 border border-blue-500' : ''}`}
                          >
                            <div className="text-sm font-semibold text-gray-900">{name}</div>
                            <div className="mt-0.5 text-xs text-gray-500">{id}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setAddRole('viewer')}
                className={`h-11 rounded-xl border px-3 text-sm font-semibold ${
                  addRole === 'viewer' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                <span className="block w-full truncate text-center">Visualisateur</span>
              </button>
              <button
                type="button"
                onClick={() => setAddRole('member')}
                className={`h-11 rounded-xl border px-3 text-sm font-semibold ${
                  addRole === 'member' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                <span className="block w-full truncate text-center">Utilisateur</span>
              </button>
              <button
                type="button"
                onClick={() => setAddRole('admin')}
                className={`h-11 rounded-xl border px-3 text-sm font-semibold ${
                  addRole === 'admin' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'bg-white text-gray-800 hover:bg-gray-50'
                }`}
              >
                <span className="block w-full truncate text-center">Admin</span>
              </button>
            </div>

            <button
              type="button"
              disabled={busyKey === 'addMember' || !selectedAddContact?.contact?.appUserId}
              onClick={async () => {
                if (!missionId) return;
                const appUserId = selectedAddContact?.contact?.appUserId;
                if (!appUserId) return;
                setBusyKey('addMember');
                setError(null);
                try {
                  await addMissionMemberByAppUserId(missionId, appUserId, addRole);
                  setAddContactId('');
                  setAddRole('member');
                  await refresh();
                } catch (e: any) {
                  setError(e?.message ?? 'Erreur');
                } finally {
                  setBusyKey(null);
                }
              }}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              Ajouter à la mission
            </button>
          </div>
        </div>
      ) : null}

      {error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

      <div className="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-gray-900">Code mission</div>
        <div className="mt-1 text-xs text-gray-500">
          Ce code permet de rejoindre directement cette mission.
        </div>
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

      <div className="mt-4">
        <div className="text-sm font-semibold text-gray-900">Membres actifs</div>

        {loading ? (
          <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Chargement…</div>
        ) : sortedMembers.length === 0 ? (
          <div className="mt-3 rounded-2xl border bg-white p-4 text-sm text-gray-600 shadow-sm">Aucun membre.</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {sortedMembers.map((m, index) => {
              const userId = m.user?.id ?? '';
              const memberAppUserId = m.user?.appUserId ?? '';
              const adminsCount = sortedMembers.filter((x) => x.role === 'admin').length;
              const isSelf = Boolean(
                user &&
                  ((userId && user.id === userId) ||
                    (memberAppUserId && user.appUserId && user.appUserId === memberAppUserId))
              );
              const isSingleMember = sortedMembers.length === 1 && index === 0;
              const hideBook = isSelf || isSingleMember;
              const canLeaveMission = isSelf && !isSingleMember && !(m.role === 'admin' && adminsCount === 1);
              const isInContacts = userId ? contactsByUserId.has(userId) : false;
              const addBusy = busyKey === (userId ? `addContact:${userId}` : '');

              return (
                <div
                  key={userId || Math.random()}
                  className="rounded-2xl border-4 bg-white p-4 shadow-sm"
                  style={{ borderColor: m.color || undefined }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-gray-900">{m.user?.displayName ?? 'Membre'}</div>
                      <div className="mt-1 text-xs text-gray-500">{m.user?.appUserId ?? '-'}</div>
                      <div className="mt-1 text-xs text-gray-500">
                        {m.role === 'admin' ? 'Admin' : m.role === 'viewer' ? 'Visualisateur' : 'Utilisateur'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!hideBook && !isInContacts ? (
                        <button
                          type="button"
                          disabled={addBusy || !m.user?.appUserId || !userId}
                          onClick={() => {
                            if (!addBusy && m.user?.appUserId && userId) {
                              void onAddContactFromMember(m);
                            }
                          }}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border bg-white text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                          title={"Ajouter à mes contacts 'Mon équipe'"}
                        >
                          <BookPlus size={16} />
                        </button>
                      ) : null}

                      {mission?.membership?.role === 'admin' && m.user?.id ? (
                        <>
                          <button
                            type="button"
                            disabled={busyKey === `memberEdit:${m.user.id}`}
                            onClick={() => {
                              setEditingMember(m);
                              setEditRole(m.role);
                              setEditColor(m.color);
                            }}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border bg-white text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                            title="Modifier"
                          >
                            <Pencil size={16} />
                          </button>
                          {!isSelf ? (
                            <button
                              type="button"
                              disabled={busyKey === `memberRemove:${m.user.id}`}
                              onClick={async () => {
                                if (!missionId || !m.user?.id) return;
                                const ok = window.confirm(`Retirer ${m.user.displayName ?? 'ce membre'} de la mission ?`);
                                if (!ok) return;
                                setBusyKey(`memberRemove:${m.user.id}`);
                                setError(null);
                                try {
                                  await removeMissionMember(missionId, m.user.id);
                                  setMembers((prev) => prev.filter((x) => x.user?.id !== m.user?.id));
                                  await refresh();
                                } catch (e: any) {
                                  setError(e?.message ?? 'Erreur');
                                } finally {
                                  setBusyKey(null);
                                }
                              }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border bg-white text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-50"
                              title="Retirer"
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : null}
                        </>
                      ) : null}

                      {canLeaveMission ? (
                        <button
                          type="button"
                          disabled={busyKey === 'leaveMission'}
                          onClick={async () => {
                            if (!missionId || !userId) return;
                            const ok = window.confirm('Quitter cette mission ?');
                            if (!ok) return;
                            setBusyKey('leaveMission');
                            setError(null);
                            try {
                              await removeMissionMember(missionId, userId);
                              clearMission();
                              navigate('/home', { replace: true });
                            } catch (e: any) {
                              setError(e?.message ?? 'Erreur');
                            } finally {
                              setBusyKey(null);
                            }
                          }}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border bg-white text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                          title="Quitter la mission"
                        >
                          <LogOut size={16} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {acceptingRequest ? (
        <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="text-base font-semibold text-gray-900">Choisir un rôle</div>
            <div className="mt-1 text-sm text-gray-600">
              Pour {acceptingRequest.requestedBy?.displayName ?? 'cet utilisateur'}
            </div>

            <div className="mt-3 grid gap-2">
              {(['admin', 'member', 'viewer'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setAcceptRole(r)}
                  className={`rounded-2xl border p-3 text-left ${acceptRole === r ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <div className="text-sm font-semibold text-gray-900">
                    {r === 'admin' ? 'Admin' : r === 'viewer' ? 'Visualisateur' : 'Utilisateur'}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">{(roleDescriptions as any)[r]}</div>
                </button>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setAcceptingRequest(null)}
                className="h-11 flex-1 rounded-xl border bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busyKey === `accept:${acceptingRequest.id}`}
                onClick={() => void submitAcceptRequest()}
                className="h-11 flex-1 rounded-xl bg-green-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingMember && mission?.membership?.role === 'admin' ? (
        <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="text-base font-semibold text-gray-900">Modifier le membre</div>
            <div className="mt-1 text-sm text-gray-600">{editingMember.user?.displayName ?? 'Membre'}</div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-700">Rôle</div>
              <div className="mt-2 grid gap-2">
                {(['admin', 'member', 'viewer'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setEditRole(r)}
                    className={`rounded-2xl border p-3 text-left ${editRole === r ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <div className="text-sm font-semibold text-gray-900">
                      {r === 'admin' ? 'Admin' : r === 'viewer' ? 'Visualisateur' : 'Utilisateur'}
                    </div>
                    <div className="mt-1 text-xs text-gray-600">{(roleDescriptions as any)[r]}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-700">Couleur</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {colorPalette.map((c) => {
                  const usedByOther = usedColorsByOtherMembers.has(c);
                  const selected = editColor === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditColor(c)}
                      className={`relative h-10 w-10 rounded-xl border ${selected ? 'ring-2 ring-blue-500' : ''}`}
                      style={{
                        backgroundColor: c,
                        backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.06))',
                        borderColor: c.toLowerCase() === '#ffffff' ? '#9ca3af' : 'rgba(0,0,0,0.12)',
                      }}
                      aria-label={c}
                    >
                      {usedByOther ? (
                        <span
                          className="pointer-events-none absolute inset-0"
                          style={{
                            background:
                              'linear-gradient(135deg, rgba(0,0,0,0) 47%, rgba(0,0,0,0.55) 49%, rgba(0,0,0,0.55) 51%, rgba(0,0,0,0) 53%)',
                          }}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="h-11 flex-1 rounded-xl border bg-white px-4 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busyKey === `memberEdit:${editingMember.user?.id ?? ''}` || !editColor}
                onClick={() => void submitMemberEdit()}
                className="h-11 flex-1 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

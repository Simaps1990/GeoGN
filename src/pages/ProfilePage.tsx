import { useMemo, useState } from 'react';
import { Copy, MessageCircle, Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { changeMyPassword, updateMyProfile } from '../lib/api';

export default function ProfilePage() {
  const { user, signOut, refreshUser } = useAuth();

  const [copied, setCopied] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  const shareText = useMemo(() => {
    // Ne partager que le code brut, sans texte additionnel
    return user?.appUserId ?? '-';
  }, [user?.appUserId]);

  const whatsappUrl = useMemo(() => {
    return `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  }, [shareText]);

  const smsUrl = useMemo(() => {
    return `sms:?&body=${encodeURIComponent(shareText)}`;
  }, [shareText]);

  return (
    <div className="p-4 pb-20">
      <h1 className="text-xl font-bold text-gray-900">Profil</h1>
      <div className="mt-4 rounded-lg border bg-white p-4">
        <div className="text-sm text-gray-500">Nom</div>
        <div className="font-semibold text-gray-900">{user?.displayName ?? '-'}</div>
        <div className="mt-3 text-sm text-gray-500">Email</div>
        <div className="font-semibold text-gray-900">{user?.email ?? '-'}</div>
        <div className="mt-3 text-sm text-gray-500">Mon identifiant (appUserId)</div>
        <div className="font-mono text-gray-900 break-all">{user?.appUserId ?? '-'}</div>
      </div>

      <div className="mt-4 rounded-lg border bg-white p-4">
        <div className="text-sm font-semibold text-gray-900">Modifier mon pseudo</div>
        <div className="mt-3 grid gap-2">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={user?.displayName ?? 'Pseudo'}
            className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={savingName || !displayName.trim()}
            onClick={async () => {
              setSavingName(true);
              setNameMsg(null);
              try {
                await updateMyProfile(displayName.trim());
                await refreshUser();
                setDisplayName('');
                setNameMsg('Pseudo mis à jour');
              } catch (e: any) {
                setNameMsg(e?.message ?? 'Erreur');
              } finally {
                setSavingName(false);
              }
            }}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            Enregistrer
          </button>
          {nameMsg ? <div className="text-sm text-gray-700">{nameMsg}</div> : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border bg-white p-4">
        <div className="text-sm font-semibold text-gray-900">Changer mon mot de passe</div>
        <div className="mt-3 grid gap-2">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Mot de passe actuel"
            className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Nouveau mot de passe"
            className="h-11 w-full rounded-xl border px-3 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={changingPassword || !currentPassword || !newPassword}
            onClick={async () => {
              setChangingPassword(true);
              setPwdMsg(null);
              try {
                await changeMyPassword(currentPassword, newPassword);
                setCurrentPassword('');
                setNewPassword('');
                setPwdMsg('Mot de passe mis à jour');
              } catch (e: any) {
                setPwdMsg(e?.message ?? 'Erreur');
              } finally {
                setChangingPassword(false);
              }
            }}
            className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            Changer le mot de passe
          </button>
          {pwdMsg ? <div className="text-sm text-gray-700">{pwdMsg}</div> : null}
        </div>
      </div>

      <div className="mt-4 rounded-lg border bg-white p-4">
        <div className="text-sm font-semibold text-gray-900">Partager mon code</div>
        <div className="mt-1 text-xs text-gray-500">
          Ce code est ton identifiant GeoGN personnel. Partage-le pour que d'autres puissent t'ajouter.
        </div>
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            disabled={!user?.appUserId}
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
            disabled={!user?.appUserId}
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
            disabled={!user?.appUserId}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareText);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              } catch {
                // ignore
              }
            }}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold text-gray-900 disabled:opacity-50"
          >
            <Copy size={18} />
            {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
      </div>

      <div className="mt-4 mb-8 rounded-lg border bg-white p-4">
        <div className="text-sm font-semibold text-gray-900">Paramètres</div>
        <button
          type="button"
          onClick={signOut}
          className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white"
        >
          Déconnexion
        </button>
      </div>
    </div>
  );
}

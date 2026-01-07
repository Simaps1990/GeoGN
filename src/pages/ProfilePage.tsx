import { useAuth } from '../contexts/AuthContext';

export default function ProfilePage() {
  const { user, signOut } = useAuth();

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

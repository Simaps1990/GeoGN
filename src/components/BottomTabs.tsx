import { NavLink } from 'react-router-dom';
import { BookUser, Home, Map, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listInvites } from '../lib/api';

type Tab = {
  to: string;
  label: string;
  Icon: typeof Map;
};

export default function BottomTabs() {
  const [invitesCount, setInvitesCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const invites = await listInvites();
        if (!cancelled) setInvitesCount(invites.length);
      } catch {
        if (!cancelled) setInvitesCount(0);
      }
    })();
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const invites = await listInvites();
          if (!cancelled) setInvitesCount(invites.length);
        } catch {
          // ignore
        }
      })();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const tabs: Tab[] = [
    { to: '/home', label: 'Accueil', Icon: Home },
    { to: '/contacts', label: 'Contacts', Icon: BookUser },
    { to: '/profile', label: 'Profil', Icon: User },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[1100]">
      <div className="mx-auto max-w-md px-3 pb-[max(env(safe-area-inset-bottom),10px)]">
        <div className="h-20 rounded-2xl border border-white/20 bg-white/80 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <div className="grid h-full grid-cols-3 items-center px-1">
            {tabs.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }: { isActive: boolean }) =>
                  `relative mx-1 flex h-16 flex-col items-center justify-center gap-1 rounded-2xl px-2 transition-colors ${
                    isActive
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`
                }
              >
                <Icon size={20} />
                <span className="text-[11px] font-medium leading-none">{label}</span>
                {to === '/home' && invitesCount > 0 ? (
                  <span className="absolute right-2 top-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
                    {invitesCount}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

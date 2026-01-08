import { NavLink } from 'react-router-dom';
import { BookUser, Home, Map, User } from 'lucide-react';

type Tab = {
  to: string;
  label: string;
  Icon: typeof Map;
};

export default function BottomTabs() {
  const tabs: Tab[] = [
    { to: '/home', label: 'Accueil', Icon: Home },
    { to: '/contacts', label: 'Contacts', Icon: BookUser },
    { to: '/profile', label: 'Profil', Icon: User },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[1100]">
      <div className="mx-auto w-full max-w-md sm:max-w-lg md:max-w-2xl lg:max-w-4xl px-3 pb-[max(env(safe-area-inset-bottom),10px)]">
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
                <Icon size={24} />
                <span className="text-[11px] font-medium leading-none">{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

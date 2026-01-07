import { NavLink, useParams } from 'react-router-dom';
import { BookUser, Map, MapPin, CircleDotDashed } from 'lucide-react';

type Tab = {
  to: string;
  label: string;
  Icon: typeof Map;
};

export default function MissionTabs() {
  const { missionId } = useParams();
  const base = missionId ? `/mission/${missionId}` : '/home';

  const tabs: Tab[] = [
    { to: `${base}/map`, label: 'Carte', Icon: Map },
    { to: `${base}/zones`, label: 'Zones', Icon: CircleDotDashed },
    { to: `${base}/pois`, label: 'POI', Icon: MapPin },
    { to: `${base}/contacts`, label: 'Contacts', Icon: BookUser },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[1100]">
      <div className="mx-auto max-w-md px-3 pb-[max(env(safe-area-inset-bottom),10px)]">
        <div className="h-20 rounded-2xl border border-white/20 bg-white/80 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <div className="grid h-full grid-cols-4 items-center px-1">
            {tabs.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }: { isActive: boolean }) =>
                  `relative mx-1 flex h-16 flex-col items-center justify-center gap-1 rounded-2xl px-2 transition-colors ${
                    isActive ? 'bg-blue-600 text-white shadow' : 'text-gray-700 hover:bg-gray-100'
                  }`
                }
              >
                <Icon size={20} />
                <span className="text-[11px] font-medium leading-none">{label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

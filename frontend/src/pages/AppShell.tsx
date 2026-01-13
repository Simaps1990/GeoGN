import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import BottomTabs from '../components/BottomTabs';

export default function AppShell() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]">
      <div className="w-full" key={location.pathname}>
        <Outlet />
      </div>
      <BottomTabs />
    </div>
  );
}

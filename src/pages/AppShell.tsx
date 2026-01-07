import { Outlet } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';

export default function AppShell() {
  return (
    <div className="min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]">
      <div className="mx-auto max-w-md">
        <Outlet />
      </div>
      <BottomTabs />
    </div>
  );
}

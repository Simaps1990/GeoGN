import { Outlet } from 'react-router-dom';
import BottomTabs from '../components/BottomTabs';

export default function AppShell() {
  return (
    <div className="min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]">
      <div className="mx-auto w-full max-w-md sm:max-w-lg md:max-w-2xl lg:max-w-4xl">
        <Outlet />
      </div>
      <BottomTabs />
    </div>
  );
}

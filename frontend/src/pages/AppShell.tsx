import { useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { lazy, Suspense } from 'react';
import BottomTabs from '../components/BottomTabs';

const CurrentMissionPage = lazy(() => import('./CurrentMissionPage'));
const MissionsPage = lazy(() => import('./MissionsPage'));
const ContactsPage = lazy(() => import('./ContactsPage'));
const ProfilePage = lazy(() => import('./ProfilePage'));

const PAGES = ['home', 'missions', 'contacts', 'profile'] as const;
type PageKey = (typeof PAGES)[number];

function getActiveKey(pathname: string): PageKey {
  if (pathname.startsWith('/contacts')) return 'contacts';
  if (pathname.startsWith('/profile')) return 'profile';
  if (pathname.startsWith('/missions')) return 'missions';
  return 'home';
}

export default function AppShell() {
  const location = useLocation();
  const activeKey = getActiveKey(location.pathname);

  const visitedRef = useRef<Set<PageKey>>(new Set());
  visitedRef.current.add(activeKey);

  // Clé d'animation : change à chaque activation de page pour déclencher l'entrée CSS
  const enterKeyRef = useRef<Record<PageKey, number>>({ home: 0, missions: 0, contacts: 0, profile: 0 });
  const prevKeyRef = useRef<PageKey>(activeKey);
  if (prevKeyRef.current !== activeKey) {
    enterKeyRef.current[activeKey] = (enterKeyRef.current[activeKey] ?? 0) + 1;
    prevKeyRef.current = activeKey;
  }

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]">
      <div className="w-full">
        {visitedRef.current.has('home') && (
          <div className={activeKey === 'home' ? '' : 'hidden'}>
            <div key={`home-${enterKeyRef.current.home}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <CurrentMissionPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('missions') && (
          <div className={activeKey === 'missions' ? '' : 'hidden'}>
            <div key={`missions-${enterKeyRef.current.missions}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <MissionsPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('contacts') && (
          <div className={activeKey === 'contacts' ? '' : 'hidden'}>
            <div key={`contacts-${enterKeyRef.current.contacts}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <ContactsPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('profile') && (
          <div className={activeKey === 'profile' ? '' : 'hidden'}>
            <div key={`profile-${enterKeyRef.current.profile}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <ProfilePage />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      <BottomTabs />
    </div>
  );
}

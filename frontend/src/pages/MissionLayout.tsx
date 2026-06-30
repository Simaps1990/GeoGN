import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { useMission } from '../contexts/MissionContext';
import { useAuth } from '../contexts/AuthContext';
import MissionTabs from '../components/MissionTabs';
import { useMissionGeolocation } from '../hooks/useMissionGeolocation';
import { getSocket } from '../lib/socket';

const MissionMapPage = lazy(() => import('./MissionMapPage'));
const MissionZonesPage = lazy(() => import('./MissionZonesPage'));
const MissionPoisPage = lazy(() => import('./MissionPoisPage'));
const MissionContactsPage = lazy(() => import('./MissionContactsPage'));

const MISSION_PAGES = ['map', 'zones', 'pois', 'contacts'] as const;
type MissionPageKey = (typeof MISSION_PAGES)[number];

function getActiveMissionKey(pathname: string): MissionPageKey {
  if (pathname.endsWith('/zones')) return 'zones';
  if (pathname.endsWith('/pois')) return 'pois';
  if (pathname.endsWith('/contacts')) return 'contacts';
  return 'map';
}

export default function MissionLayout() {
  const { missionId } = useParams();
  const { selectedMissionId, selectMission } = useMission();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const activeKey = getActiveMissionKey(location.pathname);
  const isMapRoute = activeKey === 'map';

  const visitedRef = useRef<Set<MissionPageKey>>(new Set());
  visitedRef.current.add(activeKey);

  const enterKeyRef = useRef<Record<MissionPageKey, number>>({ map: 0, zones: 0, pois: 0, contacts: 0 });
  const prevKeyRef = useRef<MissionPageKey>(activeKey);
  if (prevKeyRef.current !== activeKey) {
    enterKeyRef.current[activeKey] = (enterKeyRef.current[activeKey] ?? 0) + 1;
    prevKeyRef.current = activeKey;
  }

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    if (!missionId) return;
    if (selectedMissionId !== missionId) {
      selectMission(missionId);
    }
  }, [missionId, selectedMissionId, selectMission]);

  // Signal MapLibre de recalculer sa taille quand la route map redevient active
  useEffect(() => {
    if (isMapRoute) {
      window.dispatchEvent(new CustomEvent('geogn:map:visible'));
    }
  }, [isMapRoute]);

  useEffect(() => {
    if (!missionId) return;
    const socket = getSocket();
    const onMissionDeleted = (msg: any) => {
      if (!msg || msg.missionId !== missionId) return;
      if (selectedMissionId === missionId) selectMission('');
      navigate('/');
    };
    socket.on('mission:deleted', onMissionDeleted);
    return () => { socket.off('mission:deleted', onMissionDeleted); };
  }, [missionId, selectedMissionId, selectMission, navigate]);

  useMissionGeolocation({
    missionId: missionId ?? null,
    userId: user?.id ?? null,
    enabled: !isMapRoute,
  });

  return (
    <div className={isMapRoute ? 'min-h-screen bg-gray-50' : 'min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]'}>
      <div className="w-full">
        {visitedRef.current.has('map') && (
          <div className={activeKey === 'map' ? '' : 'hidden'}>
            <Suspense fallback={null}>
              <MissionMapPage />
            </Suspense>
          </div>
        )}
        {visitedRef.current.has('zones') && (
          <div className={activeKey === 'zones' ? '' : 'hidden'}>
            <div key={`zones-${enterKeyRef.current.zones}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <MissionZonesPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('pois') && (
          <div className={activeKey === 'pois' ? '' : 'hidden'}>
            <div key={`pois-${enterKeyRef.current.pois}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <MissionPoisPage />
              </Suspense>
            </div>
          </div>
        )}
        {visitedRef.current.has('contacts') && (
          <div className={activeKey === 'contacts' ? '' : 'hidden'}>
            <div key={`contacts-${enterKeyRef.current.contacts}`} className="animate-page-enter">
              <Suspense fallback={null}>
                <MissionContactsPage />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      <MissionTabs />
    </div>
  );
}

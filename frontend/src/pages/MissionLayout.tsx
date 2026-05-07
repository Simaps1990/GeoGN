import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useMission } from '../contexts/MissionContext';
import { useAuth } from '../contexts/AuthContext';
import MissionTabs from '../components/MissionTabs';
import { useMissionGeolocation } from '../hooks/useMissionGeolocation';
import { getSocket } from '../lib/socket';

export default function MissionLayout() {
  const { missionId } = useParams();
  const { selectedMissionId, selectMission } = useMission();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isMapRoute = !!missionId && location.pathname.endsWith(`/mission/${missionId}/map`);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    if (!missionId) return;
    if (selectedMissionId !== missionId) {
      selectMission(missionId);
    }
  }, [missionId, selectedMissionId, selectMission]);

  // Nouveau useEffect pour écouter mission:deleted
  useEffect(() => {
    if (!missionId) return;
    const socket = getSocket();

    const onMissionDeleted = (msg: any) => {
      if (!msg || msg.missionId !== missionId) return;
      // La mission active vient d'être supprimée par un autre admin.
      // On désélectionne et on redirige vers la liste des missions.
      if (selectedMissionId === missionId) {
        selectMission('');
      }
      navigate('/');
    };

    socket.on('mission:deleted', onMissionDeleted);
    return () => {
      socket.off('mission:deleted', onMissionDeleted);
    };
  }, [missionId, selectedMissionId, selectMission, navigate]);

  // Géolocalisation centralisée. On désactive ce watcher quand on est sur la
  // route map, parce que MapLibreMap a son propre watcher avec une logique
  // de tracePoints locale qui sera unifiée plus tard (refactor MapLibreMap).
  useMissionGeolocation({
    missionId: missionId ?? null,
    userId: user?.id ?? null,
    enabled: !isMapRoute,
  });

  return (
    <div className={isMapRoute ? 'min-h-screen bg-gray-50' : 'min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]'}>
      <div className="w-full">
        <Outlet />
      </div>
      <MissionTabs />
    </div>
  );
}

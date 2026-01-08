import { Outlet, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useMission } from '../contexts/MissionContext';
import MissionTabs from '../components/MissionTabs';

export default function MissionLayout() {
  const { missionId } = useParams();
  const { selectedMissionId, selectMission } = useMission();

  useEffect(() => {
    if (!missionId) return;
    if (selectedMissionId !== missionId) {
      selectMission(missionId);
    }
  }, [missionId, selectedMissionId, selectMission]);

  return (
    <div className="min-h-screen bg-gray-50 pb-[max(env(safe-area-inset-bottom),10px)]">
      <div className="mx-auto w-full max-w-md sm:max-w-lg md:max-w-2xl lg:max-w-4xl">
        <Outlet />
      </div>
      <MissionTabs />
    </div>
  );
}

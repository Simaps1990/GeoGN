import { createContext, useContext, useEffect, useMemo, useState } from 'react';

type MissionContextValue = {
  selectedMissionId: string | null;
  selectMission: (missionId: string) => void;
  clearMission: () => void;
};

const SELECTED_MISSION_KEY = 'geotacops.selectedMissionId';

const MissionContext = createContext<MissionContextValue | undefined>(undefined);

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);

  useEffect(() => {
    const v = localStorage.getItem(SELECTED_MISSION_KEY);
    setSelectedMissionId(v ? v : null);
  }, []);

  useEffect(() => {
    const onClear = () => {
      const v = localStorage.getItem(SELECTED_MISSION_KEY);
      setSelectedMissionId(v ? v : null);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SELECTED_MISSION_KEY) return;
      const v = localStorage.getItem(SELECTED_MISSION_KEY);
      setSelectedMissionId(v ? v : null);
    };
    window.addEventListener('geotacops:mission:clear', onClear as any);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('geotacops:mission:clear', onClear as any);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  function selectMission(missionId: string) {
    localStorage.setItem(SELECTED_MISSION_KEY, missionId);
    setSelectedMissionId(missionId);
  }

  function clearMission() {
    localStorage.removeItem(SELECTED_MISSION_KEY);
    setSelectedMissionId(null);
  }

  const value = useMemo(
    () => ({
      selectedMissionId,
      selectMission,
      clearMission,
    }),
    [selectedMissionId]
  );

  return <MissionContext.Provider value={value}>{children}</MissionContext.Provider>;
}

export function useMission() {
  const ctx = useContext(MissionContext);
  if (!ctx) throw new Error('useMission must be used within MissionProvider');
  return ctx;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getBaptism,
  putBaptism,
  patchBaptism,
  deleteBaptism,
  type ApiBaptism,
} from '../lib/api';
import { computeBaptismAxes, type BaptismIcon } from '../lib/baptismAxes';
import { getSocket } from '../lib/socket';

export type BaptismDraftState = { icon: BaptismIcon; point: { lng: number; lat: number } | null };

export type UseBaptismResult = {
  baptism: ApiBaptism | null;
  draft: BaptismDraftState | null;
  computing: boolean;
  computeError: string | null;
  startPlacing: (icon: BaptismIcon) => void;
  placeAt: (lng: number, lat: number) => void;
  cancelDraft: () => void;
  confirmDraft: () => Promise<boolean>;
  renameAxis: (axisId: string, name: string | null) => Promise<void>;
  recolorAxis: (axisId: string, color: string) => Promise<void>;
  removeAxis: (axisId: string) => Promise<void>;
  setDisplayMode: (mode: 'colors' | 'tion' | 'both') => Promise<void>;
  removeBaptism: () => Promise<void>;
};

export function useBaptism({ selectedMissionId }: { selectedMissionId: string | null }): UseBaptismResult {
  const [baptism, setBaptism] = useState<ApiBaptism | null>(null);
  const [draft, setDraft] = useState<BaptismDraftState | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const missionRef = useRef(selectedMissionId);
  missionRef.current = selectedMissionId;

  useEffect(() => {
    setBaptism(null);
    setDraft(null);
    setComputeError(null);
    if (!selectedMissionId) return;
    let cancelled = false;
    getBaptism(selectedMissionId)
      .then((b) => {
        if (!cancelled) setBaptism(b);
      })
      .catch(() => {
        /* non bloquant : la carte reste utilisable sans baptême */
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMissionId]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onUpdated = (payload: { missionId: string; baptism: ApiBaptism }) => {
      if (payload?.missionId === missionRef.current) setBaptism(payload.baptism);
    };
    const onDeleted = (payload: { missionId: string }) => {
      if (payload?.missionId === missionRef.current) setBaptism(null);
    };
    socket.on('baptism:updated', onUpdated);
    socket.on('baptism:deleted', onDeleted);
    return () => {
      socket.off('baptism:updated', onUpdated);
      socket.off('baptism:deleted', onDeleted);
    };
  }, []);

  const startPlacing = useCallback((icon: BaptismIcon) => {
    setDraft({ icon, point: null });
    setComputeError(null);
  }, []);

  const placeAt = useCallback((lng: number, lat: number) => {
    setDraft((d) => (d ? { ...d, point: { lng, lat } } : d));
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setComputeError(null);
  }, []);

  const confirmDraft = useCallback(async (): Promise<boolean> => {
    const missionId = missionRef.current;
    const d = draft;
    if (!missionId || !d?.point) return false;
    setComputing(true);
    setComputeError(null);
    try {
      const { axes } = await computeBaptismAxes(d.point, d.icon);
      const saved = await putBaptism(missionId, {
        icon: d.icon,
        point: d.point,
        displayMode: baptism?.displayMode ?? 'colors',
        axes,
      });
      setBaptism(saved);
      setDraft(null);
      return true;
    } catch (e: any) {
      setComputeError(e?.message === 'NO_ROAD_NEARBY' ? 'NO_ROAD_NEARBY' : 'OVERPASS_UNAVAILABLE');
      return false;
    } finally {
      setComputing(false);
    }
  }, [draft, baptism?.displayMode]);

  const patch = useCallback(async (input: Parameters<typeof patchBaptism>[1]) => {
    const missionId = missionRef.current;
    if (!missionId) return;
    const updated = await patchBaptism(missionId, input);
    setBaptism(updated);
  }, []);

  const renameAxis = useCallback((axisId: string, name: string | null) => patch({ axisId, name }), [patch]);
  const recolorAxis = useCallback((axisId: string, color: string) => patch({ axisId, color }), [patch]);
  const removeAxis = useCallback((axisId: string) => patch({ axisId, remove: true }), [patch]);
  const setDisplayMode = useCallback((mode: 'colors' | 'tion' | 'both') => patch({ displayMode: mode }), [patch]);

  const removeBaptism = useCallback(async () => {
    const missionId = missionRef.current;
    if (!missionId) return;
    await deleteBaptism(missionId);
    setBaptism(null);
  }, []);

  return {
    baptism,
    draft,
    computing,
    computeError,
    startPlacing,
    placeAt,
    cancelDraft,
    confirmDraft,
    renameAxis,
    recolorAxis,
    removeAxis,
    setDisplayMode,
    removeBaptism,
  };
}

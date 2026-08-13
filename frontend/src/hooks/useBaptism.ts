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

export type BaptismDraftState = {
  point: { lng: number; lat: number } | null;
  icon: BaptismIcon | null;
  pointName: string | null;
  displayMode: 'colors' | 'tion' | 'both' | null;
};

export type UseBaptismResult = {
  baptism: ApiBaptism | null;
  draft: BaptismDraftState | null;
  computing: boolean;
  computeError: string | null;
  mutationError: string | null;
  startPlacing: () => void;
  placeAt: (lng: number, lat: number) => void;
  setDraftIcon: (icon: BaptismIcon) => void;
  setDraftPointName: (name: string | null) => void;
  setDraftDisplayMode: (mode: 'colors' | 'tion' | 'both') => void;
  cancelDraft: () => void;
  confirmDraft: () => Promise<boolean>;
  renameAxis: (axisId: string, name: string | null) => Promise<boolean>;
  recolorAxis: (axisId: string, color: string) => Promise<boolean>;
  removeAxis: (axisId: string) => Promise<boolean>;
  setDisplayMode: (mode: 'colors' | 'tion' | 'both') => Promise<boolean>;
  setPointName: (name: string | null) => Promise<boolean>;
  removeBaptism: () => Promise<boolean>;
  clearMutationError: () => void;
};

export function useBaptism({ selectedMissionId }: { selectedMissionId: string | null }): UseBaptismResult {
  const [baptism, setBaptism] = useState<ApiBaptism | null>(null);
  const [draft, setDraft] = useState<BaptismDraftState | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const missionRef = useRef(selectedMissionId);
  missionRef.current = selectedMissionId;
  // Baptême terrain: identité du brouillon courant, lue par confirmDraft après ses
  // awaits pour détecter une annulation (cancelDraft met draft à null) survenue
  // pendant le calcul Overpass ou le PUT, et abandonner sans ressusciter l'état.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setBaptism(null);
    setDraft(null);
    setComputing(false);
    setComputeError(null);
    setMutationError(null);
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

  // Arme l'outil avec un brouillon vide : le point, l'icône, le nom et le mode
  // d'affichage sont choisis pas à pas dans l'assistant (placeAt / setDraftIcon /
  // setDraftPointName / setDraftDisplayMode), plus de choix d'icône préalable.
  const startPlacing = useCallback(() => {
    setDraft({ point: null, icon: null, pointName: null, displayMode: null });
    setComputeError(null);
  }, []);

  const placeAt = useCallback((lng: number, lat: number) => {
    setDraft((d) => (d ? { ...d, point: { lng, lat } } : d));
  }, []);

  const setDraftIcon = useCallback((icon: BaptismIcon) => {
    setDraft((d) => (d ? { ...d, icon } : d));
  }, []);

  const setDraftPointName = useCallback((name: string | null) => {
    setDraft((d) => (d ? { ...d, pointName: name } : d));
  }, []);

  const setDraftDisplayMode = useCallback((mode: 'colors' | 'tion' | 'both') => {
    setDraft((d) => (d ? { ...d, displayMode: mode } : d));
  }, []);

  const cancelDraft = useCallback(() => {
    setDraft(null);
    setComputeError(null);
  }, []);

  const confirmDraft = useCallback(async (): Promise<boolean> => {
    const missionId = missionRef.current;
    const d = draft;
    if (!missionId || !d?.point || !d.icon || !d.displayMode) return false;
    setComputing(true);
    setComputeError(null);
    try {
      const { axes } = await computeBaptismAxes(d.point, d.icon);
      // Annulé (cancelDraft) pendant le calcul : ne pas envoyer le PUT.
      if (draftRef.current !== d) return false;
      const saved = await putBaptism(missionId, {
        icon: d.icon,
        point: d.point,
        pointName: d.pointName,
        displayMode: d.displayMode,
        axes,
      });
      // Annulé pendant le PUT, ou mission changée entretemps : ne pas ressusciter l'état.
      // Le document vient d'être créé/mis à jour côté serveur ; on le supprime au mieux
      // pour ne pas laisser un orphelin que l'écho socket ferait resurgir.
      if (draftRef.current !== d || missionRef.current !== missionId) {
        try {
          await deleteBaptism(missionId);
        } catch {
          /* best effort */
        }
        return false;
      }
      setBaptism(saved);
      setDraft(null);
      return true;
    } catch (e: any) {
      if (draftRef.current === d && missionRef.current === missionId) {
        setComputeError(e?.message || 'OVERPASS_UNAVAILABLE');
      }
      return false;
    } finally {
      setComputing(false);
    }
  }, [draft]);

  const patch = useCallback(async (input: Parameters<typeof patchBaptism>[1]): Promise<boolean> => {
    const missionId = missionRef.current;
    if (!missionId) return false;
    try {
      const updated = await patchBaptism(missionId, input);
      if (missionRef.current === missionId) {
        setBaptism(updated);
        setMutationError(null);
      }
      return true;
    } catch (e: any) {
      if (missionRef.current === missionId) setMutationError(e?.message ?? 'Erreur');
      return false;
    }
  }, []);

  const renameAxis = useCallback((axisId: string, name: string | null) => patch({ axisId, name }), [patch]);
  const recolorAxis = useCallback((axisId: string, color: string) => patch({ axisId, color }), [patch]);
  const removeAxis = useCallback((axisId: string) => patch({ axisId, remove: true }), [patch]);
  const setDisplayMode = useCallback((mode: 'colors' | 'tion' | 'both') => patch({ displayMode: mode }), [patch]);
  const setPointName = useCallback((name: string | null) => patch({ pointName: name }), [patch]);

  const removeBaptism = useCallback(async (): Promise<boolean> => {
    const missionId = missionRef.current;
    if (!missionId) return false;
    try {
      await deleteBaptism(missionId);
      if (missionRef.current === missionId) {
        setBaptism(null);
        setMutationError(null);
      }
      return true;
    } catch (e: any) {
      if (missionRef.current === missionId) setMutationError(e?.message ?? 'Erreur');
      return false;
    }
  }, []);

  const clearMutationError = useCallback(() => {
    setMutationError(null);
  }, []);

  return {
    baptism,
    draft,
    computing,
    computeError,
    mutationError,
    startPlacing,
    placeAt,
    setDraftIcon,
    setDraftPointName,
    setDraftDisplayMode,
    cancelDraft,
    confirmDraft,
    renameAxis,
    recolorAxis,
    removeAxis,
    setDisplayMode,
    setPointName,
    removeBaptism,
    clearMutationError,
  };
}

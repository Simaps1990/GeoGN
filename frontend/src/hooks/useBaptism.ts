import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listBaptisms,
  createBaptism,
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
  baptisms: ApiBaptism[];
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
  renameAxis: (baptismId: string, axisId: string, name: string | null) => Promise<boolean>;
  recolorAxis: (baptismId: string, axisId: string, color: string) => Promise<boolean>;
  removeAxis: (baptismId: string, axisId: string) => Promise<boolean>;
  setDisplayMode: (baptismId: string, mode: 'colors' | 'tion' | 'both') => Promise<boolean>;
  setPointName: (baptismId: string, name: string | null) => Promise<boolean>;
  removeBaptism: (baptismId: string) => Promise<boolean>;
  clearMutationError: () => void;
};

// Upsert par id : partagé entre l'ajout optimiste (confirmDraft/patch) et l'écho socket,
// pour que le doublon possible entre les deux (le serveur émet avant de répondre au
// POST/PATCH HTTP) se résolve en une mise à jour sur place plutôt qu'une entrée en double.
function upsertBaptism(list: ApiBaptism[], b: ApiBaptism): ApiBaptism[] {
  const idx = list.findIndex((x) => x.id === b.id);
  if (idx === -1) return [...list, b];
  const next = list.slice();
  next[idx] = b;
  return next;
}

export function useBaptism({ selectedMissionId }: { selectedMissionId: string | null }): UseBaptismResult {
  const [baptisms, setBaptisms] = useState<ApiBaptism[]>([]);
  const [draft, setDraft] = useState<BaptismDraftState | null>(null);
  const [computing, setComputing] = useState(false);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const missionRef = useRef(selectedMissionId);
  missionRef.current = selectedMissionId;
  // Baptême terrain: identité du brouillon courant, lue par confirmDraft après ses
  // awaits pour détecter une annulation (cancelDraft met draft à null) survenue
  // pendant le calcul Overpass ou le POST, et abandonner sans ressusciter l'état.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setBaptisms([]);
    setDraft(null);
    setComputing(false);
    setComputeError(null);
    setMutationError(null);
    if (!selectedMissionId) return;
    let cancelled = false;
    listBaptisms(selectedMissionId)
      .then((list) => {
        if (!cancelled) setBaptisms(list);
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
      if (payload?.missionId === missionRef.current) {
        setBaptisms((prev) => upsertBaptism(prev, payload.baptism));
      }
    };
    const onDeleted = (payload: { missionId: string; baptismId: string }) => {
      if (payload?.missionId === missionRef.current) {
        setBaptisms((prev) => prev.filter((b) => b.id !== payload.baptismId));
      }
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
      // Annulé (cancelDraft) pendant le calcul : ne pas envoyer le POST.
      if (draftRef.current !== d) return false;
      const saved = await createBaptism(missionId, {
        icon: d.icon,
        point: d.point,
        pointName: d.pointName,
        displayMode: d.displayMode,
        axes,
      });
      // Annulé pendant le POST, ou mission changée entretemps : ne pas ressusciter l'état.
      // Le document vient d'être créé côté serveur ; on le supprime au mieux pour ne pas
      // laisser un orphelin que l'écho socket ferait resurgir. Cible désormais le doc créé
      // par son propre id (saved.id) — plus l'ancien DELETE mission-wide qui pouvait
      // effacer le baptême d'un coéquipier posé entretemps.
      if (draftRef.current !== d || missionRef.current !== missionId) {
        try {
          await deleteBaptism(missionId, saved.id);
        } catch {
          /* best effort */
        }
        return false;
      }
      setBaptisms((prev) => upsertBaptism(prev, saved));
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

  const patch = useCallback(
    async (baptismId: string, input: Parameters<typeof patchBaptism>[2]): Promise<boolean> => {
      const missionId = missionRef.current;
      if (!missionId) return false;
      try {
        const updated = await patchBaptism(missionId, baptismId, input);
        if (missionRef.current === missionId) {
          setBaptisms((prev) => upsertBaptism(prev, updated));
          setMutationError(null);
        }
        return true;
      } catch (e: any) {
        if (missionRef.current === missionId) setMutationError(e?.message ?? 'Erreur');
        return false;
      }
    },
    []
  );

  const renameAxis = useCallback(
    (baptismId: string, axisId: string, name: string | null) => patch(baptismId, { axisId, name }),
    [patch]
  );
  const recolorAxis = useCallback(
    (baptismId: string, axisId: string, color: string) => patch(baptismId, { axisId, color }),
    [patch]
  );
  const removeAxis = useCallback(
    (baptismId: string, axisId: string) => patch(baptismId, { axisId, remove: true }),
    [patch]
  );
  const setDisplayMode = useCallback(
    (baptismId: string, mode: 'colors' | 'tion' | 'both') => patch(baptismId, { displayMode: mode }),
    [patch]
  );
  const setPointName = useCallback(
    (baptismId: string, name: string | null) => patch(baptismId, { pointName: name }),
    [patch]
  );

  const removeBaptism = useCallback(async (baptismId: string): Promise<boolean> => {
    const missionId = missionRef.current;
    if (!missionId) return false;
    try {
      await deleteBaptism(missionId, baptismId);
      if (missionRef.current === missionId) {
        setBaptisms((prev) => prev.filter((b) => b.id !== baptismId));
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
    baptisms,
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

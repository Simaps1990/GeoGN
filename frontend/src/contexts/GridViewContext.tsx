import { createContext, useContext, useReducer, useEffect, useCallback, useMemo } from 'react';
import { useMission } from './MissionContext';

export type GridViewMode = 'off' | 'admin-select' | 'member-highlight';

export interface GridViewContextValue {
  mode: GridViewMode;
  selectedZoneIds: string[];
  highlightedZoneIds: string[];

  toggle(targetMode?: 'admin-select' | 'member-highlight'): void;
  addToSelection(zoneId: string): void;
  removeFromSelection(zoneId: string): void;
  toggleSelection(zoneId: string): void;
  clearSelection(): void;

  resetBadge(): void;
}

type GridViewState = {
  mode: GridViewMode;
  selectedZoneIds: string[];
  highlightedZoneIds: string[];
};

type GridViewAction =
  | { type: 'TOGGLE_MODE'; targetMode: GridViewMode }
  | { type: 'ADD_TO_SELECTION'; zoneId: string }
  | { type: 'REMOVE_FROM_SELECTION'; zoneId: string }
  | { type: 'TOGGLE_SELECTION'; zoneId: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'RESET_BADGE' }
  | { type: 'SET_HIGHLIGHTED_ZONE_IDS'; ids: string[] }
  | { type: 'RESET' };

function gridViewReducer(state: GridViewState, action: GridViewAction): GridViewState {
  switch (action.type) {
    case 'TOGGLE_MODE':
      return { ...state, mode: action.targetMode, selectedZoneIds: [], highlightedZoneIds: [] };
    case 'ADD_TO_SELECTION':
      if (state.selectedZoneIds.includes(action.zoneId)) return state;
      return { ...state, selectedZoneIds: [...state.selectedZoneIds, action.zoneId] };
    case 'REMOVE_FROM_SELECTION':
      return { ...state, selectedZoneIds: state.selectedZoneIds.filter((id) => id !== action.zoneId) };
    case 'TOGGLE_SELECTION':
      if (state.selectedZoneIds.includes(action.zoneId)) {
        return { ...state, selectedZoneIds: state.selectedZoneIds.filter((id) => id !== action.zoneId) };
      }
      return { ...state, selectedZoneIds: [...state.selectedZoneIds, action.zoneId] };
    case 'CLEAR_SELECTION':
      return { ...state, selectedZoneIds: [] };
    case 'RESET_BADGE':
      return state;
    case 'SET_HIGHLIGHTED_ZONE_IDS':
      return { ...state, highlightedZoneIds: action.ids };
    case 'RESET':
      return { mode: 'off', selectedZoneIds: [], highlightedZoneIds: [] };
    default:
      return state;
  }
}

const GridViewContext = createContext<GridViewContextValue | undefined>(undefined);

export function GridViewProvider({ children }: { children: React.ReactNode }) {
  const { selectedMissionId } = useMission();

  const [state, dispatch] = useReducer(gridViewReducer, {
    mode: 'off',
    selectedZoneIds: [],
    highlightedZoneIds: [],
  });

  // Reset complet quand missionId change ou est null
  useEffect(() => {
    dispatch({ type: 'RESET' });
  }, [selectedMissionId]);

  const toggle = useCallback((targetMode: 'admin-select' | 'member-highlight' = 'admin-select') => {
    dispatch({ type: 'TOGGLE_MODE', targetMode: state.mode === 'off' ? targetMode : 'off' });
  }, [state.mode]);

  const addToSelection = useCallback((zoneId: string) => {
    dispatch({ type: 'ADD_TO_SELECTION', zoneId });
  }, []);

  const removeFromSelection = useCallback((zoneId: string) => {
    dispatch({ type: 'REMOVE_FROM_SELECTION', zoneId });
  }, []);

  const toggleSelection = useCallback((zoneId: string) => {
    dispatch({ type: 'TOGGLE_SELECTION', zoneId });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: 'CLEAR_SELECTION' });
  }, []);

  const resetBadge = useCallback(() => {
    dispatch({ type: 'RESET_BADGE' });
  }, []);

  const setHighlightedZoneIds = useCallback((ids: string[]) => {
    dispatch({ type: 'SET_HIGHLIGHTED_ZONE_IDS', ids });
  }, []);

  const value = useMemo(() => ({
    mode: state.mode,
    selectedZoneIds: state.selectedZoneIds,
    highlightedZoneIds: state.highlightedZoneIds,
    toggle,
    addToSelection,
    removeFromSelection,
    toggleSelection,
    clearSelection,
    resetBadge,
    setHighlightedZoneIds,
  }), [state.mode, state.selectedZoneIds, state.highlightedZoneIds, toggle, addToSelection, removeFromSelection, toggleSelection, clearSelection, resetBadge, setHighlightedZoneIds]);

  return <GridViewContext.Provider value={value}>{children}</GridViewContext.Provider>;
}

export function useGridView() {
  const ctx = useContext(GridViewContext);
  if (!ctx) throw new Error('useGridView must be used within GridViewProvider');
  return ctx;
}

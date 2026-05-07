import { createContext, useContext, useReducer, useEffect } from 'react';
import { useMission } from './MissionContext';

export type GridViewMode = 'off' | 'admin-select' | 'member-highlight';

export interface GridViewContextValue {
  mode: GridViewMode;
  selectedZoneIds: string[];
  pendingAssignmentBadge: number;
  highlightedZoneIds: string[];

  toggle(): void;
  addToSelection(zoneId: string): void;
  removeFromSelection(zoneId: string): void;
  toggleSelection(zoneId: string): void;
  clearSelection(): void;

  incrementBadge(): void;
  resetBadge(): void;

  setHighlightedZoneIds(ids: string[]): void;
}

type GridViewState = {
  mode: GridViewMode;
  selectedZoneIds: string[];
  pendingAssignmentBadge: number;
  highlightedZoneIds: string[];
};

type GridViewAction =
  | { type: 'TOGGLE_MODE'; targetMode: GridViewMode }
  | { type: 'ADD_TO_SELECTION'; zoneId: string }
  | { type: 'REMOVE_FROM_SELECTION'; zoneId: string }
  | { type: 'TOGGLE_SELECTION'; zoneId: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'INCREMENT_BADGE' }
  | { type: 'RESET_BADGE' }
  | { type: 'SET_HIGHLIGHTED_ZONE_IDS'; ids: string[] }
  | { type: 'RESET' };

function gridViewReducer(state: GridViewState, action: GridViewAction): GridViewState {
  switch (action.type) {
    case 'TOGGLE_MODE':
      return { ...state, mode: action.targetMode, selectedZoneIds: [], pendingAssignmentBadge: 0, highlightedZoneIds: [] };
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
    case 'INCREMENT_BADGE':
      return { ...state, pendingAssignmentBadge: state.pendingAssignmentBadge + 1 };
    case 'RESET_BADGE':
      return { ...state, pendingAssignmentBadge: 0 };
    case 'SET_HIGHLIGHTED_ZONE_IDS':
      return { ...state, highlightedZoneIds: action.ids };
    case 'RESET':
      return { mode: 'off', selectedZoneIds: [], pendingAssignmentBadge: 0, highlightedZoneIds: [] };
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
    pendingAssignmentBadge: 0,
    highlightedZoneIds: [],
  });

  // Reset complet quand missionId change ou est null
  useEffect(() => {
    dispatch({ type: 'RESET' });
  }, [selectedMissionId]);

  const toggle = () => {
    if (state.mode !== 'off') {
      dispatch({ type: 'TOGGLE_MODE', targetMode: 'off' });
      return;
    }

    dispatch({ type: 'TOGGLE_MODE', targetMode: 'admin-select' });
  };

  const addToSelection = (zoneId: string) => {
    dispatch({ type: 'ADD_TO_SELECTION', zoneId });
  };

  const removeFromSelection = (zoneId: string) => {
    dispatch({ type: 'REMOVE_FROM_SELECTION', zoneId });
  };

  const toggleSelection = (zoneId: string) => {
    dispatch({ type: 'TOGGLE_SELECTION', zoneId });
  };

  const clearSelection = () => {
    dispatch({ type: 'CLEAR_SELECTION' });
  };

  const incrementBadge = () => {
    dispatch({ type: 'INCREMENT_BADGE' });
  };

  const resetBadge = () => {
    dispatch({ type: 'RESET_BADGE' });
  };

  const setHighlightedZoneIds = (ids: string[]) => {
    dispatch({ type: 'SET_HIGHLIGHTED_ZONE_IDS', ids });
  };

  const value: GridViewContextValue = {
    mode: state.mode,
    selectedZoneIds: state.selectedZoneIds,
    pendingAssignmentBadge: state.pendingAssignmentBadge,
    highlightedZoneIds: state.highlightedZoneIds,
    toggle,
    addToSelection,
    removeFromSelection,
    toggleSelection,
    clearSelection,
    incrementBadge,
    resetBadge,
    setHighlightedZoneIds,
  };

  return <GridViewContext.Provider value={value}>{children}</GridViewContext.Provider>;
}

export function useGridView() {
  const ctx = useContext(GridViewContext);
  if (!ctx) throw new Error('useGridView must be used within GridViewProvider');
  return ctx;
}

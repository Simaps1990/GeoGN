import { memo, type Dispatch, type SetStateAction } from 'react';
import type { Map as MapLibreMapInstance } from 'maplibre-gl';
import {
  Cctv,
  CircleDot,
  CircleDotDashed,
  Compass,
  Crosshair,
  Layers,
  MapPin,
  Navigation2,
  PawPrint,
  Ruler,
  Settings,
  Spline,
  Tag,
  Timer,
} from 'lucide-react';
import type { ApiPersonCase } from '../lib/api';

type MapRightToolbarProps = {
  followMyBearing: boolean;
  centerOnMe: () => void;
  toggleMapStyle: () => void;

  canEditMap: boolean;
  role: 'admin' | 'member' | 'viewer' | null;
  activeTool: 'none' | 'poi' | 'zone_circle' | 'zone_polygon';
  cancelDraft: () => void;

  setZoneMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  zoneMenuOpen: boolean;

  setDraftColor: (v: string) => void;
  setDraftIcon: (v: string) => void;
  setDraftComment: (v: string) => void;
  setActiveTool: Dispatch<SetStateAction<'none' | 'poi' | 'zone_circle' | 'zone_polygon'>>;

  settingsMenuOpen: boolean;
  setSettingsMenuOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  setSettingsNotification: (v: boolean) => void;
  settingsNotification: boolean;

  scaleEnabled: boolean;
  setScaleEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  labelsEnabled: boolean;
  setLabelsEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;
  camerasEnabled: boolean;
  setCamerasEnabled: (v: boolean | ((prev: boolean) => boolean)) => void;

  isAdmin: boolean;
  personPanelOpen: boolean;
  personPanelCollapsed: boolean;
  personEdit: boolean;
  timerModalOpen: boolean;

  projectionNotification: boolean;
  personCase: ApiPersonCase | null;
  userId: string | null;
  selectedMissionId: string | null;
  setDismissedPersonCaseId: (missionId: string, personCaseId: string) => void;
  setProjectionNotification: (v: boolean) => void;
  setNoProjectionToast: (v: boolean) => void;
  setPersonEdit: (v: boolean) => void;
  setPersonPanelCollapsed: (v: boolean) => void;
  setPersonPanelOpen: (v: boolean) => void;
  setShowActiveVehicleTrack: (v: boolean) => void;
  mapInstance: MapLibreMapInstance | null;
  mapReady: boolean;
  applyHeatmapVisibility: (map: MapLibreMapInstance, show: boolean) => void;
  showEstimationHeatmap: boolean;

  missionTraceRetentionSeconds: number | null;
  setTimerSecondsInput: (v: string) => void;
  setTimerError: (v: string | null) => void;
  setTimerModalOpen: (v: boolean) => void;

  setActionError: (v: string | null) => void;

  isMapRotated: boolean;
  resetNorth: () => void;
};

export const MapRightToolbar = memo(function MapRightToolbar({
  followMyBearing,
  centerOnMe,
  toggleMapStyle,
  canEditMap,
  role,
  activeTool,
  cancelDraft,
  setZoneMenuOpen,
  zoneMenuOpen,
  setDraftColor,
  setDraftIcon,
  setDraftComment,
  setActiveTool,
  settingsMenuOpen,
  setSettingsMenuOpen,
  setSettingsNotification,
  settingsNotification,
  scaleEnabled,
  setScaleEnabled,
  labelsEnabled,
  setLabelsEnabled,
  camerasEnabled,
  setCamerasEnabled,
  isAdmin,
  personPanelOpen,
  personPanelCollapsed,
  personEdit: _personEdit,
  timerModalOpen,
  projectionNotification,
  personCase,
  userId,
  selectedMissionId,
  setDismissedPersonCaseId,
  setProjectionNotification,
  setNoProjectionToast,
  setPersonEdit,
  setPersonPanelCollapsed,
  setPersonPanelOpen,
  setShowActiveVehicleTrack,
  mapInstance,
  mapReady,
  applyHeatmapVisibility,
  showEstimationHeatmap,
  missionTraceRetentionSeconds,
  setTimerSecondsInput,
  setTimerError,
  setTimerModalOpen,
  setActionError,
  isMapRotated,
  resetNorth,
}: MapRightToolbarProps) {
  return (
    <div
      className="fixed right-4 top-[calc(env(safe-area-inset-top)+16px)] z-[1000] flex flex-col gap-2 touch-none"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={centerOnMe}
        className={`h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white ${
          followMyBearing ? 'ring-1 ring-inset ring-blue-500/25' : ''
        }`}
        title={followMyBearing ? 'Suivre mon orientation' : 'Centrer sur moi'}
      >
        {followMyBearing ? (
          <Navigation2 className="mx-auto text-blue-600" size={20} />
        ) : (
          <Crosshair className="mx-auto text-gray-600" size={20} />
        )}
      </button>

      <button
        type="button"
        onClick={toggleMapStyle}
        className="h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
        title="Changer le fond de carte"
      >
        <Layers className="mx-auto text-gray-600" size={20} />
      </button>

      {canEditMap ? (
        <button
          type="button"
          onClick={() => {
            if (activeTool === 'poi') {
              cancelDraft();
              return;
            }
            cancelDraft();
            setZoneMenuOpen(false);
            setDraftColor('');
            setDraftIcon('');
            setDraftComment('');
            setActiveTool('poi');
          }}
          className={`h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white ${
            activeTool === 'poi' ? 'ring-1 ring-inset ring-blue-500/25' : ''
          }`}
          title="Ajouter un POI"
        >
          <MapPin className={activeTool === 'poi' ? 'mx-auto text-blue-600' : 'mx-auto text-gray-600'} size={20} />
        </button>
      ) : null}

      {role !== 'viewer' ? (
        <div
          className={`relative w-12 overflow-hidden rounded-2xl bg-white/0 shadow backdrop-blur p-px transition-all duration-200 ${
            zoneMenuOpen ? 'h-[160px] ring-1 ring-inset ring-black/10' : 'h-12 ring-0'
          }`}
        >
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                setActionError(null);

                if (canEditMap && (activeTool === 'zone_circle' || activeTool === 'zone_polygon')) {
                  cancelDraft();
                  setZoneMenuOpen(false);
                  return;
                }

                setZoneMenuOpen((v) => !v);
              }}
              className={`h-12 w-12 rounded-2xl border bg-white/90 inline-flex items-center justify-center transition-colors hover:bg-white ${
                zoneMenuOpen || activeTool === 'zone_circle' || activeTool === 'zone_polygon'
                  ? 'ring-1 ring-inset ring-blue-500/25'
                  : ''
              }`}
              title="Zones"
            >
              <CircleDotDashed
                className={
                  zoneMenuOpen || activeTool === 'zone_circle' || activeTool === 'zone_polygon'
                    ? 'mx-auto text-blue-600'
                    : 'mx-auto text-gray-600'
                }
                size={20}
              />
            </button>

            <div
              className={`flex flex-col gap-2 transition-all duration-200 ${
                zoneMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'
              }`}
            >
              {canEditMap ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTool === 'zone_circle') {
                        cancelDraft();
                        setZoneMenuOpen(false);
                        return;
                      }
                      cancelDraft();
                      setDraftColor('#2563eb');
                      setActiveTool('zone_circle');
                    }}
                    className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                      activeTool === 'zone_circle' ? 'ring-blue-500/25' : 'ring-black/10'
                    }`}
                    title="Zone cercle"
                  >
                    <CircleDot className={activeTool === 'zone_circle' ? 'text-blue-600' : 'text-gray-600'} size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeTool === 'zone_polygon') {
                        cancelDraft();
                        setZoneMenuOpen(false);
                        return;
                      }
                      cancelDraft();
                      setDraftColor('#2563eb');
                      setActiveTool('zone_polygon');
                    }}
                    className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                      activeTool === 'zone_polygon' ? 'ring-blue-500/25' : 'ring-black/10'
                    }`}
                    title="Zone à la main"
                  >
                    <Spline className={activeTool === 'zone_polygon' ? 'text-blue-600' : 'text-gray-600'} size={20} />
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className={`relative w-12 overflow-hidden rounded-2xl bg-white/0 shadow backdrop-blur p-px transition-all duration-200 ${
          settingsMenuOpen ? `${isAdmin ? 'h-[336px]' : 'h-[272px]'} ring-1 ring-inset ring-black/10` : 'h-12 ring-0'
        }`}
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              setActionError(null);

              setSettingsMenuOpen((v) => !v);
              // Ouverture du menu = on considère la notification comme vue
              setSettingsNotification(false);
              if (selectedMissionId && personCase) {
                setDismissedPersonCaseId(selectedMissionId, personCase.id);
              }
            }}
            className={`relative h-12 w-12 rounded-2xl border bg-white/90 inline-flex items-center justify-center transition-colors hover:bg-white ${
              settingsMenuOpen || scaleEnabled || labelsEnabled || camerasEnabled || personPanelOpen || timerModalOpen
                ? 'ring-1 ring-inset ring-blue-500/25'
                : ''
            }`}
            title="Settings"
          >
            <Settings
              className={
                settingsMenuOpen || scaleEnabled || labelsEnabled || camerasEnabled || personPanelOpen || timerModalOpen
                  ? 'mx-auto text-blue-600'
                  : 'mx-auto text-gray-600'
              }
              size={20}
            />
            {settingsNotification ? (
              <span className="absolute right-1 top-1 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white" />
            ) : null}
          </button>

          <div
            className={`flex flex-col gap-2 transition-all duration-200 ${
              settingsMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 pointer-events-none'
            }`}
          >
            <button
              type="button"
              onClick={() => setScaleEnabled((v) => !v)}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                scaleEnabled ? 'ring-blue-500/25' : 'ring-black/10'
              }`}
              title="Règle"
            >
              <Ruler className={scaleEnabled ? 'text-blue-600' : 'text-gray-600'} size={20} />
            </button>

            <button
              type="button"
              onClick={() => setLabelsEnabled((v) => !v)}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                labelsEnabled ? 'ring-blue-500/25' : 'ring-black/10'
              }`}
              title="Tag"
            >
              <Tag className={labelsEnabled ? 'text-blue-600' : 'text-gray-600'} size={18} />
            </button>

            <button
              type="button"
              onClick={() => {
                setCamerasEnabled((v) => !v);
              }}
              className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                camerasEnabled ? 'ring-blue-500/25' : 'ring-black/10'
              }`}
              title="Caméra"
            >
              <Cctv className={camerasEnabled ? 'text-blue-600' : 'text-gray-600'} size={18} />
            </button>

            <button
              type="button"
              onClick={() => {
                const map = mapInstance;

                setProjectionNotification(false);
                if (selectedMissionId && personCase && !(userId && personCase.createdBy === userId)) {
                  setDismissedPersonCaseId(selectedMissionId, personCase.id);
                }

                if (!personCase) {
                  if (!isAdmin) {
                    setNoProjectionToast(true);
                    return;
                  }
                  setPersonEdit(true);
                  setPersonPanelCollapsed(false);
                  setPersonPanelOpen(true);
                  return;
                }

                if (!isAdmin) {
                  setSettingsNotification(false);
                }

                if (personPanelOpen && personPanelCollapsed) {
                  setShowActiveVehicleTrack(false);
                  setPersonPanelOpen(false);
                  setPersonPanelCollapsed(false);
                  if (map && mapReady) applyHeatmapVisibility(map, false);
                  return;
                }

                if (personPanelOpen && !personPanelCollapsed) {
                  setShowActiveVehicleTrack(true);
                  setPersonEdit(false);
                  setPersonPanelCollapsed(true);
                  if (map && mapReady) {
                    applyHeatmapVisibility(map, showEstimationHeatmap);
                  }
                  return;
                }

                setPersonEdit(false);
                setPersonPanelCollapsed(true);
                setPersonPanelOpen(true);
                setShowActiveVehicleTrack(true);
                if (map && mapReady) {
                  applyHeatmapVisibility(map, showEstimationHeatmap);
                }
              }}
              className={`relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ${
                personPanelOpen ? 'ring-blue-500/25' : 'ring-black/10'
              } ${!isAdmin && !personCase ? 'opacity-60' : ''}`}
              title="Activité"
            >
              <PawPrint className={personPanelOpen && personCase ? 'text-blue-600' : 'text-gray-600'} size={20} />
              {projectionNotification && !(userId && personCase?.createdBy === userId) ? (
                <span className="absolute right-1 top-1 inline-flex h-2.5 w-2.5 items-center justify-center rounded-full bg-red-500 ring-2 ring-white" />
              ) : null}
            </button>

            {isAdmin ? (
              <button
                type="button"
                onClick={() => {
                  const rs = missionTraceRetentionSeconds ?? 3600;
                  setTimerSecondsInput(String(rs));
                  setTimerError(null);
                  setTimerModalOpen(true);
                }}
                className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm hover:bg-gray-50 ring-1 ring-inset ring-black/10"
                title="Minuteur"
              >
                <Timer className="text-gray-600" size={20} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {isMapRotated ? (
        <button
          type="button"
          onClick={resetNorth}
          className="h-12 w-12 rounded-2xl border bg-white/90 shadow backdrop-blur hover:bg-white"
          title="Boussole"
        >
          <Compass className="mx-auto text-gray-600" size={20} />
        </button>
      ) : null}
    </div>
  );
});

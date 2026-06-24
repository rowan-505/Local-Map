import { create } from 'zustand';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';
import type { MapMode } from '@/features/map/config';
import { persistMapMode, readPersistedMapMode } from '@/features/map/config/mapModeStorage';

export type MapUtilityAction = 'zoomIn' | 'zoomOut' | 'centerKyauktan';

type MapUtilityCommand = {
  readonly id: number;
  readonly action: MapUtilityAction;
};

type MapUiState = {
  readonly languageMode: PlaceLanguageMode;
  readonly mapMode: MapMode;
  readonly basemapModeError: string | null;
  readonly utilityCommand: MapUtilityCommand | null;
  readonly transportOverlayVisible: boolean;
  setLanguageMode: (mode: PlaceLanguageMode) => void;
  setMapMode: (mode: MapMode) => void;
  setBasemapModeError: (message: string | null) => void;
  dispatchUtilityAction: (action: MapUtilityAction) => void;
  setTransportOverlayVisible: (visible: boolean) => void;
  toggleTransportOverlay: () => void;
};

const initialMapMode = readPersistedMapMode() ?? 'normal';

/** Global map UI: language mode drives MapLibre `text-field` + React labels (API returns bilingual fields). */
export const useMapUiStore = create<MapUiState>((set) => ({
  languageMode: 'my',
  mapMode: initialMapMode,
  basemapModeError: null,
  utilityCommand: null,
  transportOverlayVisible: false,
  setLanguageMode: (mode) => set({ languageMode: mode }),
  setMapMode: (mode) => {
    persistMapMode(mode);
    set({ mapMode: mode, basemapModeError: null });
  },
  setBasemapModeError: (message) => set({ basemapModeError: message }),
  dispatchUtilityAction: (action) =>
    set((state) => ({
      utilityCommand: {
        id: (state.utilityCommand?.id ?? 0) + 1,
        action,
      },
    })),
  setTransportOverlayVisible: (visible) => set({ transportOverlayVisible: visible }),
  toggleTransportOverlay: () =>
    set((state) => ({ transportOverlayVisible: !state.transportOverlayVisible })),
}));

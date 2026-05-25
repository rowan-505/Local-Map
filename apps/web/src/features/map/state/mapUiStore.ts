import { create } from 'zustand';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';
import type { MapMode } from '@/features/map/config';

export type MapUtilityAction = 'zoomIn' | 'zoomOut' | 'centerKyauktan';

type MapUtilityCommand = {
  readonly id: number;
  readonly action: MapUtilityAction;
};

type MapUiState = {
  readonly languageMode: PlaceLanguageMode;
  readonly mapMode: MapMode;
  readonly utilityCommand: MapUtilityCommand | null;
  setLanguageMode: (mode: PlaceLanguageMode) => void;
  setMapMode: (mode: MapMode) => void;
  dispatchUtilityAction: (action: MapUtilityAction) => void;
};

/** Global map UI: language mode drives MapLibre `text-field` + React labels (API returns bilingual fields). */
export const useMapUiStore = create<MapUiState>((set) => ({
  languageMode: 'my',
  mapMode: 'normal',
  utilityCommand: null,
  setLanguageMode: (mode) => set({ languageMode: mode }),
  setMapMode: (mode) => set({ mapMode: mode }),
  dispatchUtilityAction: (action) =>
    set((state) => ({
      utilityCommand: {
        id: (state.utilityCommand?.id ?? 0) + 1,
        action,
      },
    })),
}));

/**
 * Public props for the map UI — stable surface if the underlying map SDK changes.
 */
import type { Poi } from '@/types';
import type { SearchCameraTarget } from '@/features/poi/api/publicMapApi';

export type MapClickedLocation = {
  readonly label: string;
  readonly coordinates: readonly [number, number];
};

export type MapViewportState = {
  readonly bbox: readonly [number, number, number, number];
  readonly zoom: number;
};

export type MapViewProps = {
  readonly pois: readonly Poi[];
  readonly selectedPoiId: string | null;
  readonly selectedPoi?: Poi;
  readonly cameraTarget?: SearchCameraTarget;
  readonly clickedLocation?: MapClickedLocation | null;
  /** Called when a POI marker is clicked, or when the map is clicked away from markers. */
  readonly onSelectPoiId: (id: string | null) => void;
  readonly onEmptyMapClick?: (location: MapClickedLocation) => void;
  readonly onViewportChange?: (viewport: MapViewportState) => void;
  readonly className?: string;
};

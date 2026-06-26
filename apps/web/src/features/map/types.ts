/**
 * Public props for the map UI — stable surface if the underlying map SDK changes.
 */
import type { Poi } from '@/types';
import type { PublicSearchResult, SearchCameraTarget } from '@/features/poi/api/publicMapApi';
import type { DirectionsMapOverlay } from './lib/maplibre/directionsRouteGeoJson';
import type { MapCameraLayout } from './lib/mapCameraPadding';

export type MapClickedLocation = {
  readonly label: string;
  readonly coordinates: readonly [number, number];
  /** Optional snapshot (e.g. from a resolved share link) shown before reverse geocode. */
  readonly addressLine?: string | null;
  readonly plusCode?: string | null;
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
  /** Selected search result to highlight + frame on the map (null clears it). */
  readonly searchHighlight?: PublicSearchResult | null;
  /** Loading state for the geometry overlay fetch only (line/polygon results). */
  readonly onSearchHighlightLoadingChange?: (loading: boolean) => void;
  readonly cameraLayout: MapCameraLayout;
  readonly clickedLocation?: MapClickedLocation | null;
  readonly directionsOverlay?: DirectionsMapOverlay | null;
  /** When set, the next map click sets a route endpoint instead of opening place/address UI. */
  readonly routePickMode?: 'from' | 'to' | null;
  /** Called when a POI marker is clicked, or when the map is clicked away from markers. */
  readonly onSelectPoiId: (id: string | null) => void;
  readonly onEmptyMapClick?: (location: MapClickedLocation) => void;
  readonly onViewportChange?: (viewport: MapViewportState) => void;
  readonly className?: string;
};

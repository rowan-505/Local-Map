/**
 * Public props for the map UI — stable surface if the underlying map SDK changes.
 */
import type { Poi } from '@/types';
import type { PublicSearchResult, SearchCameraTarget } from '@/features/poi/api/publicMapApi';
import type { UserLocationFix } from '@/features/location/userLocationTypes';
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

/**
 * One-shot camera instruction for the own-user location feature. The parent owns
 * coverage decisions and bumps `id` to request a move; `type` selects the target:
 * `user` flies to the latest fix, `yangon` flies to the default coverage focus.
 */
export type LocationCameraCommand = {
  readonly id: number;
  readonly type: 'user' | 'yangon';
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
  /** Latest own-user location fix to render (blue dot + accuracy ring). `null` clears it. */
  readonly userLocationFix?: UserLocationFix | null;
  /** When true, the camera gently follows fresh in-coverage fixes. */
  readonly userLocationFollowing?: boolean;
  /** Whether the latest fix is inside CoreMap's approximate coverage (`null` = unknown). */
  readonly userLocationInsideCoverage?: boolean | null;
  /** One-shot camera command for the locate button / first-fix / fallback flows. */
  readonly locationCameraCommand?: LocationCameraCommand | null;
  /** Called when a manual gesture (pan/zoom/drag/rotate/pitch) should end follow mode. */
  readonly onUserLocationFollowDisengage?: () => void;
  /** Called when a POI marker is clicked, or when the map is clicked away from markers. */
  readonly onSelectPoiId: (id: string | null) => void;
  readonly onEmptyMapClick?: (location: MapClickedLocation) => void;
  readonly onViewportChange?: (viewport: MapViewportState) => void;
  readonly className?: string;
};

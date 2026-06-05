/**
 * Myanmar overview viewport for the **public web map only** (`apps/web`).
 * Dashboard editors use their own map init — do not import this module there.
 *
 * Startup `fitBounds` composes overview PMTiles in the visible map area (sidebar-aware padding).
 * No permanent viewport lock by default — users can pan/zoom freely after the first fit.
 */
import type { PaddingOptions } from 'maplibre-gl';

/**
 * Optional permanent pan/zoom lock (`maxBounds`, strict restore clamp, high minZoom).
 * Set `true` to restore production-style bounds lock later.
 */
export const ENABLE_OVERVIEW_VIEWPORT_LOCK = false;

/** Target bounds for startup `fitBounds` (Myanmar + direct neighbors). */
export const OVERVIEW_FIT_BOUNDS: readonly [[number, number], [number, number]] = [
  [80.0, 5.0],
  [110.0, 32.0],
];

/** @deprecated Use {@link OVERVIEW_FIT_BOUNDS} */
export const PUBLIC_MAP_OVERVIEW_BOUNDS = OVERVIEW_FIT_BOUNDS;
export const OVERVIEW_BOUNDS = OVERVIEW_FIT_BOUNDS;

/** Fallback MapLibre constructor camera before startup fit runs. */
export const OVERVIEW_FALLBACK_CENTER: [number, number] = [96.0, 19.5];
export const OVERVIEW_FALLBACK_ZOOM = 4.0;
/** Low floor for exploration; not raised after startup unless {@link ENABLE_OVERVIEW_VIEWPORT_LOCK}. */
export const OVERVIEW_FALLBACK_MIN_ZOOM = 2.0;

/**
 * Startup fit padding — expanded sidebar covers the left; collapsed uses full map width.
 * Left padding centers Myanmar in the **visible** map area, not the full canvas.
 */
export const OVERVIEW_STARTUP_PADDING_EXPANDED: PaddingOptions = {
  top: 48,
  right: 72,
  bottom: 48,
  left: 560,
};

export const OVERVIEW_STARTUP_PADDING_COLLAPSED: PaddingOptions = {
  top: 48,
  right: 72,
  bottom: 48,
  left: 120,
};

/** @deprecated Use {@link OVERVIEW_STARTUP_PADDING_EXPANDED} */
export const PUBLIC_MAP_OVERVIEW_FIT_PADDING_SIDEBAR_OPEN = OVERVIEW_STARTUP_PADDING_EXPANDED;
/** @deprecated Use {@link OVERVIEW_STARTUP_PADDING_COLLAPSED} */
export const PUBLIC_MAP_OVERVIEW_FIT_PADDING_SIDEBAR_COLLAPSED =
  OVERVIEW_STARTUP_PADDING_COLLAPSED;

export function getPublicMapOverviewStartupFitPadding(sidebarOpen: boolean): PaddingOptions {
  return sidebarOpen ? OVERVIEW_STARTUP_PADDING_EXPANDED : OVERVIEW_STARTUP_PADDING_COLLAPSED;
}

/** @deprecated Use {@link getPublicMapOverviewStartupFitPadding} */
export const getPublicMapOverviewFitPadding = getPublicMapOverviewStartupFitPadding;

export const PUBLIC_MAP_OVERVIEW_CENTER: [number, number] = [
  (OVERVIEW_FIT_BOUNDS[0][0] + OVERVIEW_FIT_BOUNDS[1][0]) / 2,
  (OVERVIEW_FIT_BOUNDS[0][1] + OVERVIEW_FIT_BOUNDS[1][1]) / 2,
];

export const PUBLIC_MAP_OVERVIEW_INITIAL_ZOOM = OVERVIEW_FALLBACK_ZOOM;
export const PUBLIC_MAP_OVERVIEW_MIN_ZOOM = 3.8;

/** Used only when {@link ENABLE_OVERVIEW_VIEWPORT_LOCK} is `true`. */
export const PUBLIC_MAP_OVERVIEW_MAX_BOUNDS: readonly [
  [number, number],
  [number, number],
] = [
  [78.0, 3.0],
  [112.0, 34.0],
];

export const PUBLIC_MAP_MAX_ZOOM = 20;
export const PUBLIC_MAP_VIEWPORT_SESSION_KEY = 'coremap.public-map.viewport.v1';

export const MYANMAR_OVERVIEW_CENTER = PUBLIC_MAP_OVERVIEW_CENTER;
export const MYANMAR_OVERVIEW_ZOOM = PUBLIC_MAP_OVERVIEW_INITIAL_ZOOM;
export const MYANMAR_OVERVIEW_MIN_ZOOM = PUBLIC_MAP_OVERVIEW_MIN_ZOOM;
export const MYANMAR_OVERVIEW_MAX_BOUNDS = PUBLIC_MAP_OVERVIEW_MAX_BOUNDS;

export const MAP_MAX_BOUNDS = PUBLIC_MAP_OVERVIEW_MAX_BOUNDS;
export const MAP_MIN_ZOOM = PUBLIC_MAP_OVERVIEW_MIN_ZOOM;
export const MAP_MAX_ZOOM = PUBLIC_MAP_MAX_ZOOM;

export type PublicMapCamera = {
  center: [number, number];
  zoom: number;
};

export type RestoredPublicMapViewport = PublicMapCamera;

function overviewMaxBounds() {
  const [[minLng, minLat], [maxLng, maxLat]] = PUBLIC_MAP_OVERVIEW_MAX_BOUNDS;
  return { minLng, minLat, maxLng, maxLat };
}

export function isPublicMapOverviewViewportLockEnabled(): boolean {
  return ENABLE_OVERVIEW_VIEWPORT_LOCK;
}

export function getEffectivePublicMapMinZoom(): number {
  return ENABLE_OVERVIEW_VIEWPORT_LOCK
    ? PUBLIC_MAP_OVERVIEW_MIN_ZOOM
    : OVERVIEW_FALLBACK_MIN_ZOOM;
}

export function isLngLatWithinPublicMapBounds(lng: number, lat: number): boolean {
  if (!ENABLE_OVERVIEW_VIEWPORT_LOCK) return true;
  const { minLng, minLat, maxLng, maxLat } = overviewMaxBounds();
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

export function clampLngLatToPublicMapBounds(lng: number, lat: number): [number, number] {
  if (!ENABLE_OVERVIEW_VIEWPORT_LOCK) return [lng, lat];
  const { minLng, minLat, maxLng, maxLat } = overviewMaxBounds();
  return [
    Math.min(maxLng, Math.max(minLng, lng)),
    Math.min(maxLat, Math.max(minLat, lat)),
  ];
}

export function clampZoomToPublicMap(zoom: number): number {
  return Math.min(PUBLIC_MAP_MAX_ZOOM, Math.max(getEffectivePublicMapMinZoom(), zoom));
}

export function normalizeRestoredPublicMapViewport(
  candidate: RestoredPublicMapViewport | null | undefined,
): RestoredPublicMapViewport | null {
  if (!candidate) return null;
  const lng = candidate.center?.[0];
  const lat = candidate.center?.[1];
  const zoom = candidate.zoom;
  if (typeof lng !== 'number' || typeof lat !== 'number' || typeof zoom !== 'number') {
    return null;
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(zoom)) {
    return null;
  }
  if (ENABLE_OVERVIEW_VIEWPORT_LOCK && !isLngLatWithinPublicMapBounds(lng, lat)) {
    return null;
  }
  return {
    center: clampLngLatToPublicMapBounds(lng, lat),
    zoom: clampZoomToPublicMap(zoom),
  };
}

export function readRestoredPublicMapViewport(): RestoredPublicMapViewport | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(PUBLIC_MAP_VIEWPORT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RestoredPublicMapViewport;
    return normalizeRestoredPublicMapViewport(parsed);
  } catch {
    return null;
  }
}

export function persistPublicMapViewport(viewport: PublicMapCamera): void {
  if (typeof sessionStorage === 'undefined') return;
  const normalized = normalizeRestoredPublicMapViewport(viewport);
  if (!normalized) return;
  try {
    sessionStorage.setItem(PUBLIC_MAP_VIEWPORT_SESSION_KEY, JSON.stringify(normalized));
  } catch {
    /* quota / private mode */
  }
}

/** Constructor camera before startup fit (or restored same-tab viewport). */
export function getPublicMapInitialCamera(): PublicMapCamera {
  const restored = readRestoredPublicMapViewport();
  if (restored) {
    return restored;
  }
  return {
    center: [...OVERVIEW_FALLBACK_CENTER],
    zoom: OVERVIEW_FALLBACK_ZOOM,
  };
}

/** True when startup `fitBounds` should run (no restored in-tab camera). */
export function shouldFitPublicMapOverviewOnLoad(): boolean {
  return readRestoredPublicMapViewport() === null;
}

type OverviewFitMap = {
  fitBounds: (
    bounds: [[number, number], [number, number]],
    options?: { padding?: PaddingOptions; duration?: number; maxZoom?: number },
  ) => void;
  resize?: () => void;
};

/**
 * Startup fit for overview PMTiles visual composition in the visible map area.
 * Sidebar-expanded uses large left padding so Myanmar centers in the right-side viewport.
 * No permanent viewport lock is applied — users can explore freely after this fit.
 */
export function fitPublicMapOverviewViewport(
  map: OverviewFitMap,
  padding: PaddingOptions = OVERVIEW_STARTUP_PADDING_EXPANDED,
): void {
  const [[swLng, swLat], [neLng, neLat]] = OVERVIEW_FIT_BOUNDS;
  map.resize?.();
  map.fitBounds(
    [
      [swLng, swLat],
      [neLng, neLat],
    ],
    {
      padding,
      duration: 0,
    },
  );
}

/** MapLibre constructor options for the public web map. */
export function getPublicMapMapLibreInitOptions(): {
  center: [number, number];
  zoom: number;
  minZoom: number;
  maxZoom: number;
  maxBounds?: typeof PUBLIC_MAP_OVERVIEW_MAX_BOUNDS;
} {
  const { center, zoom } = getPublicMapInitialCamera();
  return {
    center,
    zoom,
    minZoom: getEffectivePublicMapMinZoom(),
    maxZoom: PUBLIC_MAP_MAX_ZOOM,
    ...(ENABLE_OVERVIEW_VIEWPORT_LOCK
      ? { maxBounds: PUBLIC_MAP_OVERVIEW_MAX_BOUNDS }
      : {}),
  };
}

/** Fly-to / search targets — loose clamp when permanent lock is off. */
export function clampPublicMapFlyToTarget(
  center: readonly [number, number],
  zoom?: number,
): { center: [number, number]; zoom: number } {
  const [lng, lat] = clampLngLatToPublicMapBounds(center[0], center[1]);
  return {
    center: [lng, lat],
    zoom: clampZoomToPublicMap(zoom ?? 16),
  };
}

/**
 * Regional basemap zoom policy (PMTiles native detail vs public map camera).
 *
 * - Native PMTiles: z8–z20 (tippecanoe)
 * - Public map camera: up to z20 (matches native tile detail)
 * - MapLibre vector source: z20 (no overzoom required at public max zoom)
 */

/** Native max zoom baked into regional PMTiles archives. */
export const NATIVE_REGION_TILE_MAX_ZOOM = 20 as const;

/** Public web map camera max zoom. */
export const PUBLIC_MAP_MAX_ZOOM = 20 as const;

/** MapLibre vector source maxzoom — matches native regional tiles. */
export const REGIONAL_VECTOR_SOURCE_OVERZOOM_MAX_ZOOM = PUBLIC_MAP_MAX_ZOOM;

/**
 * Minimum MapLibre layer maxzoom for basemap geometry that must stay visible
 * through {@link PUBLIC_MAP_MAX_ZOOM}.
 */
export const REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM = PUBLIC_MAP_MAX_ZOOM;

/** Recommended public map max zoom written to regional current.json pointers. */
export const RECOMMENDED_REGIONAL_MAP_MAX_ZOOM = PUBLIC_MAP_MAX_ZOOM;

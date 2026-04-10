/**
 * MVP region scope — one country, one operational area (Kyauktan).
 * Map UI and data loading both read from here; no duplicate bbox literals elsewhere.
 */

/** MapLibre GL–compatible `maxBounds`: [southwest, northeast] as [lng, lat] pairs. */
export type LngLatBounds = readonly [readonly [number, number], readonly [number, number]];

export const REGION_SCOPE = {
  country: {
    code: 'MM' as const,
    name: 'Myanmar',
    /**
     * National extent (SW then NE, [lng, lat]) — map `minZoom` + initial fit use this via `mapDefaults`.
     */
    boundsLngLat: [
      [92.0, 9.0],
      [101.5, 29.5],
    ] as const satisfies LngLatBounds,
  },
  /**
   * Active operational footprint — bbox for Kyauktan MVP.
   * Use for: API `bbox` / spatial queries, client “in scope” checks, map logic that needs the official area.
   * Map country fit / `minZoom` use `country.boundsLngLat` via `mapDefaults`; pan limits use a wider box there.
   */
  operationalArea: {
    id: 'kyauktan' as const,
    label: 'Kyauktan',
    centerLngLat: [96.32278, 16.63806] as [number, number],
    /** Operational bbox for camera / queries. Map polygon: `src/data/geo/kyauktan-township.json` (OSM). */
    boundsLngLat: [
      [96.12, 16.48],
      [96.52, 16.78],
    ] as const satisfies LngLatBounds,
  },
} as const;

export type RegionScope = typeof REGION_SCOPE;

/** Convenience alias for fetch/query code — same reference as `REGION_SCOPE.operationalArea.boundsLngLat`. */
export const OPERATIONAL_BOUNDS = REGION_SCOPE.operationalArea.boundsLngLat;

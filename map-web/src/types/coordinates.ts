/**
 * Geographic primitives shared across map code.
 * LngLat tuple order matches GeoJSON and MapLibre/Mapbox `LngLatLike` ([lng, lat]).
 */

/** WGS84 degrees — object form for app/domain code and forms. */
export type Coordinates = {
  readonly longitude: number;
  readonly latitude: number;
};

/** Tuple form for map APIs (GeoJSON positions, map.setCenter, markers). */
export type LngLatTuple = readonly [longitude: number, latitude: number];

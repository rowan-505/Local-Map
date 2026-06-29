/**
 * GeoJSON builders for rendering the own-user location (dot + accuracy ring).
 *
 * Dependency-light: no Turf.js, no browser, no MapLibre. The accuracy ring uses a
 * simple equirectangular meters→degrees approximation, which is fine at the small
 * radii (tens of meters) of a typical GPS fix. Coordinates follow GeoJSON order
 * `[lng, lat]`.
 */
import type { UserLocationFix } from './userLocationTypes';

const METERS_PER_DEGREE_LAT = 111320;

export type UserLocationFeatureKind = 'point' | 'accuracy';

type UserLocationFeatureProperties = {
  readonly kind: UserLocationFeatureKind;
  readonly accuracyM: number | null;
  readonly headingDeg: number | null;
};

/** Center dot feature for a fix. Coordinates are `[lng, lat]`. */
export function createUserLocationPointFeature(
  fix: UserLocationFix,
): GeoJSON.Feature<GeoJSON.Point, UserLocationFeatureProperties> {
  return {
    type: 'Feature',
    properties: {
      kind: 'point',
      accuracyM: isFiniteNumber(fix.accuracyM) ? fix.accuracyM : null,
      headingDeg: isFiniteNumber(fix.headingDeg) ? fix.headingDeg : null,
    },
    geometry: {
      type: 'Point',
      coordinates: [fix.lng, fix.lat],
    },
  };
}

/**
 * Polygon approximating the accuracy radius (`accuracyM`) around the fix.
 * Returns `null` when accuracy is missing or non-positive.
 */
export function createAccuracyCircleFeature(
  fix: UserLocationFix,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon, UserLocationFeatureProperties> | null {
  const accuracyM = fix.accuracyM;
  if (!isFiniteNumber(accuracyM) || accuracyM <= 0) return null;

  const stepCount = Math.max(3, Math.floor(steps));
  const latRadians = (fix.lat * Math.PI) / 180;
  const cosLat = Math.cos(latRadians);

  const latOffset = accuracyM / METERS_PER_DEGREE_LAT;
  // Guard against the pole singularity where cos(lat) → 0.
  const lngOffset =
    Math.abs(cosLat) < 1e-9
      ? latOffset
      : accuracyM / (METERS_PER_DEGREE_LAT * cosLat);

  const ring: GeoJSON.Position[] = [];
  for (let i = 0; i < stepCount; i += 1) {
    const angle = (i / stepCount) * 2 * Math.PI;
    ring.push([
      fix.lng + lngOffset * Math.cos(angle),
      fix.lat + latOffset * Math.sin(angle),
    ]);
  }
  ring.push(ring[0]);

  return {
    type: 'Feature',
    properties: {
      kind: 'accuracy',
      accuracyM,
      headingDeg: isFiniteNumber(fix.headingDeg) ? fix.headingDeg : null,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [ring],
    },
  };
}

/**
 * Combined collection: accuracy ring (when valid) followed by the center dot.
 * Layers can filter on `properties.kind` to style each separately.
 */
export function createUserLocationFeatureCollection(
  fix: UserLocationFix,
): GeoJSON.FeatureCollection<
  GeoJSON.Point | GeoJSON.Polygon,
  UserLocationFeatureProperties
> {
  const features: GeoJSON.Feature<
    GeoJSON.Point | GeoJSON.Polygon,
    UserLocationFeatureProperties
  >[] = [];

  const circle = createAccuracyCircleFeature(fix);
  if (circle) features.push(circle);
  features.push(createUserLocationPointFeature(fix));

  return {
    type: 'FeatureCollection',
    features,
  };
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

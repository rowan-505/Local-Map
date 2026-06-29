/**
 * Lightweight coverage helpers for the own-user location button's camera fallback.
 *
 * This is a coarse bounding-box heuristic only — NOT an authoritative admin/boundary
 * check. Do not use it for data validation, geofencing, or anything beyond deciding
 * where to point the camera when a user is far outside the map's intended coverage.
 * Dependency-free: no API, no database, no Supabase, no admin geometries.
 */

export const COREMAP_DEFAULT_FOCUS = {
  label: 'Yangon Region',
  center: [96.1561, 16.8661] as [number, number],
  zoom: 11,
} as const;

export const MYANMAR_APPROX_BOUNDS = {
  minLat: 9.5,
  maxLat: 28.8,
  minLng: 92.0,
  maxLng: 101.3,
} as const;

/**
 * Coarse "is this roughly inside Myanmar?" test against {@link MYANMAR_APPROX_BOUNDS}.
 * Returns false for any non-finite input.
 */
export function isInsideMyanmarApprox(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= MYANMAR_APPROX_BOUNDS.minLat &&
    lat <= MYANMAR_APPROX_BOUNDS.maxLat &&
    lng >= MYANMAR_APPROX_BOUNDS.minLng &&
    lng <= MYANMAR_APPROX_BOUNDS.maxLng
  );
}

export function getOutOfCoverageMessage(): string {
  return 'You are outside CoreMap coverage. Showing Yangon Region instead.';
}

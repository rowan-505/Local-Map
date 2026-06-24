/**
 * Lightweight bounding-box helpers for dynamic PMTiles region selection.
 * No MapLibre import — `mapBoundsToBbox` accepts the structural bounds shape only.
 */

/** Geographic bounds as `[minLng, minLat, maxLng, maxLat]` (west, south, east, north). */
export type BBox = [number, number, number, number];

/** Minimal MapLibre `LngLatBounds` shape (avoids importing maplibre-gl here). */
export interface MapBoundsLike {
  getWest(): number;
  getSouth(): number;
  getEast(): number;
  getNorth(): number;
}

/** True when boxes `a` and `b` overlap (edge-touching counts as intersecting). */
export function bboxIntersects(a: BBox, b: BBox): boolean {
  const [aMinLng, aMinLat, aMaxLng, aMaxLat] = a;
  const [bMinLng, bMinLat, bMaxLng, bMaxLat] = b;
  return (
    aMinLng <= bMaxLng &&
    aMaxLng >= bMinLng &&
    aMinLat <= bMaxLat &&
    aMaxLat >= bMinLat
  );
}

/** Area of the overlap rectangle between `a` and `b` in squared degrees (0 when disjoint). */
export function bboxOverlapArea(a: BBox, b: BBox): number {
  const minLng = Math.max(a[0], b[0]);
  const minLat = Math.max(a[1], b[1]);
  const maxLng = Math.min(a[2], b[2]);
  const maxLat = Math.min(a[3], b[3]);
  const width = maxLng - minLng;
  const height = maxLat - minLat;
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

/** Converts MapLibre map bounds to a normalized `[minLng, minLat, maxLng, maxLat]` BBox. */
export function mapBoundsToBbox(bounds: MapBoundsLike): BBox {
  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  return [Math.min(west, east), Math.min(south, north), Math.max(west, east), Math.max(south, north)];
}

import type { FeatureCollection, Geometry, Position } from 'geojson';

export type LngLatBoundsPair = [[number, number], [number, number]];

type Acc = { minLng: number; minLat: number; maxLng: number; maxLat: number };

function extend(acc: Acc, pos: Position): void {
  const lng = pos[0];
  const lat = pos[1];
  acc.minLng = Math.min(acc.minLng, lng);
  acc.maxLng = Math.max(acc.maxLng, lng);
  acc.minLat = Math.min(acc.minLat, lat);
  acc.maxLat = Math.max(acc.maxLat, lat);
}

function walkGeometry(geom: Geometry, acc: Acc): void {
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) {
      for (const p of ring) extend(acc, p);
    }
    return;
  }
  if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly) {
        for (const p of ring) extend(acc, p);
      }
    }
  }
}

/** SW then NE corners `[lng, lat]` — from all polygon rings in the collection. */
export function boundsFromFeatureCollection(fc: FeatureCollection): LngLatBoundsPair {
  const acc: Acc = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity,
  };
  for (const f of fc.features) {
    if (f.geometry) walkGeometry(f.geometry, acc);
  }
  if (!Number.isFinite(acc.minLng)) {
    throw new Error('boundsFromFeatureCollection: no measurable geometry');
  }
  return [
    [acc.minLng, acc.minLat],
    [acc.maxLng, acc.maxLat],
  ];
}

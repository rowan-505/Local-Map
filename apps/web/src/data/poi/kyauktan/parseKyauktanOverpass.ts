/**
 * Kyauktan township scope: extract POI-like OSM nodes from a local Overpass JSON file
 * and drop anything outside `REGION_SCOPE.operationalArea` bounds.
 */
import type { LngLatBounds } from '../../../config/regionScope';
import type { OverpassDocument, OverpassOsmNode } from './overpassTypes';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isOverpassOsmNode(el: unknown): el is OverpassOsmNode {
  if (!isRecord(el)) return false;
  if (el.type !== 'node') return false;
  if (typeof el.id !== 'number') return false;
  if (typeof el.lat !== 'number' || typeof el.lon !== 'number') return false;
  if (el.tags !== undefined) {
    if (!isRecord(el.tags)) return false;
    for (const v of Object.values(el.tags)) {
      if (typeof v !== 'string') return false;
    }
  }
  return true;
}

function inBounds(lon: number, lat: number, bounds: LngLatBounds): boolean {
  const [[minLng, minLat], [maxLng, maxLat]] = bounds;
  return lon >= minLng && lon <= maxLng && lat >= minLat && lat <= maxLat;
}

/** Nodes with at least one tag; coordinates inside operational Kyauktan bbox only. */
export function parseKyauktanOverpassNodes(
  doc: OverpassDocument,
  operationalBounds: LngLatBounds,
): readonly OverpassOsmNode[] {
  const raw = doc.elements;
  if (!Array.isArray(raw)) return [];

  const out: OverpassOsmNode[] = [];
  for (const el of raw) {
    if (!isOverpassOsmNode(el)) continue;
    const tags = el.tags;
    if (tags === undefined || Object.keys(tags).length === 0) continue;
    if (!inBounds(el.lon, el.lat, operationalBounds)) continue;
    out.push(el);
  }
  return out;
}

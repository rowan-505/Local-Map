/**
 * Kyauktan-only: raw Overpass JSON → app `Poi[]`.
 *
 * Skips: invalid geometry, out-of-area nodes (via parse), empty tags, entries without a POI classifier tag,
 * and non-finite coordinates. Unknown / unmapped tags → category `other` (see `osmTagsToCategory`).
 * Final pass: `cleanupKyauktanPois` (coordinates, browseable names, soft dedupe).
 */
import type { LngLatBounds } from '../../../config/regionScope';
import type { Poi } from '../../../types';
import { cleanupKyauktanPois } from './cleanupKyauktanPois';
import { osmTagsToCategory } from './osmTagsToCategory';
import { parseKyauktanOverpassNodes } from './parseKyauktanOverpass';
import type { OverpassDocument, OverpassOsmNode } from './overpassTypes';

/** Must have at least one of these keys (non-empty) or the object is treated as not a POI. */
const POI_CLASSIFIER_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'historic'] as const;

function hasPoiClassifier(tags: Readonly<Record<string, string>>): boolean {
  for (const key of POI_CLASSIFIER_KEYS) {
    const v = tags[key];
    if (v !== undefined && v.trim() !== '') return true;
  }
  return false;
}

/** Subcategory string — priority order is explicit; change here to adjust UI labels. */
function deriveSubcategory(tags: Readonly<Record<string, string>>): string {
  for (const key of POI_CLASSIFIER_KEYS) {
    const v = tags[key];
    if (v !== undefined && v.trim() !== '') {
      return `${key}=${v}`;
    }
  }
  return 'unknown';
}

function displayName(tags: Readonly<Record<string, string>>): string {
  return (
    tags.name ??
    tags['name:en'] ??
    tags.brand ??
    tags.operator ??
    tags.ref ??
    'Unnamed place'
  );
}

function formatAddress(tags: Readonly<Record<string, string>>): string | undefined {
  const street = tags['addr:street'];
  const num = tags['addr:housenumber'];
  const line1 = [num, street].filter(Boolean).join(' ').trim();
  const city = tags['addr:city'] ?? tags['addr:place'] ?? '';
  const parts = [line1, city].filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  return parts.join(', ');
}

function normalizeOsmNode(node: OverpassOsmNode): Poi | null {
  if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon)) {
    return null;
  }

  const tags = node.tags ?? {};
  if (Object.keys(tags).length === 0) {
    return null;
  }
  if (!hasPoiClassifier(tags)) {
    return null;
  }

  const category = osmTagsToCategory(tags);
  const address = formatAddress(tags);

  return {
    id: `osm-n-${node.id}`,
    name: displayName(tags),
    category,
    subcategory: deriveSubcategory(tags),
    latitude: node.lat,
    longitude: node.lon,
    ...(address !== undefined ? { address } : {}),
    source: 'osm',
    osm_tags: { ...tags },
  };
}

/**
 * Normalize a full Overpass document to POIs. Bounding box filtering uses `operationalBounds`.
 */
export function normalizeKyauktanOsmDocument(
  doc: OverpassDocument,
  operationalBounds: LngLatBounds,
): readonly Poi[] {
  const nodes = parseKyauktanOverpassNodes(doc, operationalBounds);
  const out: Poi[] = [];
  for (const node of nodes) {
    const poi = normalizeOsmNode(node);
    if (poi !== null) {
      out.push(poi);
    }
  }
  return cleanupKyauktanPois(out);
}

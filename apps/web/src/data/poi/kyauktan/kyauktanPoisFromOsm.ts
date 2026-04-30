/**
 * Kyauktan POIs for the UI — generated local data only.
 *
 * Manual refresh: `npm run pois:refresh` (Overpass → raw JSON → this processed file).
 * Do not fetch Overpass from the app.
 */
import type { Poi } from '@/types';
import { cleanupKyauktanPois } from './cleanupKyauktanPois';
import kyauktanPoisProcessed from './processed/kyauktan-pois.json';

function isOsmTagsRecord(v: unknown): v is Readonly<Record<string, string>> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === 'string');
}

function isPoiRecord(v: unknown): v is Poi {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.category === 'string' &&
    typeof o.subcategory === 'string' &&
    typeof o.latitude === 'number' &&
    typeof o.longitude === 'number' &&
    o.source === 'osm' &&
    isOsmTagsRecord(o.osm_tags)
  );
}

function asPoiList(data: unknown): readonly Poi[] {
  if (!Array.isArray(data)) return [];
  return data.filter(isPoiRecord);
}

export const KYAUKTAN_POIS_FROM_OSM: readonly Poi[] = cleanupKyauktanPois(
  asPoiList(kyauktanPoisProcessed),
);

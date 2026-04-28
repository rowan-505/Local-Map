/**
 * Minimal, conservative cleanup after OSM → `Poi` normalization.
 * Does not rewrite tags, categories, or subcategories — only drops or dedupes whole rows.
 */
import type { Poi } from '../../../types';

/**
 * Must match the final fallback string in `normalizeKyauktanOsm.ts` `displayName`.
 * Entries stuck on this label are not useful for place browsing.
 */
const OSM_UNNAMED_DISPLAY = 'Unnamed place';

/** Lowercased names treated as non-browsing placeholders (expand sparingly). */
const NON_BROWSING_NAMES = new Set<string>([
  OSM_UNNAMED_DISPLAY.toLowerCase(),
  'unknown',
  'n/a',
]);

const COORD_DECIMALS = 5;

function quantizeCoord(value: number): number {
  const f = 10 ** COORD_DECIMALS;
  return Math.round(value * f) / f;
}

function dedupeKey(p: Poi): string {
  const nameKey = p.name.trim().toLowerCase();
  const qlat = quantizeCoord(p.latitude);
  const qlon = quantizeCoord(p.longitude);
  return `${qlat}|${qlon}|${nameKey}`;
}

/**
 * 1. Drop non-finite coordinates.
 * 2. Drop empty display names and generic / unnamed placeholders.
 * 3. Drop later rows that duplicate an earlier row on (quantized lat, quantized lon, same name).
 */
export function cleanupKyauktanPois(pois: readonly Poi[]): readonly Poi[] {
  const kept: Poi[] = [];
  const seen = new Set<string>();

  for (const p of pois) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) {
      continue;
    }

    const trimmedName = p.name.trim();
    if (trimmedName.length === 0) {
      continue;
    }

    const lower = trimmedName.toLowerCase();
    if (NON_BROWSING_NAMES.has(lower)) {
      continue;
    }

    const key = dedupeKey({ ...p, name: trimmedName });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    kept.push(trimmedName === p.name ? p : { ...p, name: trimmedName });
  }

  return kept;
}

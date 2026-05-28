import type { PlaceLanguageMode, PublicSearchResult } from '@/features/poi/api/publicMapApi';
import { getLocalizedName } from '@local-map/localized-name';

import { resolveSearchResultCoordinates } from '../routeState';

export function searchResultDisplayName(
  result: PublicSearchResult,
  languageMode: PlaceLanguageMode,
): string {
  return (
    getLocalizedName(
      {
        myanmar_name: result.name_mm ?? result.myanmar_name,
        english_name: result.name_en ?? result.english_name,
        display_name: result.display_name,
        primary_name: result.primary_name,
        canonical_name: result.canonical_name,
      },
      languageMode,
    ) ||
    result.subtitle ||
    result.type
  );
}

export function searchResultTypeLabel(type: PublicSearchResult['type']): string {
  switch (type) {
    case 'street':
      return 'Street';
    case 'admin_area':
      return 'Area';
    case 'place':
    default:
      return 'Place';
  }
}

export function searchResultAreaLine(result: PublicSearchResult): string | null {
  const subtitle = result.subtitle?.trim();
  if (subtitle) return subtitle;
  if (result.categoryName) return result.categoryName;
  if (result.categoryCode) return result.categoryCode;
  return null;
}

export function searchResultCategoryLine(result: PublicSearchResult): string | null {
  if (result.categoryName) return result.categoryName;
  if (result.categoryCode) return result.categoryCode;
  return searchResultTypeLabel(result.type);
}

/** Client-side distance when API does not return one. */
export function formatSearchResultDistance(
  result: PublicSearchResult,
  reference: readonly [number, number] | null,
): string | null {
  if (!reference) return null;
  const coords = resolveSearchResultCoordinates(result);
  if (!coords) return null;
  const meters = haversineMeters(reference[1], reference[0], coords[1], coords[0]);
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km away`;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

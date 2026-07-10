import type { PublicSearchParams } from './publicMapApi';

export type SearchCenter = Pick<PublicSearchParams, 'lat' | 'lng'>;

export function formatPublicSearchGeoKey(
  center: SearchCenter | null | undefined,
): string | null {
  if (!center) return null;
  const { lat, lng } = center;
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return `${round(lat)},${round(lng)}`;
}

export function publicSearchGeoBiasFromKey(geoKey: string | null): SearchCenter | null {
  if (!geoKey) return null;
  const [latRaw, lngRaw] = geoKey.split(',');
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

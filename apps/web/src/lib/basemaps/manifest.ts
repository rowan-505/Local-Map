/**
 * Production web basemap manifest loader.
 * Source file: `apps/web/public/basemaps/manifest.json` (or `VITE_BASEMAP_MANIFEST_URL`).
 * Minimal runtime validation only — no external schema library.
 */
import type { BBox } from './bbox';

export interface BasemapPackage {
  id: string;
  version: string;
  url: string;
  bounds: BBox;
  minZoom: number;
  maxZoom: number;
}

export interface BasemapManifest {
  overview: BasemapPackage;
  regions: BasemapPackage[];
}

const DEFAULT_MANIFEST_URL = '/basemaps/manifest.json';

function getManifestUrl(): string {
  const configured = import.meta.env.VITE_BASEMAP_MANIFEST_URL;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.trim();
  }
  return DEFAULT_MANIFEST_URL;
}

function isBBox(value: unknown): value is BBox {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function assertPackageShape(value: unknown, label: string): asserts value is BasemapPackage {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Basemap manifest: ${label} must be an object`);
  }
  const pkg = value as Record<string, unknown>;
  if (typeof pkg.id !== 'string' || pkg.id.trim() === '') {
    throw new Error(`Basemap manifest: ${label} is missing a valid "id"`);
  }
  if (typeof pkg.url !== 'string' || pkg.url.trim() === '') {
    throw new Error(`Basemap manifest: ${label} is missing a valid "url"`);
  }
  if (!isBBox(pkg.bounds)) {
    throw new Error(`Basemap manifest: ${label} is missing valid "bounds" [minLng, minLat, maxLng, maxLat]`);
  }
}

/** Fetches and minimally validates the basemap manifest. */
export async function loadBasemapManifest(signal?: AbortSignal): Promise<BasemapManifest> {
  const url = getManifestUrl();
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Basemap manifest fetch failed: ${res.status} ${res.statusText} (${url})`);
  }

  const data = (await res.json()) as unknown;
  if (typeof data !== 'object' || data === null) {
    throw new Error('Basemap manifest: root must be an object');
  }

  const manifest = data as Record<string, unknown>;
  assertPackageShape(manifest.overview, 'overview');

  if (!Array.isArray(manifest.regions)) {
    throw new Error('Basemap manifest: "regions" must be an array');
  }
  manifest.regions.forEach((region, i) => assertPackageShape(region, `regions[${i}]`));

  return data as BasemapManifest;
}

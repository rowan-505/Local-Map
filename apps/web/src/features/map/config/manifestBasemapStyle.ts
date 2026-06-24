/**
 * Manifest-driven web basemap style (step 1: overview PMTiles only).
 *
 * Loads `apps/web/public/basemaps/manifest.json` (or `VITE_BASEMAP_MANIFEST_URL`) and builds an
 * overview-only MapLibre style using the existing overview source/layer definitions.
 * Regional dynamic loading is intentionally NOT wired here yet.
 */
import type { StyleSpecification } from 'maplibre-gl';
import { loadBasemapManifest } from '@/lib/basemaps/manifest';
import { createOverviewBasemapStyle } from '../lib/maplibre/overviewBasemap';

/**
 * Overview-only style from the production manifest.
 * Reuses {@link createOverviewBasemapStyle}, which builds the overview vector source as
 * `{ type: 'vector', url: 'pmtiles://' + manifest.overview.url, ... }` and the existing overview layers.
 */
export async function getOverviewWebMapStyleFromManifest(): Promise<StyleSpecification> {
  const manifest = await loadBasemapManifest();
  const style = createOverviewBasemapStyle(manifest.overview.url);

  if (import.meta.env.DEV) {
    console.info('Loaded overview PMTiles');
  }

  return style;
}

/**
 * Basemap style entrypoint — local MapLibre Style Spec JSON in `public/styles/` (vector PMTiles + `dynamic` placeholder in that file).
 */

/** Path under `public/` served at site root (Vite). */
export const BASEMAP_STYLE_PUBLIC_FILENAME = 'styles/base-light.json' as const;

/** URL passed to `maplibregl.Map({ style })`. */
export function getActiveBasemapStyleUrl(): string {
  return `${import.meta.env.BASE_URL}${BASEMAP_STYLE_PUBLIC_FILENAME}`;
}

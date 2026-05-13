import { DEFAULT_BASEMAP_CURRENT_JSON_URL } from '@local-map/map-style/basemapSource';

/** `current.json` URL for web basemap (Vite replaces `import.meta.env` at build time). */
export function getWebBasemapCurrentJsonUrl(): string {
  const v = import.meta.env.VITE_BASEMAP_CURRENT_JSON_URL;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : DEFAULT_BASEMAP_CURRENT_JSON_URL;
}

/// <reference types="vite/client" />

import type { Map, StyleSpecification } from 'maplibre-gl';

declare global {
  interface Window {
    __MAP__?: Map;
    __MAP_STYLE__?: Map['getStyle'];
    __MAP_SOURCES__?: () => StyleSpecification['sources'];
    __MAP_LAYERS__?: () => StyleSpecification['layers'];
  }
}

/* eslint-disable @typescript-eslint/no-unused-vars -- module augmentation for Vite `import.meta.env` */
interface ImportMetaEnv {
  /** Optional origin + base path if you self-host multiscript `.pbf` ranges (otherwise the default GitHub Pages mirror is used). */
  readonly VITE_MULTISCRIPT_GLYPH_BASE_URL?: string;
  /** Optional `current.json` URL (defaults to Yangon on `localhost:8080`). */
  readonly VITE_BASEMAP_CURRENT_JSON_URL?: string;
  /** Optional direct `.pmtiles` HTTP(S) URL — when set, skips fetching `current.json`. */
  readonly VITE_BASEMAP_PMTILES_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};

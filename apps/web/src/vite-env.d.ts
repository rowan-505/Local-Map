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

interface ImportMetaEnv {
  /** Optional origin + base path if you self-host multiscript `.pbf` ranges (otherwise the default GitHub Pages mirror is used). */
  readonly VITE_MULTISCRIPT_GLYPH_BASE_URL?: string;
}

export {};

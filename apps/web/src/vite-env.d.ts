/// <reference types="vite/client" />

import type { Map, StyleSpecification } from 'maplibre-gl';

declare global {
  interface Window {
    __MAP__?: Map;
    __MAP_STYLE__?: Map['getStyle'];
    __MAP_SOURCES__?: () => StyleSpecification['sources'];
    __MAP_LAYERS__?: () => StyleSpecification['layers'];
    __MAP_DEBUG_BASEMAP__?: () => void;
  }
}

/* eslint-disable @typescript-eslint/no-unused-vars -- module augmentation for Vite `import.meta.env` */
interface ImportMetaEnv {
  /** Fastify API origin (e.g. `http://localhost:3001`). Required for map data and routing clients. */
  readonly VITE_API_BASE_URL: string;
  /** Optional origin + base path if you self-host multiscript `.pbf` ranges (otherwise the default GitHub Pages mirror is used). */
  readonly VITE_MULTISCRIPT_GLYPH_BASE_URL?: string;
  /** Optional `current.json` URL (defaults to Yangon on `localhost:8080`). */
  readonly VITE_BASEMAP_CURRENT_JSON_URL?: string;
  /** Optional direct `.pmtiles` HTTP(S) URL — when set, skips fetching `current.json`. */
  readonly VITE_BASEMAP_PMTILES_URL?: string;
  /**
   * Basemap mode: `overview` loads overview PMTiles style (see docs/tiles/pmtiles/overview-local-dev.md).
   * Unset or any other value keeps the regional Yangon basemap.
   */
  readonly VITE_MAP_BASEMAP?: string;
  /**
   * Overview `.pmtiles` HTTP(S) URL (required in production for overview basemap).
   * Example: https://YOUR_TILE_DOMAIN/basemaps/overview/v1/basemap.pmtiles
   */
  readonly VITE_OVERVIEW_PMTILES_URL?: string;
  /** Optional satellite raster tile template override (defaults to Esri World Imagery). Do not include private keys. */
  readonly VITE_SATELLITE_RASTER_TILES_URL?: string;
  /** Optional satellite raster tile size. Defaults to 256. */
  readonly VITE_SATELLITE_RASTER_TILE_SIZE?: string;
  /** Optional attribution text for configured satellite raster tiles. */
  readonly VITE_SATELLITE_RASTER_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};

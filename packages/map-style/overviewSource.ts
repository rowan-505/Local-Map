import OverviewMapStyle from './overview-map.json';
import {
  DEFAULT_OVERVIEW_CURRENT_JSON_URL,
  OVERVIEW_MAX_ZOOM,
  OVERVIEW_VECTOR_SOURCE_ID,
} from './overviewConstants';
import {
  fetchActiveBasemapPmtilesHttpUrl,
  fetchBasemapCurrentJson,
  type BasemapCurrentJson,
} from './basemapSource';

export {
  DEFAULT_OVERVIEW_CURRENT_JSON_URL,
  OVERVIEW_MAX_ZOOM,
  OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER,
  OVERVIEW_PMTILES_URL_PLACEHOLDER,
  OVERVIEW_VECTOR_SOURCE_ID,
} from './overviewConstants';
export {
  OVERVIEW_COUNTRY_LABEL_FILTER,
  OVERVIEW_FORBIDDEN_SOURCE_LAYERS,
  OVERVIEW_LAKES_FILTER,
  OVERVIEW_MAJOR_CITY_FILTER,
  OVERVIEW_PMTILES_SOURCE_LAYERS,
  OVERVIEW_RIVERS_FILTER,
  type OverviewPmtilesSourceLayer,
} from './overviewConstants';
export type { BasemapCurrentJson as OverviewCurrentJson };

type OverviewMapStyleJson = typeof OverviewMapStyle;

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneOverviewJson(style: OverviewMapStyleJson): OverviewMapStyleJson {
  if (typeof structuredClone === 'function') {
    return structuredClone(style) as OverviewMapStyleJson;
  }
  return JSON.parse(JSON.stringify(style)) as OverviewMapStyleJson;
}

function toPmtilesSchemeUrl(httpUrl: string): string {
  const u = trimOrEmpty(httpUrl);
  if (!u) {
    throw new Error('Empty overview PMTiles URL');
  }
  return u.startsWith('pmtiles://') ? u : `pmtiles://${u}`;
}

/** MapLibre vector source for the overview `.pmtiles` archive (z0–z8). */
export function createOverviewVectorSource(pmtilesHttpUrl: string): {
  type: 'vector';
  url: string;
  minzoom: number;
  maxzoom: number;
} {
  return {
    type: 'vector',
    url: toPmtilesSchemeUrl(pmtilesHttpUrl),
    minzoom: 0,
    maxzoom: OVERVIEW_MAX_ZOOM,
  };
}

/**
 * Full overview MapLibre style with the `overview` vector source at `pmtilesHttpUrl`.
 * Clones committed `overview-map.json` (placeholder URL) and replaces the source at runtime.
 * Rendering only — no OSM roads, buildings, or transit. Intended for z0–z8.
 */
export function createOverviewStyle(pmtilesHttpUrl: string): OverviewMapStyleJson {
  const style = cloneOverviewJson(OverviewMapStyle);
  style.sources = {
    [OVERVIEW_VECTOR_SOURCE_ID]: createOverviewVectorSource(pmtilesHttpUrl),
  } as OverviewMapStyleJson['sources'];
  return style;
}

export async function fetchOverviewCurrentJson(
  currentJsonUrl: string,
  init?: RequestInit,
): Promise<BasemapCurrentJson> {
  return fetchBasemapCurrentJson(currentJsonUrl, init);
}

/** Reads overview `current.json` and returns the active `.pmtiles` HTTP(S) URL. */
export async function fetchActiveOverviewPmtilesHttpUrl(args: {
  currentJsonUrl?: string;
  signal?: AbortSignal;
}): Promise<string> {
  return fetchActiveBasemapPmtilesHttpUrl({
    currentJsonUrl: args.currentJsonUrl ?? DEFAULT_OVERVIEW_CURRENT_JSON_URL,
    signal: args.signal,
  });
}

/**
 * Resolves overview PMTiles URL then builds the style.
 * Pass the result to `maplibregl.Map({ style })` after `ensurePmtilesProtocol`.
 */
export async function getActiveOverviewStyle(args?: {
  currentJsonUrl?: string;
  pmtilesHttpUrlOverride?: string;
  signal?: AbortSignal;
}): Promise<OverviewMapStyleJson> {
  const httpUrl =
    trimOrEmpty(args?.pmtilesHttpUrlOverride) ||
    (await fetchActiveOverviewPmtilesHttpUrl({
      currentJsonUrl: args?.currentJsonUrl,
      signal: args?.signal,
    }));
  return createOverviewStyle(httpUrl);
}

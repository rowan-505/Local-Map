import BaseMapStyle from './base-map.json';

export const DEFAULT_BASEMAP_CURRENT_JSON_URL =
  'http://localhost:8080/regions/yangon/current.json';

/** MapLibre vector source id in `base-map.json` / {@link createBasemapStyle}. */
export const BASEMAP_VECTOR_SOURCE_ID = 'local-basemap' as const;

export type BasemapCurrentJson = {
  region: string;
  version: string;
  filename: string;
  /** Absolute HTTP(S) URL of the active `.pmtiles` file. */
  url: string;
};

type BaseMapStyleJson = typeof BaseMapStyle;

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneBasemapJson(style: BaseMapStyleJson): BaseMapStyleJson {
  if (typeof structuredClone === 'function') {
    return structuredClone(style) as BaseMapStyleJson;
  }
  return JSON.parse(JSON.stringify(style)) as BaseMapStyleJson;
}

function toPmtilesSchemeUrl(httpUrl: string): string {
  const u = trimOrEmpty(httpUrl);
  if (!u) {
    throw new Error('Empty basemap PMTiles URL');
  }
  return u.startsWith('pmtiles://') ? u : `pmtiles://${u}`;
}

/** MapLibre vector source spec for a regional `.pmtiles` file (HTTP URL → `pmtiles://` URL). */
export function createBasemapVectorSource(pmtilesHttpUrl: string): {
  type: 'vector';
  url: string;
  minzoom: number;
  maxzoom: number;
} {
  return {
    type: 'vector',
    url: toPmtilesSchemeUrl(pmtilesHttpUrl),
    minzoom: 0,
    maxzoom: 22,
  };
}

/**
 * Full basemap style from `base-map.json` with the PMTiles vector source at `pmtilesHttpUrl`.
 * Callers should cast to `StyleSpecification` when passing to MapLibre.
 */
export function createBasemapStyle(pmtilesHttpUrl: string): BaseMapStyleJson {
  const style = cloneBasemapJson(BaseMapStyle);
  style.sources = {
    [BASEMAP_VECTOR_SOURCE_ID]: createBasemapVectorSource(pmtilesHttpUrl),
  } as BaseMapStyleJson['sources'];
  return style;
}

export async function fetchBasemapCurrentJson(
  currentJsonUrl: string,
  init?: RequestInit,
): Promise<BasemapCurrentJson> {
  const res = await fetch(currentJsonUrl, {
    ...init,
    cache: init?.cache ?? 'no-store',
  });
  if (!res.ok) {
    throw new Error(
      `Basemap current.json failed: ${res.status} ${res.statusText} (${currentJsonUrl})`,
    );
  }
  return (await res.json()) as BasemapCurrentJson;
}

/** Reads `current.json` and returns the active `.pmtiles` HTTP(S) URL (`url` field). */
export async function fetchActiveBasemapPmtilesHttpUrl(args: {
  currentJsonUrl: string;
  signal?: AbortSignal;
}): Promise<string> {
  const doc = await fetchBasemapCurrentJson(args.currentJsonUrl, {
    signal: args.signal,
  });
  const url = trimOrEmpty(doc.url);
  if (!url) {
    throw new Error('Basemap current.json: missing non-empty `url`');
  }
  return url;
}

/** MapLibre vector source `url` for PMTiles (adds `pmtiles://` when absent). */
export function toPmtilesVectorSourceUrl(httpUrl: string): string {
  return toPmtilesSchemeUrl(httpUrl);
}

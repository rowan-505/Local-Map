/**
 * Martin vector-tile sources for the transport overlay (sources only — no layers yet).
 * Tiles are served by Martin at `VITE_MARTIN_TILE_URL` (see `config/martinTileUrl.ts`);
 * this module never calls the Fastify API and never touches the PMTiles basemap.
 */
import type { VectorSourceSpecification } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';

/** Safe zoom envelope for the Martin transport tiles. */
export const TRANSPORT_SOURCE_MIN_ZOOM = 0;
export const TRANSPORT_SOURCE_MAX_ZOOM = 14;

/**
 * MapLibre source id → Martin tile endpoint / source-layer name.
 * The Martin endpoint path and the source-layer name are identical per Martin's catalog.
 */
export const TRANSPORT_SOURCES = [
  {
    sourceId: 'transport-infrastructure-lines-source',
    sourceLayer: 'transport_infrastructure_lines_v',
  },
  {
    sourceId: 'transport-route-paths-source',
    sourceLayer: 'transport_route_paths_v',
  },
  {
    sourceId: 'transport-terminals-source',
    sourceLayer: 'transport_terminals_v',
  },
  {
    sourceId: 'transport-stops-source',
    sourceLayer: 'transport_stops_v',
  },
] as const;

export type TransportSourceId = (typeof TRANSPORT_SOURCES)[number]['sourceId'];

export const TRANSPORT_SOURCE_IDS = TRANSPORT_SOURCES.map((entry) => entry.sourceId);

const TRANSPORT_SOURCE_ID_SET = new Set<string>(TRANSPORT_SOURCE_IDS);

function buildTransportVectorSource(
  martinTileUrl: string,
  sourceLayer: string,
): VectorSourceSpecification {
  const base = martinTileUrl.replace(/\/+$/, '');
  return {
    type: 'vector',
    tiles: [`${base}/${sourceLayer}/{z}/{x}/{y}`],
    minzoom: TRANSPORT_SOURCE_MIN_ZOOM,
    maxzoom: TRANSPORT_SOURCE_MAX_ZOOM,
  };
}

/**
 * Registers the four Martin transport vector sources on the map.
 * Idempotent: existing sources (after a style reload or component re-render) are left untouched,
 * so it is safe to call from every `load` handler.
 *
 * Adds sources only — no layers are created here.
 */
export function addTransportSources(map: MapEngine, martinTileUrl: string): void {
  const trimmed = martinTileUrl.trim();
  if (trimmed === '') return;

  for (const { sourceId, sourceLayer } of TRANSPORT_SOURCES) {
    if (map.getSource(sourceId)) continue;
    map.addSource(sourceId, buildTransportVectorSource(trimmed, sourceLayer));
  }
}

/**
 * Dev-only: logs MapLibre tile errors that belong to the Martin transport sources.
 * Ignores unrelated PMTiles/glyph/basemap errors so the console stays quiet.
 * No-op in production (returns a noop unsubscribe) — keeps production behavior unchanged.
 *
 * Returns an unsubscribe function.
 */
export function bindTransportTileErrorHandler(map: MapEngine): () => void {
  if (!import.meta.env.DEV) {
    return () => {};
  }

  const handler = (event: { sourceId?: string; error?: Error & { url?: string } }) => {
    if (!event.sourceId || !TRANSPORT_SOURCE_ID_SET.has(event.sourceId)) return;
    const tileUrl = event.error?.url;
    console.warn(
      `[map][transport] tile error — source: ${event.sourceId}` +
        (tileUrl ? `, url: ${tileUrl}` : '') +
        `, error: ${event.error?.message ?? 'unknown error'}`,
    );
  };

  map.on('error', handler);
  return () => {
    map.off('error', handler);
  };
}

/**
 * Martin vector-tile sources for the transport overlay (sources only — no layers yet).
 * Tiles are served by Martin at `VITE_MARTIN_TILE_URL` (see `config/martinTileUrl.ts`);
 * this module never calls the Fastify API and never touches the PMTiles basemap.
 */
import type { VectorSourceSpecification } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';
import { PUBLIC_MAP_MAX_ZOOM } from '../../config/publicMapViewport';

/** Safe zoom envelope for the Martin transport tiles. */
export const TRANSPORT_SOURCE_MIN_ZOOM = 0;
/**
 * Tile request ceiling for all Martin transport sources.
 * Must be >= the public map camera max zoom ({@link PUBLIC_MAP_MAX_ZOOM} is 20) and match
 * Martin transport table `maxzoom` in `infrastructure/tiles/martin/config.yaml` (22).
 * When Martin serves only ~z14 tiles but this value is higher, MapLibre requests native z15+
 * tiles that do not exist and dense bus-stop points disappear when zooming in.
 */
export const TRANSPORT_SOURCE_MAX_ZOOM = 22;

/** Martin TileJSON must expose at least this maxzoom for street-level stop density. */
export const TRANSPORT_MARTIN_MIN_TILEJSON_MAX_ZOOM = PUBLIC_MAP_MAX_ZOOM;

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

function readVectorSourceMaxZoom(map: MapEngine, sourceId: string): number | undefined {
  const source = map.getSource(sourceId);
  if (!source || source.type !== 'vector') return undefined;
  const maxzoom = (source as { maxzoom?: number }).maxzoom;
  return typeof maxzoom === 'number' ? maxzoom : undefined;
}

/** Dev-only: warn when Martin TileJSON maxzoom is below street-level map zoom. */
function warnIfMartinTransportTileJsonMaxZoomTooLow(martinTileUrl: string): void {
  if (!import.meta.env.DEV) return;

  const base = martinTileUrl.replace(/\/+$/, '');
  void fetch(`${base}/transport_stops_v`)
    .then((response) => (response.ok ? response.json() : null))
    .then((tileJson: { maxzoom?: number } | null) => {
      if (!tileJson || typeof tileJson.maxzoom !== 'number') return;
      if (tileJson.maxzoom >= TRANSPORT_MARTIN_MIN_TILEJSON_MAX_ZOOM) return;
      console.warn(
        `[map][transport] Martin transport_stops_v maxzoom=${tileJson.maxzoom} is below ` +
          `street zoom (${TRANSPORT_MARTIN_MIN_TILEJSON_MAX_ZOOM}). Bus stops may disappear above ` +
          `z${tileJson.maxzoom}. Set maxzoom: ${TRANSPORT_SOURCE_MAX_ZOOM} on transport tables in ` +
          'infrastructure/tiles/martin/config.yaml and redeploy Martin.',
      );
    })
    .catch(() => {
      // Martin may be offline in dev — overlay is optional.
    });
}

function sourceHasDependentLayers(map: MapEngine, sourceId: string): boolean {
  const layers = map.getStyle()?.layers ?? [];
  return layers.some((layer) => 'source' in layer && layer.source === sourceId);
}

/**
 * Registers the four Martin transport vector sources on the map.
 * Idempotent: existing sources with the correct maxzoom are left untouched.
 * Stale sources (wrong maxzoom, no dependent layers yet) are removed and re-registered.
 *
 * Adds sources only — no layers are created here.
 */
export function addTransportSources(map: MapEngine, martinTileUrl: string): void {
  const trimmed = martinTileUrl.trim();
  if (trimmed === '') return;

  let addedAny = false;

  for (const { sourceId, sourceLayer } of TRANSPORT_SOURCES) {
    const existingMaxZoom = readVectorSourceMaxZoom(map, sourceId);
    if (existingMaxZoom !== undefined && existingMaxZoom !== TRANSPORT_SOURCE_MAX_ZOOM) {
      if (sourceHasDependentLayers(map, sourceId)) {
        if (import.meta.env.DEV) {
          console.warn(
            `[map][transport] ${sourceId} maxzoom=${existingMaxZoom} is stale; reload the page ` +
              `after redeploying Martin with maxzoom ${TRANSPORT_SOURCE_MAX_ZOOM}.`,
          );
        }
        continue;
      }
      map.removeSource(sourceId);
    } else if (map.getSource(sourceId)) {
      continue;
    }

    map.addSource(sourceId, buildTransportVectorSource(trimmed, sourceLayer));
    addedAny = true;
  }

  if (addedAny) {
    warnIfMartinTransportTileJsonMaxZoomTooLow(trimmed);
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

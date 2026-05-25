import type { LayerSpecification } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';

const BASEMAP_SOURCE_ID = 'local-basemap';
const ADMIN_AREA_LABEL_POINTS_LAYER_ID = 'admin-area-label-points';
const ADMIN_SOURCE_LAYERS = [
  'admin_area_label_points',
  'admin_areas',
  'village_labels',
] as const;

type DebuggableLayer = LayerSpecification & {
  readonly source?: string;
  readonly 'source-layer'?: string;
  readonly minzoom?: number;
  readonly maxzoom?: number;
  readonly layout?: {
    readonly visibility?: string;
    readonly 'text-field'?: unknown;
  };
  readonly filter?: unknown;
};

export function logAdminLabelLayersInDev(map: MapEngine): void {
  if (!isAdminLabelDebugEnabled()) return;

  const layers = map.getStyle().layers ?? [];
  const rows = layers
    .map((layer, index) => ({ index, layer: layer as DebuggableLayer }))
    .filter(({ layer }) => isAdminLabelLayer(layer))
    .map(({ index, layer }) => ({
      index,
      id: layer.id,
      source: layer.source ?? '',
      sourceLayer: layer['source-layer'] ?? '',
      minzoom: layer.minzoom ?? '',
      maxzoom: layer.maxzoom ?? '',
      textField: serializeDebugValue(layer.layout?.['text-field']),
      filter: serializeDebugValue(layer.filter),
      visibility: layer.layout?.visibility ?? 'visible',
    }));

  console.groupCollapsed('[map] admin/admin-area label layers');
  console.table(rows);
  console.groupEnd();
}

export function logAdminSourceFeaturesInDev(map: MapEngine): void {
  if (!isAdminLabelDebugEnabled()) return;

  const logSourceFeatures = () => {
    const rows = ADMIN_SOURCE_LAYERS.map((sourceLayer) => {
      const features = queryAdminSourceFeatures(map, sourceLayer);
      return {
        source: BASEMAP_SOURCE_ID,
        sourceLayer,
        count: features.length,
        sampleProperties: serializeDebugValue(
          features.slice(0, 3).map((feature) => feature.properties ?? {}),
        ),
      };
    });

    const pointLayer = rows.find((row) => row.sourceLayer === 'admin_area_label_points');
    if (pointLayer?.count === 0 && map.getLayer(ADMIN_AREA_LABEL_POINTS_LAYER_ID)) {
      map.setLayoutProperty(ADMIN_AREA_LABEL_POINTS_LAYER_ID, 'visibility', 'none');
      console.info(
        '[map] Disabled admin-area-label-points: current PMTiles returned 0 features for source-layer admin_area_label_points',
      );
    }

    console.groupCollapsed('[map] admin source-layer feature samples');
    console.table(rows);
    console.groupEnd();
  };

  map.once('idle', logSourceFeatures);
}

function isAdminLabelLayer(layer: DebuggableLayer): boolean {
  if (layer.type !== 'symbol') return false;

  const haystack = [
    layer.id,
    layer.source ?? '',
    layer['source-layer'] ?? '',
  ].join(' ').toLowerCase();

  return (
    haystack.includes('admin') ||
    haystack.includes('village') ||
    haystack.includes('neighborhood')
  );
}

function queryAdminSourceFeatures(
  map: MapEngine,
  sourceLayer: (typeof ADMIN_SOURCE_LAYERS)[number],
): readonly { readonly properties?: unknown }[] {
  try {
    return map.querySourceFeatures(BASEMAP_SOURCE_ID, { sourceLayer });
  } catch (error) {
    console.warn(`[map] Could not query ${BASEMAP_SOURCE_ID}/${sourceLayer}`, error);
    return [];
  }
}

function serializeDebugValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function isAdminLabelDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (!import.meta.env.PROD) return true;
  if (typeof window === 'undefined') return false;

  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

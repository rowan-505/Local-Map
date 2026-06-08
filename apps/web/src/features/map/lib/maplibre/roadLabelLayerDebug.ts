import type { LayerSpecification } from 'maplibre-gl';
import { BASEMAP_VECTOR_SOURCE_ID } from '@local-map/map-style/basemapSource';
import { ROAD_LABEL_LAYER_IDS } from './roadLabelTextFields';
import type { MapEngine } from '../mapEngineTypes';

const ROAD_LABELS_SOURCE_LAYER = 'road_labels';

type DebuggableLayer = LayerSpecification & {
  readonly source?: string;
  readonly 'source-layer'?: string;
  readonly minzoom?: number;
  readonly maxzoom?: number;
  readonly layout?: {
    readonly visibility?: string;
    readonly 'symbol-placement'?: string;
    readonly 'text-field'?: unknown;
    readonly 'text-allow-overlap'?: boolean;
    readonly 'text-ignore-placement'?: boolean;
  };
  readonly filter?: unknown;
};

const ROAD_LABEL_LAYER_ID_SET = new Set<string>(ROAD_LABEL_LAYER_IDS);

export function logRoadLabelLayersInDev(map: MapEngine): void {
  if (!isRoadLabelDebugEnabled()) return;

  const layers = map.getStyle().layers ?? [];
  const rows = layers
    .map((layer, index) => ({ index, layer: layer as DebuggableLayer }))
    .filter(({ layer }) => isRoadLabelStyleLayer(layer))
    .map(({ index, layer }) => ({
      index,
      id: layer.id,
      source: layer.source ?? '',
      sourceLayer: layer['source-layer'] ?? '',
      minzoom: layer.minzoom ?? '',
      maxzoom: layer.maxzoom ?? '',
      symbolPlacement: layer.layout?.['symbol-placement'] ?? '',
      textField: serializeDebugValue(layer.layout?.['text-field']),
      textAllowOverlap: layer.layout?.['text-allow-overlap'] ?? '',
      textIgnorePlacement: layer.layout?.['text-ignore-placement'] ?? '',
      filter: serializeDebugValue(layer.filter),
      visibility: layer.layout?.visibility ?? 'visible',
    }));

  console.groupCollapsed('[map] road label layers (PMTiles road_labels only)');
  console.table(rows);

  const wrongSourceLayer = rows.filter((row) => row.sourceLayer !== ROAD_LABELS_SOURCE_LAYER);
  if (wrongSourceLayer.length > 0) {
    console.warn(
      '[map] road label layers must use source-layer "road_labels", not "streets":',
      wrongSourceLayer.map((row) => row.id),
    );
  }

  const wrongSource = rows.filter((row) => row.source !== BASEMAP_VECTOR_SOURCE_ID);
  if (wrongSource.length > 0) {
    console.warn(
      `[map] road label layers must use source "${BASEMAP_VECTOR_SOURCE_ID}":`,
      wrongSource.map((row) => row.id),
    );
  }

  console.groupEnd();
}

export function logRoadLabelSourceFeaturesInDev(map: MapEngine): void {
  if (!isRoadLabelDebugEnabled()) return;

  const logSourceFeatures = () => {
    const features = queryRoadLabelSourceFeatures(map);
    const classCounts = new Map<string, number>();
    for (const feature of features) {
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      const code = String(props.road_class_code ?? props.road_class ?? 'unknown').toLowerCase();
      classCounts.set(code, (classCounts.get(code) ?? 0) + 1);
    }

    console.groupCollapsed('[map] road_labels source-layer feature sample');
    console.table([
      {
        source: BASEMAP_VECTOR_SOURCE_ID,
        sourceLayer: ROAD_LABELS_SOURCE_LAYER,
        count: features.length,
        roadClassHistogram: serializeDebugValue(Object.fromEntries(classCounts)),
        sampleProperties: serializeDebugValue(
          features.slice(0, 3).map((feature) => feature.properties ?? {}),
        ),
      },
    ]);
    console.groupEnd();
  };

  map.once('idle', logSourceFeatures);
}

function isRoadLabelStyleLayer(layer: DebuggableLayer): boolean {
  if (layer.type !== 'symbol') return false;
  if (ROAD_LABEL_LAYER_ID_SET.has(layer.id)) return true;
  return layer['source-layer'] === ROAD_LABELS_SOURCE_LAYER;
}

function queryRoadLabelSourceFeatures(
  map: MapEngine,
): readonly { readonly properties?: unknown }[] {
  try {
    return map.querySourceFeatures(BASEMAP_VECTOR_SOURCE_ID, {
      sourceLayer: ROAD_LABELS_SOURCE_LAYER,
    });
  } catch (error) {
    console.warn(
      `[map] Could not query ${BASEMAP_VECTOR_SOURCE_ID}/${ROAD_LABELS_SOURCE_LAYER}`,
      error,
    );
    return [];
  }
}

function serializeDebugValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function isRoadLabelDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  if (!import.meta.env.PROD) return true;
  if (typeof window === 'undefined') return false;

  const { hostname } = window.location;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/**
 * Local-only QA mode: load every regional PMTiles archive from localhost:8080 at once.
 * Not for production — no viewport loading, no R2, no API tile registry.
 */
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';
import {
  BASEMAP_VECTOR_SOURCE_ID,
  createBasemapVectorSource,
} from '../../../../../../../packages/map-style/basemapSource.js';
import {
  BASEMAP_ZOOM_VISIBILITY_RULES,
  patchOverviewLayersForProgressiveDetail,
  patchRegionalLayersForProgressiveDetail,
} from './basemapZoomVisibility';
import {
  OVERVIEW_SOURCE_ID,
  createOverviewLayers,
  createOverviewSource,
} from './overviewBasemap';

export const LOCAL_REGION_PMTILES_QA_BASE_URL = 'http://localhost:8080/regions' as const;

/** Hardcoded local archives under `infrastructure/tiles/pmtiles/regions/<region>/`. */
export const LOCAL_REGION_PMTILES_QA_ENTRIES = [
  { region: 'yangon', version: 'v2' },
  { region: 'bago', version: 'v1' },
  { region: 'ayeyarwady', version: 'v1' },
  { region: 'mandalay', version: 'v1' },
  { region: 'magway', version: 'v1' },
  { region: 'sagaing', version: 'v1' },
  { region: 'tanintharyi', version: 'v1' },
  { region: 'naypyitaw', version: 'v1' },
  { region: 'kachin', version: 'v1' },
  { region: 'kayah', version: 'v1' },
  { region: 'kayin', version: 'v1' },
  { region: 'chin', version: 'v1' },
  { region: 'mon', version: 'v1' },
  { region: 'rakhine', version: 'v1' },
  { region: 'shan', version: 'v1' },
] as const;

function parseTruthyEnvFlag(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

/** Dev-only gate — ignored in production builds even if the env var is set. */
export function isLoadAllLocalRegionPmtilesQaEnabled(): boolean {
  const metaEnv = import.meta.env;
  if (!metaEnv?.DEV) {
    return false;
  }
  return parseTruthyEnvFlag(metaEnv.VITE_LOAD_ALL_LOCAL_REGION_PMTILES);
}

export function regionalPmtilesQaSourceId(region: string, version: string): string {
  return `${BASEMAP_VECTOR_SOURCE_ID}-${region}-${version}`;
}

export function regionalPmtilesQaHttpUrl(region: string, version: string): string {
  return `${LOCAL_REGION_PMTILES_QA_BASE_URL}/${region}/${region}-${version}.pmtiles`;
}

export function regionalPmtilesQaLayerIdSuffix(region: string, version: string): string {
  return `${region}-${version}`;
}

function cloneRegionalLayersForRegion(
  templateLayers: LayerSpecification[],
  region: string,
  version: string,
): LayerSpecification[] {
  const sourceId = regionalPmtilesQaSourceId(region, version);
  const suffix = regionalPmtilesQaLayerIdSuffix(region, version);

  return templateLayers.map((layer) => {
    const cloned =
      typeof structuredClone === 'function'
        ? structuredClone(layer)
        : (JSON.parse(JSON.stringify(layer)) as LayerSpecification);
    return {
      ...cloned,
      id: `${layer.id}-${suffix}`,
      source: sourceId,
    };
  });
}

function extractRegionalTemplateLayers(style: StyleSpecification): LayerSpecification[] {
  return (style.layers ?? []).filter(
    (layer): layer is LayerSpecification =>
      layer.id !== 'background' &&
      'source' in layer &&
      layer.source === BASEMAP_VECTOR_SOURCE_ID,
  );
}

/**
 * Overview base (unchanged) + all 15 regional PMTiles sources/layers from localhost:8080.
 */
export function composeLocalRegionPmtilesQaWebMapStyle(
  overviewPmtilesHttpUrl?: string,
): StyleSpecification {
  console.info('[pmtiles-qa] loading all local regions');

  const baseStyle = BaseMapStyle as StyleSpecification;
  const background = baseStyle.layers?.find((layer) => layer.id === 'background');
  const regionalTemplate = patchRegionalLayersForProgressiveDetail(
    extractRegionalTemplateLayers(baseStyle),
  );

  const sources: NonNullable<StyleSpecification['sources']> = {};
  const allRegionalLayers: LayerSpecification[] = [];

  for (const { region, version } of LOCAL_REGION_PMTILES_QA_ENTRIES) {
    const httpUrl = regionalPmtilesQaHttpUrl(region, version);
    const sourceId = regionalPmtilesQaSourceId(region, version);
    sources[sourceId] = createBasemapVectorSource(httpUrl);
    allRegionalLayers.push(...cloneRegionalLayersForRegion(regionalTemplate, region, version));
    console.info(`[pmtiles-qa] loaded ${region} ${httpUrl}`);
  }

  const overviewLayers = overviewPmtilesHttpUrl
    ? patchOverviewLayersForProgressiveDetail(createOverviewLayers())
    : [];

  if (overviewPmtilesHttpUrl) {
    sources[OVERVIEW_SOURCE_ID] = createOverviewSource(overviewPmtilesHttpUrl);
  }

  return {
    ...baseStyle,
    name: 'CoreMap Web — overview + all local regions (QA)',
    metadata: {
      ...(typeof baseStyle.metadata === 'object' && baseStyle.metadata !== null
        ? baseStyle.metadata
        : {}),
      'local-map:qa-mode': 'load-all-local-region-pmtiles',
      ...(overviewPmtilesHttpUrl
        ? {
            'local-map:overview-source': OVERVIEW_SOURCE_ID,
            'local-map:progressive-detail': 'overview-base-regional-handoff',
            'local-map:zoom-rules': JSON.stringify(BASEMAP_ZOOM_VISIBILITY_RULES),
          }
        : {}),
    },
    sources,
    layers: [
      ...(background ? [background] : []),
      ...overviewLayers,
      ...allRegionalLayers,
    ],
  };
}

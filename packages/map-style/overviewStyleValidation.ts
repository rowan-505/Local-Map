import OverviewMapStyle from './overview-map.json';
import {
  OVERVIEW_FORBIDDEN_SOURCE_LAYERS,
  OVERVIEW_PMTILES_SOURCE_LAYERS,
  OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER,
  OVERVIEW_VECTOR_SOURCE_ID,
  type OverviewPmtilesSourceLayer,
} from './overviewConstants';

/** Minimal layer shape read from overview-map.json for validation (no MapLibre runtime). */
export type OverviewStyleLayerDef = {
  id: string;
  type: string;
  source?: string;
  'source-layer'?: string;
};

type OverviewStyleLike = {
  sources?: Record<string, unknown>;
  layers?: OverviewStyleLayerDef[];
};

const OVERVIEW_PMTILES_SOURCE_LAYER_SET = new Set<string>(OVERVIEW_PMTILES_SOURCE_LAYERS);
const FORBIDDEN_SOURCE_LAYER_SET = new Set<string>(OVERVIEW_FORBIDDEN_SOURCE_LAYERS);
const LOCALHOST_URL_PATTERN = /localhost|127\.0\.0\.1/i;

/** Recursively finds string values containing localhost / loopback hosts. */
export function findLocalhostUrlsInStyle(style: unknown): string[] {
  const hits: string[] = [];

  function walk(value: unknown, path: string): void {
    if (typeof value === 'string') {
      if (LOCALHOST_URL_PATTERN.test(value)) {
        hits.push(path ? `${path}: ${value}` : value);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value)) {
        walk(nested, path ? `${path}.${key}` : key);
      }
    }
  }

  walk(style, '');
  return hits;
}

/** Reads `sources.overview.url` from a style-like object. */
export function getOverviewVectorSourceUrl(style: OverviewStyleLike): string | undefined {
  const overviewSource = style.sources?.[OVERVIEW_VECTOR_SOURCE_ID];
  if (!overviewSource || typeof overviewSource !== 'object') {
    return undefined;
  }
  const url = (overviewSource as { url?: unknown }).url;
  return typeof url === 'string' ? url : undefined;
}

export type CommittedOverviewStyleValidationResult = {
  ok: boolean;
  issues: string[];
};

/**
 * Validates the committed overview-map.json template:
 * no localhost URLs, placeholder PMTiles source URL, layer/source-layer rules.
 */
export function validateCommittedOverviewMapJson(
  style: OverviewStyleLike = OverviewMapStyle,
): CommittedOverviewStyleValidationResult {
  const issues: string[] = [];

  const localhostHits = findLocalhostUrlsInStyle(style);
  if (localhostHits.length > 0) {
    issues.push(
      `committed overview style must not contain localhost URLs (${localhostHits.join('; ')})`,
    );
  }

  const sourceUrl = getOverviewVectorSourceUrl(style);
  if (sourceUrl !== OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER) {
    issues.push(
      `sources.${OVERVIEW_VECTOR_SOURCE_ID}.url must be ${OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER} (got ${sourceUrl ?? 'missing'})`,
    );
  }

  const layerValidation = validateOverviewStyle(style);
  if (!layerValidation.ok) {
    issues.push(...layerValidation.issues.map((issue) => issue.message));
  }

  return { ok: issues.length === 0, issues };
}

function isPaintLayerType(type: string): boolean {
  return type === 'fill' || type === 'line' || type === 'symbol';
}

/** Layer definitions from the committed overview MapLibre style JSON. */
export function getOverviewStyleLayerDefinitions(
  style: OverviewStyleLike = OverviewMapStyle,
): OverviewStyleLayerDef[] {
  return (style.layers ?? []).map((layer) => ({
    id: layer.id,
    type: layer.type,
    source: layer.source,
    'source-layer': layer['source-layer'],
  }));
}

export type OverviewStyleValidationIssue = {
  code:
    | 'missing_overview_source'
    | 'invalid_vector_source'
    | 'invalid_source_layer'
    | 'forbidden_source_layer'
    | 'layer_type_order'
    | 'forbidden_layer_id';
  message: string;
};

export type OverviewStyleValidationResult = {
  ok: boolean;
  issues: OverviewStyleValidationIssue[];
};

/** Pure validation for overview MapLibre style JSON — fast, no browser/PMTiles I/O. */
export function validateOverviewStyle(style: OverviewStyleLike): OverviewStyleValidationResult {
  const issues: OverviewStyleValidationIssue[] = [];

  const overviewSource = style.sources?.[OVERVIEW_VECTOR_SOURCE_ID];
  if (!overviewSource || typeof overviewSource !== 'object') {
    issues.push({
      code: 'missing_overview_source',
      message: `sources.${OVERVIEW_VECTOR_SOURCE_ID} is required`,
    });
  } else {
    const srcType = (overviewSource as { type?: string }).type;
    if (srcType !== 'vector') {
      issues.push({
        code: 'missing_overview_source',
        message: `sources.${OVERVIEW_VECTOR_SOURCE_ID} must be type "vector" (got ${srcType ?? 'missing'})`,
      });
    }
  }

  const layers = getOverviewStyleLayerDefinitions(style);
  let seenSymbol = false;

  for (const layer of layers) {
    if (layer.source !== undefined && layer.source !== OVERVIEW_VECTOR_SOURCE_ID) {
      issues.push({
        code: 'invalid_vector_source',
        message: `layer "${layer.id}" must use source "${OVERVIEW_VECTOR_SOURCE_ID}" (got "${layer.source}")`,
      });
    }

    const sourceLayer = layer['source-layer'];
    if (sourceLayer !== undefined) {
      if (!OVERVIEW_PMTILES_SOURCE_LAYER_SET.has(sourceLayer)) {
        issues.push({
          code: 'invalid_source_layer',
          message: `layer "${layer.id}" uses unknown source-layer "${sourceLayer}"`,
        });
      }
      if (FORBIDDEN_SOURCE_LAYER_SET.has(sourceLayer)) {
        issues.push({
          code: 'forbidden_source_layer',
          message: `layer "${layer.id}" uses regional/OSM source-layer "${sourceLayer}"`,
        });
      }
    }

    for (const forbidden of ['road-', 'buildings', 'streets', 'landuse', 'basemap-'] as const) {
      if (layer.id.includes(forbidden)) {
        issues.push({
          code: 'forbidden_layer_id',
          message: `layer id "${layer.id}" looks like regional/OSM detail`,
        });
        break;
      }
    }

    if (layer.type === 'symbol') {
      seenSymbol = true;
    } else if (seenSymbol && isPaintLayerType(layer.type)) {
      issues.push({
        code: 'layer_type_order',
        message: `layer "${layer.id}" (${layer.type}) appears after a symbol layer — labels must stay on top`,
      });
    }
  }

  const paintLayers = layers.filter((l) => isPaintLayerType(l.type));
  const firstSymbolIdx = paintLayers.findIndex((l) => l.type === 'symbol');
  if (firstSymbolIdx > 0) {
    const beforeSymbols = paintLayers.slice(0, firstSymbolIdx);
    const hasFill = beforeSymbols.some((l) => l.type === 'fill');
    const hasLine = beforeSymbols.some((l) => l.type === 'line');
    if (!hasFill || !hasLine) {
      issues.push({
        code: 'layer_type_order',
        message: 'overview stack must include both fill and line layers before the first symbol layer',
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Asserts every expected PMTiles source-layer is referenced at least once in the style. */
export function findUnreferencedOverviewSourceLayers(
  style: OverviewStyleLike = OverviewMapStyle,
): OverviewPmtilesSourceLayer[] {
  const used = new Set<string>();
  for (const layer of getOverviewStyleLayerDefinitions(style)) {
    const sl = layer['source-layer'];
    if (sl) {
      used.add(sl);
    }
  }
  return OVERVIEW_PMTILES_SOURCE_LAYERS.filter((name) => !used.has(name));
}

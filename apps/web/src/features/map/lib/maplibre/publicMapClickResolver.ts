/**
 * Deterministic public-map click target resolution.
 *
 * Priority (highest first):
 * 1. Selected POI / selected transport pin
 * 2. POI circles
 * 3. Transport hitboxes, then transport point labels (label fallback only)
 * 4. Transport route / infrastructure lines
 * 5. Empty map (handled by caller)
 */
import type { MapGeoJSONFeature } from 'maplibre-gl';
import type { MapEngine, MapMouseEvent } from '../mapEngineTypes';
import {
  PLACES_IMPORTANT_LAYER_ID,
  PLACES_LAYER_ID,
  PLACES_SELECTED_HALO_LAYER_ID,
  PLACES_SELECTED_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
} from './publicMapMarkerLayerIds';
import {
  filterPresentMapLayers,
  PUBLIC_MAP_TRANSPORT_SELECTED_CLICK_LAYER_IDS,
} from './publicMapClickableLayerRegistry';
import { resolveTransportKind } from './transportPopupModel';

export type MapClickTargetKind =
  | 'poi_selected'
  | 'poi'
  | 'transport_selected'
  | 'transport_stop'
  | 'transport_terminal'
  | 'transport_line'
  | 'none';

export type ResolvedMapClickTarget = {
  readonly kind: MapClickTargetKind;
  readonly feature: MapGeoJSONFeature | null;
  readonly layerId: string | undefined;
};

const TRANSPORT_STOP_HITBOX_LAYER_IDS = [TRANSPORT_STOPS_HITBOX_LAYER_ID] as const;

const TRANSPORT_TERMINAL_HITBOX_LAYER_IDS = [
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
] as const;

const TRANSPORT_STOP_LABEL_LAYER_IDS = [
  TRANSPORT_MAJOR_STOP_LABELS_LAYER_ID,
  TRANSPORT_STOP_LABELS_LAYER_ID,
] as const;

const TRANSPORT_TERMINAL_LABEL_LAYER_IDS = [
  TRANSPORT_MAJOR_TERMINAL_LABELS_LAYER_ID,
  TRANSPORT_FERRY_LANDING_LABELS_LAYER_ID,
] as const;

/** Route / infrastructure line layers (dev inspection today; no public route detail yet). */
export const PUBLIC_MAP_TRANSPORT_LINE_CLICK_LAYER_IDS = [
  TRANSPORT_ROUTE_PATHS_LAYER_ID,
  TRANSPORT_INFRASTRUCTURE_LINES_LAYER_ID,
] as const;

type DirectClickResolutionStep = {
  readonly kind: 'poi_selected' | 'transport_selected' | 'poi';
  readonly layerIds: readonly string[];
};

const DIRECT_CLICK_RESOLUTION_STEPS: readonly DirectClickResolutionStep[] = [
  {
    kind: 'poi_selected',
    layerIds: [PLACES_SELECTED_LAYER_ID, PLACES_SELECTED_HALO_LAYER_ID],
  },
  {
    kind: 'transport_selected',
    layerIds: PUBLIC_MAP_TRANSPORT_SELECTED_CLICK_LAYER_IDS,
  },
  {
    kind: 'poi',
    layerIds: [PLACES_IMPORTANT_LAYER_ID, PLACES_LAYER_ID],
  },
];

/** Resolve the highest-priority clickable map feature at a screen point. */
export function resolveMapClickTarget(
  map: MapEngine,
  point: MapMouseEvent['point'],
): ResolvedMapClickTarget {
  for (const step of DIRECT_CLICK_RESOLUTION_STEPS) {
    const feature = queryFirstFeatureInLayers(map, point, step.layerIds);
    if (!feature) continue;
    return { kind: step.kind, feature, layerId: feature.layer?.id };
  }

  const stopHitboxFeature = queryPreferredTransportStopFeature(map, point);
  if (stopHitboxFeature) {
    return {
      kind: 'transport_stop',
      feature: stopHitboxFeature,
      layerId: stopHitboxFeature.layer?.id,
    };
  }

  const terminalHitboxFeature = queryFirstFeatureInLayers(
    map,
    point,
    TRANSPORT_TERMINAL_HITBOX_LAYER_IDS,
  );
  if (terminalHitboxFeature) {
    return {
      kind: 'transport_terminal',
      feature: terminalHitboxFeature,
      layerId: terminalHitboxFeature.layer?.id,
    };
  }

  const stopLabelFeature = queryPreferredTransportStopFeature(
    map,
    point,
    TRANSPORT_STOP_LABEL_LAYER_IDS,
  );
  if (stopLabelFeature) {
    return {
      kind: 'transport_stop',
      feature: stopLabelFeature,
      layerId: stopLabelFeature.layer?.id,
    };
  }

  const terminalLabelFeature = queryFirstFeatureInLayers(
    map,
    point,
    TRANSPORT_TERMINAL_LABEL_LAYER_IDS,
  );
  if (terminalLabelFeature) {
    return {
      kind: 'transport_terminal',
      feature: terminalLabelFeature,
      layerId: terminalLabelFeature.layer?.id,
    };
  }

  const lineFeature = queryFirstFeatureInLayers(
    map,
    point,
    PUBLIC_MAP_TRANSPORT_LINE_CLICK_LAYER_IDS,
  );
  if (lineFeature) {
    const lineKind = resolveTransportKind(lineFeature.sourceLayer, lineFeature.layer?.id);
    if (lineKind && lineKind !== 'stop' && lineKind !== 'terminal') {
      return { kind: 'transport_line', feature: lineFeature, layerId: lineFeature.layer?.id };
    }
  }

  return { kind: 'none', feature: null, layerId: undefined };
}

export function isTransportMapClickTargetKind(kind: MapClickTargetKind): boolean {
  return (
    kind === 'transport_selected' ||
    kind === 'transport_stop' ||
    kind === 'transport_terminal' ||
    kind === 'transport_line'
  );
}

function queryFirstFeatureInLayers(
  map: MapEngine,
  point: MapMouseEvent['point'],
  layerIds: readonly string[],
): MapGeoJSONFeature | null {
  const presentLayers = filterPresentMapLayers(map, layerIds);
  if (presentLayers.length === 0) return null;

  const hits = map.queryRenderedFeatures(point, { layers: presentLayers });
  return hits[0] ?? null;
}

/** Prefer station/public stops when multiple stop features overlap at the same pixel. */
export function pickPreferredTransportStopFeature(
  hits: readonly MapGeoJSONFeature[],
): MapGeoJSONFeature | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0] ?? null;

  let best = hits[0]!;
  let bestScore = scoreTransportStopFeature(best);
  for (let index = 1; index < hits.length; index += 1) {
    const candidate = hits[index]!;
    const score = scoreTransportStopFeature(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function queryPreferredTransportStopFeature(
  map: MapEngine,
  point: MapMouseEvent['point'],
  layerIds?: readonly string[],
): MapGeoJSONFeature | null {
  const stopLayerIds = layerIds ?? TRANSPORT_STOP_HITBOX_LAYER_IDS;
  const presentLayers = filterPresentMapLayers(map, stopLayerIds);
  if (presentLayers.length === 0) return null;

  const hits = map.queryRenderedFeatures(point, { layers: presentLayers });
  return pickPreferredTransportStopFeature(hits);
}

const STOP_TYPE_CLICK_RANK: Readonly<Record<string, number>> = {
  station: 40,
  train_station: 40,
  bus_stop: 20,
  platform: 15,
  halt: 10,
};

const REVIEW_STATUS_CLICK_RANK: Readonly<Record<string, number>> = {
  public_release: 50,
  verified: 40,
  reviewed: 30,
  needs_review: 10,
  imported_unreviewed: 5,
};

function scoreTransportStopFeature(feature: MapGeoJSONFeature): number {
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const stopType = String(properties.stop_type ?? '')
    .trim()
    .toLowerCase();
  const reviewStatus = String(properties.review_status ?? '')
    .trim()
    .toLowerCase();
  let score = STOP_TYPE_CLICK_RANK[stopType] ?? 1;
  score += REVIEW_STATUS_CLICK_RANK[reviewStatus] ?? 0;
  if (readNonEmptyString(properties.public_id) ?? readNonEmptyString(properties.publicId)) {
    score += 100;
  }
  return score;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

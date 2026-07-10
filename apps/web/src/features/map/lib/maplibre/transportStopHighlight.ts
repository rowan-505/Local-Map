/**
 * Hover + selected transport stop markers (GeoJSON overlay).
 * One point feature per role at a time — keeps DOM-free performance for dense stop fields.
 *
 * Normal stop circles live in Martin tile layers; this module draws only hover halo and the
 * selected pin above them. Mirrors the POI pattern: hide the tile dot, draw halo + pin.
 */
import type { ExpressionSpecification, GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import type { LanguageMode } from '@local-map/localized-name';
import type { MapEngine } from '../mapEngineTypes';
import { MAP_SYMBOL_TEXT_FONT } from '../../config';
import {
  TRANSPORT_HIGHLIGHT_SOURCE_ID,
  TRANSPORT_HOVER_HALO_LAYER_ID,
  TRANSPORT_SELECTED_CIRCLE_LAYER_ID,
  TRANSPORT_SELECTED_HALO_LAYER_ID,
  TRANSPORT_SELECTED_LABEL_LAYER_ID,
  TRANSPORT_SELECTED_PIN_LAYER_ID,
  TRANSPORT_STOP_HIGHLIGHT_LAYER_IDS,
  TRANSPORT_STOPS_LAYER_ID,
} from './publicMapMarkerLayerIds';
import {
  MARKER_STROKE_WHITE,
  SELECTED_MARKER_HALO,
  SELECTED_TRANSPORT_PIN_IMAGE_IDS,
  selectedMarkerHaloRadius,
  selectedTransportPinIconSize,
  selectedTransportAnchorRadius,
  transportHoverHaloRadius,
  TRANSPORT_MARKER_COLORS,
} from './publicMapMarkerStyles';
import {
  linearZoomTextSize,
  selectedMarkerCaptionTextField,
  TEXT_SIZE_SELECTED_CAPTION,
} from './publicMapLabelPolicy';
import {
  TRANSPORT_MAJOR_POINT_COLOR,
  TRANSPORT_MODE_BUS_COLOR,
  TRANSPORT_MODE_FERRY_COLOR,
  TRANSPORT_MODE_RAIL_COLOR,
  transportModeColorExpression,
} from './transportModeStyle';
import { createSelectedMapPinImage } from './selectedMapPinImage';

export {
  TRANSPORT_HIGHLIGHT_SOURCE_ID,
  TRANSPORT_HOVER_HALO_LAYER_ID,
  TRANSPORT_SELECTED_CIRCLE_LAYER_ID,
  TRANSPORT_SELECTED_HALO_LAYER_ID,
  TRANSPORT_SELECTED_PIN_LAYER_ID,
  TRANSPORT_SELECTED_LABEL_LAYER_ID,
  TRANSPORT_STOP_HIGHLIGHT_LAYER_IDS,
} from './publicMapMarkerLayerIds';

const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

type HighlightRole = 'hover' | 'selected';

export type TransportStopHighlight = {
  readonly id: string;
  readonly coordinates: readonly [number, number];
  readonly kind: 'stop' | 'terminal';
  readonly stopType?: string;
  readonly mode?: string;
  /** Display name for selected-pin caption (tile properties or API preview). */
  readonly label?: string;
  readonly nameMm?: string;
  readonly nameEn?: string;
};

let hoverHighlight: GeoJSON.Feature<GeoJSON.Point> | null = null;
let selectedHighlight: GeoJSON.Feature<GeoJSON.Point> | null = null;

function hoverFilter(): ExpressionSpecification {
  return ['==', ['get', 'role'], 'hover'];
}

function selectedFilter(): ExpressionSpecification {
  return ['==', ['get', 'role'], 'selected'];
}

function selectedTransportFillExpression(): ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'kind'], 'terminal'],
    TRANSPORT_MAJOR_POINT_COLOR,
    transportModeColorExpression(),
  ] as ExpressionSpecification;
}

function selectedTransportPinImageExpression(): ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'kind'], 'terminal'],
    SELECTED_TRANSPORT_PIN_IMAGE_IDS.terminal,
    [
      'match',
      ['get', 'mode'],
      ['rail', 'train'],
      SELECTED_TRANSPORT_PIN_IMAGE_IDS.rail,
      ['ferry', 'water'],
      SELECTED_TRANSPORT_PIN_IMAGE_IDS.ferry,
      SELECTED_TRANSPORT_PIN_IMAGE_IDS.bus,
    ],
  ] as ExpressionSpecification;
}

function selectedTransportLabelTextField(languageMode: LanguageMode = 'my'): ExpressionSpecification {
  return selectedMarkerCaptionTextField(languageMode);
}

function buildHighlightFeature(
  role: HighlightRole,
  highlight: TransportStopHighlight,
): GeoJSON.Feature<GeoJSON.Point> {
  return {
    type: 'Feature',
    id: `${role}:${highlight.id}`,
    geometry: {
      type: 'Point',
      coordinates: [highlight.coordinates[0], highlight.coordinates[1]],
    },
    properties: {
      role,
      id: highlight.id,
      kind: highlight.kind,
      stop_type: highlight.stopType ?? '',
      mode: highlight.mode ?? 'bus',
      name_mm: highlight.nameMm ?? '',
      name_en: highlight.nameEn ?? '',
      label: highlight.label ?? '',
    },
  };
}

function syncHighlightSource(map: MapEngine): void {
  const source = map.getSource(TRANSPORT_HIGHLIGHT_SOURCE_ID) as GeoJSONSource | undefined;
  if (!source) return;
  const features = [hoverHighlight, selectedHighlight].filter(
    (feature): feature is GeoJSON.Feature<GeoJSON.Point> => feature !== null,
  );
  source.setData({
    type: 'FeatureCollection',
    features,
  });
}

function readTransportOverlayVisible(map: MapEngine): boolean {
  if (!map.getLayer(TRANSPORT_STOPS_LAYER_ID)) return false;
  return map.getLayoutProperty(TRANSPORT_STOPS_LAYER_ID, 'visibility') !== 'none';
}

/** Matches highlight layer visibility to the transport overlay toggle. */
export function setTransportHighlightLayersVisible(map: MapEngine, visible: boolean): void {
  const visibility = visible ? 'visible' : 'none';
  for (const layerId of TRANSPORT_STOP_HIGHLIGHT_LAYER_IDS) {
    if (!map.getLayer(layerId)) continue;
    map.setLayoutProperty(layerId, 'visibility', visibility);
  }
}

/** Registers the hover/selected stop overlay layers (idempotent). */
export function ensureTransportStopHighlightLayers(map: MapEngine): void {
  ensureSelectedTransportPinImages(map);

  if (!map.getSource(TRANSPORT_HIGHLIGHT_SOURCE_ID)) {
    map.addSource(TRANSPORT_HIGHLIGHT_SOURCE_ID, {
      type: 'geojson',
      data: EMPTY_COLLECTION,
    });
  }

  if (!map.getLayer(TRANSPORT_HOVER_HALO_LAYER_ID)) {
    map.addLayer({
      id: TRANSPORT_HOVER_HALO_LAYER_ID,
      type: 'circle',
      source: TRANSPORT_HIGHLIGHT_SOURCE_ID,
      filter: hoverFilter(),
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': transportHoverHaloRadius(),
        'circle-color': SELECTED_MARKER_HALO.transportHover.color,
        'circle-opacity': SELECTED_MARKER_HALO.transportHover.opacity,
        'circle-blur': SELECTED_MARKER_HALO.transportHover.blur,
      },
    });
  }

  if (!map.getLayer(TRANSPORT_SELECTED_HALO_LAYER_ID)) {
    map.addLayer({
      id: TRANSPORT_SELECTED_HALO_LAYER_ID,
      type: 'circle',
      source: TRANSPORT_HIGHLIGHT_SOURCE_ID,
      filter: selectedFilter(),
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': selectedMarkerHaloRadius(),
        'circle-color': SELECTED_MARKER_HALO.transport.color,
        'circle-opacity': SELECTED_MARKER_HALO.transport.opacity,
        'circle-blur': SELECTED_MARKER_HALO.transport.blur,
      },
    });
  }

  if (!map.getLayer(TRANSPORT_SELECTED_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: TRANSPORT_SELECTED_CIRCLE_LAYER_ID,
      type: 'circle',
      source: TRANSPORT_HIGHLIGHT_SOURCE_ID,
      filter: selectedFilter(),
      layout: { visibility: 'none' },
      paint: {
        'circle-radius': selectedTransportAnchorRadius(),
        'circle-color': selectedTransportFillExpression(),
        'circle-opacity': 0.96,
        'circle-stroke-color': MARKER_STROKE_WHITE,
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 1,
      },
    });
  }

  if (!map.getLayer(TRANSPORT_SELECTED_PIN_LAYER_ID)) {
    map.addLayer({
      id: TRANSPORT_SELECTED_PIN_LAYER_ID,
      type: 'symbol',
      source: TRANSPORT_HIGHLIGHT_SOURCE_ID,
      filter: selectedFilter(),
      layout: {
        visibility: 'none',
        'icon-image': selectedTransportPinImageExpression(),
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': selectedTransportPinIconSize(),
      },
    });
  }

  if (!map.getLayer(TRANSPORT_SELECTED_LABEL_LAYER_ID)) {
    map.addLayer({
      id: TRANSPORT_SELECTED_LABEL_LAYER_ID,
      type: 'symbol',
      source: TRANSPORT_HIGHLIGHT_SOURCE_ID,
      filter: selectedFilter(),
      layout: {
        visibility: 'none',
        'text-field': selectedTransportLabelTextField(),
        'text-font': [...MAP_SYMBOL_TEXT_FONT],
        'text-size': linearZoomTextSize(TEXT_SIZE_SELECTED_CAPTION),
        'text-offset': [0, 1.35],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': TRANSPORT_MARKER_COLORS.label,
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.75,
        'text-opacity': 1,
      },
    });
  }

  setTransportHighlightLayersVisible(map, readTransportOverlayVisible(map));
  syncHighlightSource(map);
}

export function setTransportStopHover(
  map: MapEngine,
  highlight: TransportStopHighlight | null,
): void {
  hoverHighlight = highlight ? buildHighlightFeature('hover', highlight) : null;
  syncHighlightSource(map);
}

export function setSelectedTransportStop(
  map: MapEngine,
  highlight: TransportStopHighlight | null,
): void {
  selectedHighlight = highlight ? buildHighlightFeature('selected', highlight) : null;
  syncHighlightSource(map);
}

/** Clears hover + selected overlays (e.g. when the transport overlay is hidden). */
export function clearTransportStopHighlights(map: MapEngine): void {
  hoverHighlight = null;
  selectedHighlight = null;
  syncHighlightSource(map);
}

export function highlightFromTransportFeature(
  feature: MapGeoJSONFeature,
): TransportStopHighlight | null {
  const geometry = feature.geometry;
  if (!geometry || geometry.type !== 'Point') return null;

  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const featureId = feature.id;
  const id = resolveTransportTilePointId(
    properties,
    typeof featureId === 'string' || typeof featureId === 'number' ? featureId : undefined,
  );
  if (!id) return null;

  const kind =
    feature.sourceLayer === 'transport_terminals_v' ||
    feature.layer?.id === 'transport-major-terminals' ||
    feature.layer?.id === 'transport-ferry-landings'
      ? 'terminal'
      : 'stop';

  const coordinates = geometry.coordinates as [number, number];
  const stopType =
    typeof properties.stop_type === 'string' ? properties.stop_type : undefined;
  const mode = typeof properties.mode === 'string' ? properties.mode : undefined;
  const nameMm = typeof properties.name_mm === 'string' ? properties.name_mm : undefined;
  const nameEn = typeof properties.name_en === 'string' ? properties.name_en : undefined;

  return { id, coordinates, kind, stopType, mode, nameMm, nameEn };
}

/** Tile id used to hide the normal circle under the selected pin. */
export function resolveTransportTilePointId(
  properties: Record<string, unknown>,
  featureId?: string | number,
): string | null {
  const rawId = properties.id;
  if (rawId !== null && rawId !== undefined) {
    const asString = String(rawId).trim();
    if (asString.length > 0) return asString;
  }
  if (featureId !== null && featureId !== undefined) {
    const asString = String(featureId).trim();
    if (asString.length > 0) return asString;
  }
  const publicId = properties.public_id ?? properties.publicId;
  if (publicId !== null && publicId !== undefined) {
    const asString = String(publicId).trim();
    if (asString.length > 0) return asString;
  }
  return null;
}

function ensureSelectedTransportPinImages(map: MapEngine): void {
  const specs = [
    { id: SELECTED_TRANSPORT_PIN_IMAGE_IDS.bus, fill: TRANSPORT_MODE_BUS_COLOR, glyph: 'bus' as const },
    { id: SELECTED_TRANSPORT_PIN_IMAGE_IDS.rail, fill: TRANSPORT_MODE_RAIL_COLOR, glyph: 'bus' as const },
    { id: SELECTED_TRANSPORT_PIN_IMAGE_IDS.ferry, fill: TRANSPORT_MODE_FERRY_COLOR, glyph: 'bus' as const },
    {
      id: SELECTED_TRANSPORT_PIN_IMAGE_IDS.terminal,
      fill: TRANSPORT_MAJOR_POINT_COLOR,
      glyph: 'terminal' as const,
    },
  ] as const;

  for (const spec of specs) {
    if (map.hasImage(spec.id)) continue;
    const image = createSelectedMapPinImage({ fillColor: spec.fill, glyph: spec.glyph });
    if (image) map.addImage(spec.id, image, { pixelRatio: 2 });
  }
}

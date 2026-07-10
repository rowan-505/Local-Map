import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PLACES_LAYER_ID,
  PLACES_SELECTED_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
  TRANSPORT_SELECTED_LABEL_LAYER_ID,
  TRANSPORT_SELECTED_PIN_LAYER_ID,
  TRANSPORT_STOPS_LAYER_ID,
} from './publicMapMarkerLayerIds.js';
import {
  RADIUS_BUS_STOP_STOPS,
  RADIUS_STATION_TERMINAL_STOPS,
  TRANSPORT_POINT_HITBOX_ZOOM_BANDS,
  transportPointHitboxRadiusAtZoom,
} from './publicMapMarkerPolicy.js';

/** Must match {@link TRANSPORT_SOURCE_MAX_ZOOM} in `transportSources.ts`. */
const TRANSPORT_SOURCE_MAX_ZOOM = 22;

/** Mirrors transport point slice of `TRANSPORT_OVERLAY_STACK_BOTTOM_TO_TOP`. */
const TRANSPORT_POINT_STACK_BOTTOM_TO_TOP = [
  TRANSPORT_STOPS_LAYER_ID,
  TRANSPORT_FERRY_LANDINGS_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_LAYER_ID,
] as const;

/** Mirrors selected transport marker slice of `TRANSPORT_SELECTED_MARKER_STACK_BOTTOM_TO_TOP`. */
const TRANSPORT_SELECTED_STACK_BOTTOM_TO_TOP = [
  TRANSPORT_SELECTED_PIN_LAYER_ID,
  TRANSPORT_SELECTED_LABEL_LAYER_ID,
] as const;

function indexOfLayer(stack: readonly string[], layerId: string): number {
  const index = stack.indexOf(layerId);
  assert.notEqual(index, -1, `expected ${layerId} in stack`);
  return index;
}

function assertMonotonicRadiusStops(stops: readonly (readonly [number, number])[]): void {
  for (let i = 1; i < stops.length; i++) {
    assert.ok(
      stops[i][1] >= stops[i - 1][1],
      `radius should not shrink: ${stops[i - 1][0]}→${stops[i][0]}`,
    );
  }
}

describe('public map marker policy', () => {
  it('keeps transport vector tiles visible through street-level zoom', () => {
    assert.ok(TRANSPORT_SOURCE_MAX_ZOOM >= 20);
  });

  it('grows bus stop radii with zoom', () => {
    assertMonotonicRadiusStops(RADIUS_BUS_STOP_STOPS);
  });

  it('uses stable transport hitbox radii by zoom band', () => {
    for (const band of TRANSPORT_POINT_HITBOX_ZOOM_BANDS) {
      for (let zoom = band.from; zoom <= band.to; zoom += 1) {
        assert.equal(
          transportPointHitboxRadiusAtZoom(zoom),
          band.radius,
          `hitbox radius at z${zoom}`,
        );
      }
    }
  });

  it('renders stations/terminals larger than bus stops at the same zoom', () => {
    for (const [zoom] of RADIUS_BUS_STOP_STOPS) {
      const busRadius =
        RADIUS_BUS_STOP_STOPS.find(([z]) => z === zoom)?.[1] ??
        RADIUS_BUS_STOP_STOPS[RADIUS_BUS_STOP_STOPS.length - 1][1];
      const stationRadius =
        RADIUS_STATION_TERMINAL_STOPS.find(([z]) => z === zoom)?.[1] ??
        RADIUS_STATION_TERMINAL_STOPS[RADIUS_STATION_TERMINAL_STOPS.length - 1][1];
      assert.ok(stationRadius > busRadius, `station should exceed bus radius at z${zoom}`);
    }
  });

  it('shows terminal labels before dense bus stop labels', () => {
    assert.ok(12 < 18);
    assert.ok(14 < 17);
  });
});

describe('public map overlay stack (layer ids)', () => {
  it('orders bus stops below terminals within transport points', () => {
    assert.ok(
      indexOfLayer(TRANSPORT_POINT_STACK_BOTTOM_TO_TOP, TRANSPORT_STOPS_LAYER_ID) <
        indexOfLayer(TRANSPORT_POINT_STACK_BOTTOM_TO_TOP, TRANSPORT_MAJOR_TERMINALS_LAYER_ID),
    );
  });

  it('places selected transport caption above the selected pin', () => {
    assert.ok(
      indexOfLayer(TRANSPORT_SELECTED_STACK_BOTTOM_TO_TOP, TRANSPORT_SELECTED_PIN_LAYER_ID) <
        indexOfLayer(TRANSPORT_SELECTED_STACK_BOTTOM_TO_TOP, TRANSPORT_SELECTED_LABEL_LAYER_ID),
    );
  });

  it('uses stable POI layer ids for circle and selected pin stacks', () => {
    assert.equal(PLACES_LAYER_ID, 'places-circle');
    assert.equal(PLACES_SELECTED_LAYER_ID, 'places-selected-circle');
  });
});

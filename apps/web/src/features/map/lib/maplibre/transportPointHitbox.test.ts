import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_MAP_TRANSPORT_HITBOX_LAYER_IDS,
  PUBLIC_MAP_TRANSPORT_HOVER_LAYER_IDS,
  PUBLIC_MAP_TRANSPORT_STOP_CLICK_LAYER_IDS,
  PUBLIC_MAP_TRANSPORT_TERMINAL_CLICK_LAYER_IDS,
} from './publicMapClickableLayerRegistry.js';
import {
  TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
  TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
  TRANSPORT_STOPS_HITBOX_LAYER_ID,
} from './publicMapMarkerLayerIds.js';
import { TRANSPORT_POINT_HITBOX_RADIUS_EXPRESSION } from './publicMapMarkerPolicy.js';

describe('transport point hitbox contract', () => {
  it('registers hitbox layers for stops, terminals, and ferry landings', () => {
    assert.deepEqual(PUBLIC_MAP_TRANSPORT_HITBOX_LAYER_IDS, [
      TRANSPORT_STOPS_HITBOX_LAYER_ID,
      TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
      TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
    ]);
  });

  it('uses hitboxes as the primary stop click target before labels', () => {
    assert.equal(PUBLIC_MAP_TRANSPORT_STOP_CLICK_LAYER_IDS[0], TRANSPORT_STOPS_HITBOX_LAYER_ID);
    assert.ok(
      PUBLIC_MAP_TRANSPORT_STOP_CLICK_LAYER_IDS.includes('transport-major-stop-labels'),
    );
    assert.ok(PUBLIC_MAP_TRANSPORT_STOP_CLICK_LAYER_IDS.includes('transport-stop-labels'));
  });

  it('uses hitboxes as the primary terminal click target before labels', () => {
    assert.equal(
      PUBLIC_MAP_TRANSPORT_TERMINAL_CLICK_LAYER_IDS[0],
      TRANSPORT_MAJOR_TERMINALS_HITBOX_LAYER_ID,
    );
    assert.equal(
      PUBLIC_MAP_TRANSPORT_TERMINAL_CLICK_LAYER_IDS[1],
      TRANSPORT_FERRY_LANDINGS_HITBOX_LAYER_ID,
    );
  });

  it('shows pointer cursor on hitbox hover only', () => {
    assert.deepEqual(PUBLIC_MAP_TRANSPORT_HOVER_LAYER_IDS, PUBLIC_MAP_TRANSPORT_HITBOX_LAYER_IDS);
  });

  it('uses a step expression for stable hitbox radii', () => {
    assert.deepEqual(TRANSPORT_POINT_HITBOX_RADIUS_EXPRESSION, [
      'step',
      ['zoom'],
      8,
      14,
      10,
      16,
      12,
    ]);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PUBLIC_MAP_MAX_ZOOM } from '../../config/publicMapViewport.js';
import {
  TRANSPORT_MARTIN_MIN_TILEJSON_MAX_ZOOM,
  TRANSPORT_SOURCE_MAX_ZOOM,
  TRANSPORT_SOURCE_MIN_ZOOM,
} from './transportSources.js';

describe('transportSources zoom contract', () => {
  it('requests native Martin tiles through public street zoom', () => {
    assert.equal(TRANSPORT_SOURCE_MIN_ZOOM, 0);
    assert.ok(TRANSPORT_SOURCE_MAX_ZOOM >= PUBLIC_MAP_MAX_ZOOM);
    assert.equal(TRANSPORT_MARTIN_MIN_TILEJSON_MAX_ZOOM, PUBLIC_MAP_MAX_ZOOM);
  });
});

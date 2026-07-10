import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MapGeoJSONFeature } from 'maplibre-gl';

import { pickPreferredTransportStopFeature } from './publicMapClickResolver.js';

function stopFeature(
  properties: Record<string, unknown>,
  id = 'feature',
): MapGeoJSONFeature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [96.09, 16.91] },
    properties,
    layer: { id: 'transport-stops-hitbox' },
    source: 'transport',
    sourceLayer: 'transport_stops_v',
    state: {},
  } as MapGeoJSONFeature;
}

describe('pickPreferredTransportStopFeature', () => {
  it('prefers public-release station stops over nearby bus stops', () => {
    const busStop = stopFeature(
      {
        stop_type: 'bus_stop',
        review_status: 'needs_review',
        name_en: 'Aung San Myo',
      },
      'bus',
    );
    const station = stopFeature(
      {
        stop_type: 'station',
        review_status: 'public_release',
        public_id: 'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
        name_en: 'Aung San Railway Station',
      },
      'station',
    );

    const picked = pickPreferredTransportStopFeature([busStop, station]);
    assert.equal(picked?.id, 'station');
  });

  it('returns the only feature when there is no overlap', () => {
    const only = stopFeature({ stop_type: 'bus_stop' }, 'only');
    assert.equal(pickPreferredTransportStopFeature([only])?.id, 'only');
  });
});

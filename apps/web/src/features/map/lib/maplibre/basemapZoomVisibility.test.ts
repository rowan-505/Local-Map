import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';

import { createOverviewLayers } from './overviewBasemap.js';
import {
  OVERVIEW_BOUNDARY_MAX_ZOOM,
  OVERVIEW_LABELS_END_ZOOM,
  REGIONAL_BASE_APPEAR_ZOOM,
  patchOverviewLayersForProgressiveDetail,
  patchRegionalLayersForProgressiveDetail,
} from './basemapZoomVisibility.js';

describe('patchRegionalLayersForProgressiveDetail', () => {
  it('raises early regional fills to z7', () => {
    const layers = patchRegionalLayersForProgressiveDetail(
      BaseMapStyle.layers as never,
    );
    assert.equal(
      layers.find((l) => l.id === 'water-polygons')?.minzoom,
      REGIONAL_BASE_APPEAR_ZOOM,
    );
    assert.equal(
      layers.find((l) => l.id === 'water-lines')?.minzoom,
      REGIONAL_BASE_APPEAR_ZOOM,
    );
    assert.equal(layers.find((l) => l.id === 'road-fill')?.minzoom, 10);
  });
});

describe('patchOverviewLayersForProgressiveDetail', () => {
  it('caps overview label layers at z10', () => {
    const layers = patchOverviewLayersForProgressiveDetail(createOverviewLayers());
    const country = layers.find((l) => l.id === 'overview-country-labels');
    const places = layers.find((l) => l.id === 'overview-populated-places');
    assert.equal(country?.maxzoom, OVERVIEW_LABELS_END_ZOOM);
    assert.equal(places?.maxzoom, OVERVIEW_LABELS_END_ZOOM);
    assert.ok(country?.paint && 'text-opacity' in country.paint);
  });

  it('leaves overview land/ocean layers unchanged', () => {
    const before = createOverviewLayers();
    const after = patchOverviewLayersForProgressiveDetail(before);
    assert.equal(after.find((l) => l.id === 'overview-ocean')?.maxzoom, before[0]?.maxzoom);
    assert.equal(after.find((l) => l.id === 'overview-land')?.maxzoom, before[1]?.maxzoom);
  });

  it('caps overview boundary line layers at z8 for regional handoff', () => {
    const layers = patchOverviewLayersForProgressiveDetail(createOverviewLayers());
    for (const id of [
      'overview-country-boundaries',
      'overview-coastline',
      'overview-mmr-admin0-outline',
      'overview-mmr-admin1-boundaries',
    ] as const) {
      assert.equal(layers.find((l) => l.id === id)?.maxzoom, OVERVIEW_BOUNDARY_MAX_ZOOM);
    }
    assert.equal(
      layers.find((l) => l.id === 'overview-country-boundaries')?.minzoom,
      0,
    );
    assert.equal(layers.find((l) => l.id === 'overview-mmr-admin0-outline')?.minzoom, 2);
    assert.equal(layers.find((l) => l.id === 'overview-mmr-admin1-boundaries')?.minzoom, 2);
    const ids = layers.map((l) => l.id);
    assert.ok(
      ids.indexOf('overview-mmr-admin1-boundaries') < ids.indexOf('overview-mmr-admin0-outline'),
      'admin1 boundaries below admin0 outline',
    );
  });

  it('keeps regional admin-boundaries at z7+', () => {
    const layers = patchRegionalLayersForProgressiveDetail(BaseMapStyle.layers as never);
    assert.equal(layers.find((l) => l.id === 'admin-boundaries')?.minzoom, REGIONAL_BASE_APPEAR_ZOOM);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findFirstSymbolLayerId,
  findLastRoadLineLayerIndex,
  findRouteOverlayInsertBeforeLayerId,
} from './mapLayerInsert.js';

const BASEMAP_LIKE_LAYERS = [
  { id: 'background', type: 'background' },
  { id: 'admin-labels', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
  { id: 'village-labels', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
  { id: 'road-casing', type: 'line', 'source-layer': 'streets' },
  { id: 'road-fill', type: 'line', 'source-layer': 'streets' },
  { id: 'buildings', type: 'fill', 'source-layer': 'buildings' },
  {
    id: 'admin-neighborhood-labels',
    type: 'symbol',
    layout: { 'text-field': ['get', 'name'] },
  },
  { id: 'road-labels', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
] as const;

function mockMap(layers: readonly { id: string; type: string; [key: string]: unknown }[]) {
  return { getStyle: () => ({ layers: [...layers] }) };
}

describe('findLastRoadLineLayerIndex', () => {
  it('returns the topmost road line layer index', () => {
    const map = mockMap(BASEMAP_LIKE_LAYERS);
    assert.equal(findLastRoadLineLayerIndex(map as never), 4);
  });
});

describe('findRouteOverlayInsertBeforeLayerId', () => {
  it('anchors below the first label layer after road geometry, not the first symbol', () => {
    const map = mockMap(BASEMAP_LIKE_LAYERS);
    assert.equal(findRouteOverlayInsertBeforeLayerId(map as never), 'admin-neighborhood-labels');
    assert.equal(findFirstSymbolLayerId(map as never), 'admin-labels');
  });

  it('anchors below road-labels when roads come before labels only', () => {
    const map = mockMap([
      { id: 'background', type: 'background' },
      { id: 'road-casing', type: 'line', 'source-layer': 'streets' },
      { id: 'road-fill', type: 'line', 'source-layer': 'streets' },
      { id: 'road-labels', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
    ]);
    assert.equal(findRouteOverlayInsertBeforeLayerId(map as never), 'road-labels');
  });

  it('skips legacy route arrow symbol when searching labels', () => {
    const map = mockMap([
      { id: 'road-fill', type: 'line', 'source-layer': 'streets' },
      { id: 'route-direction-arrows', type: 'symbol', layout: { 'icon-image': 'arrow' } },
      { id: 'road-labels', type: 'symbol', layout: { 'text-field': ['get', 'name'] } },
    ]);
    assert.equal(findRouteOverlayInsertBeforeLayerId(map as never), 'road-labels');
  });

  it('falls back to the first layer after roads when no label exists', () => {
    const map = mockMap([
      { id: 'background', type: 'background' },
      { id: 'road-fill', type: 'line', 'source-layer': 'streets' },
      { id: 'buildings', type: 'fill' },
    ]);
    assert.equal(findRouteOverlayInsertBeforeLayerId(map as never), 'buildings');
  });
});

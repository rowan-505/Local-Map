import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PublicSearchResult, SearchResultGeometry } from '@/features/poi/api/publicMapApi';
import {
  clearSearchHighlight,
  fitSearchResult,
  isPointLikeHighlight,
  SEARCH_HIGHLIGHT_SOURCE_ID,
} from './searchHighlightOnMap';

function adminAreaResult(overrides: Partial<PublicSearchResult> = {}): PublicSearchResult {
  return {
    id: 'admin_area:101',
    entityType: 'admin_area',
    type: 'admin_area',
    entityId: '101',
    displayName: 'Yangon Township',
    center: [96.16, 16.84],
    bbox: [96.1, 16.8, 96.2, 16.9],
    hasGeometry: true,
    ...overrides,
  };
}

function geometry(entityId = '101'): SearchResultGeometry {
  return {
    entityType: 'admin_area',
    entityId,
    geometryType: 'Polygon',
    bbox: [96.11, 16.81, 96.19, 16.89],
    feature: {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [96.11, 16.81],
          [96.19, 16.81],
          [96.19, 16.89],
          [96.11, 16.89],
          [96.11, 16.81],
        ]],
      },
      properties: { entityType: 'admin_area', entityId },
    },
  };
}

function createMockMap() {
  const sources = new Map<string, { data: GeoJSON.FeatureCollection; setData: (data: GeoJSON.FeatureCollection) => void }>();
  const layers = new Set<string>();
  const fitBoundsCalls: unknown[] = [];
  const flyToCalls: unknown[] = [];

  const map = {
    isStyleLoaded: () => true,
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, input: { data: GeoJSON.FeatureCollection }) => {
      sources.set(id, {
        data: input.data,
        setData(data: GeoJSON.FeatureCollection) {
          this.data = data;
        },
      });
    },
    getLayer: (id: string) => (layers.has(id) ? { id } : undefined),
    addLayer: (layer: { id: string }) => {
      layers.add(layer.id);
    },
    fitBounds: (...args: unknown[]) => {
      fitBoundsCalls.push(args);
    },
    flyTo: (...args: unknown[]) => {
      flyToCalls.push(args);
    },
  };

  return {
    map: map as never,
    source: () => sources.get(SEARCH_HIGHLIGHT_SOURCE_ID),
    fitBoundsCalls,
    flyToCalls,
  };
}

describe('search result highlight overlay', () => {
  it('treats admin_area as a geometry-backed result', () => {
    assert.equal(isPointLikeHighlight(adminAreaResult()), false);
  });

  it('draws an admin_area bbox polygon on the first selection before geometry arrives', async () => {
    const mock = createMockMap();

    await fitSearchResult(mock.map, adminAreaResult());

    const feature = mock.source()?.data.features[0];
    assert.equal(feature?.geometry.type, 'Polygon');
    assert.equal(feature?.properties?.entityType, 'admin_area');
    assert.equal(feature?.properties?.entityId, '101');
    assert.equal(feature?.properties?.source, 'bbox');
    assert.equal(mock.fitBoundsCalls.length, 1);
    assert.equal(mock.flyToCalls.length, 0);
  });

  it('replaces the bbox overlay with fetched geometry when it arrives', async () => {
    const mock = createMockMap();

    await fitSearchResult(mock.map, adminAreaResult());
    await fitSearchResult(mock.map, adminAreaResult(), { geometry: geometry() });

    const feature = mock.source()?.data.features[0];
    assert.equal(feature?.geometry.type, 'Polygon');
    assert.equal(feature?.properties?.entityId, '101');
    assert.equal(feature?.properties?.source, undefined);
    assert.deepEqual(
      (feature?.geometry as GeoJSON.Polygon).coordinates[0]?.[0],
      [96.11, 16.81],
    );
  });

  it('replaces the previous area overlay when another area is selected', async () => {
    const mock = createMockMap();

    await fitSearchResult(mock.map, adminAreaResult({ entityId: '101' }));
    await fitSearchResult(
      mock.map,
      adminAreaResult({
        id: 'admin_area:202',
        entityId: '202',
        bbox: [95.9, 16.7, 96.0, 16.8],
      }),
    );

    const feature = mock.source()?.data.features[0];
    assert.equal(feature?.properties?.entityId, '202');
    assert.deepEqual(
      (feature?.geometry as GeoJSON.Polygon).coordinates[0]?.[0],
      [95.9, 16.7],
    );
  });

  it('clear selection removes the overlay data', async () => {
    const mock = createMockMap();

    await fitSearchResult(mock.map, adminAreaResult());
    clearSearchHighlight(mock.map);

    assert.equal(mock.source()?.data.features.length, 0);
  });
});

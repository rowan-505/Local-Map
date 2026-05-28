import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  bboxFromDirectionsOverlay,
  overlayConnectorsToGeoJSON,
  overlayToGeoJSON,
  ROUTE_ACTIVE_SOURCE_ID,
  ROUTE_CONNECTOR_SNAP_THRESHOLD_METERS,
  ROUTE_CONNECTOR_SOURCE_ID,
} from './directionsRouteGeoJson.js';

describe('directionsRouteGeoJson', () => {
  it('overlayToGeoJSON builds line and endpoints for draw', () => {
    const fc = overlayToGeoJSON({
      from: [96.1, 16.8],
      to: [96.2, 16.9],
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.1, 16.8],
          [96.15, 16.85],
          [96.2, 16.9],
        ],
      },
    });

    assert.equal(fc.features.length, 3);
    assert.equal(fc.features[0]?.geometry.type, 'LineString');
    assert.equal(fc.features[0]?.properties?.kind, 'route');
    assert.equal(fc.features[1]?.properties?.role, 'from');
    assert.equal(fc.features[2]?.properties?.role, 'to');
  });

  it('overlayToGeoJSON clears to empty FeatureCollection', () => {
    const first = overlayToGeoJSON({
      from: [96.1, 16.8],
      to: [96.2, 16.9],
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.1, 16.8],
          [96.2, 16.9],
        ],
      },
    });
    assert.equal(first.features.length, 3);

    const cleared = overlayToGeoJSON(null);
    assert.equal(cleared.features.length, 0);
  });

  it('overlayToGeoJSON replaces data on subsequent route requests', () => {
    const first = overlayToGeoJSON({
      from: [96.1, 16.8],
      to: [96.2, 16.9],
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.1, 16.8],
          [96.2, 16.9],
        ],
      },
    });
    const second = overlayToGeoJSON({
      from: [96.3, 16.7],
      to: [96.4, 16.75],
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.3, 16.7],
          [96.35, 16.72],
          [96.4, 16.75],
        ],
      },
    });

    assert.notDeepEqual(
      first.features[0]?.geometry,
      second.features[0]?.geometry,
    );
    assert.equal(second.features.length, 3);
  });

  it('bboxFromDirectionsOverlay computes bounds for fit', () => {
    const bbox = bboxFromDirectionsOverlay({
      from: null,
      to: null,
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.0, 16.0],
          [97.0, 17.0],
        ],
      },
    });
    assert.deepEqual(bbox, [96, 16, 97, 17]);
  });

  it('uses route-active-source id', () => {
    assert.equal(ROUTE_ACTIVE_SOURCE_ID, 'route-active-source');
  });

  it('uses route-connector-source id', () => {
    assert.equal(ROUTE_CONNECTOR_SOURCE_ID, 'route-connector-source');
  });

  it('overlayConnectorsToGeoJSON skips connectors when snapped within threshold', () => {
    const fc = overlayConnectorsToGeoJSON({
      from: [96.1, 16.8],
      to: [96.2, 16.9],
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.1, 16.8],
          [96.15, 16.85],
          [96.2, 16.9],
        ],
      },
    });
    assert.equal(fc.features.length, 0);
  });

  it('overlayConnectorsToGeoJSON draws origin and destination snap lines', () => {
    const fc = overlayConnectorsToGeoJSON({
      from: [96.1, 16.8],
      to: [96.25, 16.92],
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.12, 16.81],
          [96.18, 16.86],
          [96.22, 16.9],
        ],
      },
    });

    assert.equal(fc.features.length, 2);
    assert.equal(fc.features[0]?.properties?.role, 'from-connector');
    assert.equal(fc.features[1]?.properties?.role, 'to-connector');
    assert.deepEqual(fc.features[0]?.geometry, {
      type: 'LineString',
      coordinates: [
        [96.1, 16.8],
        [96.12, 16.81],
      ],
    });
    assert.deepEqual(fc.features[1]?.geometry, {
      type: 'LineString',
      coordinates: [
        [96.22, 16.9],
        [96.25, 16.92],
      ],
    });
  });

  it('overlayConnectorsToGeoJSON clears with null overlay', () => {
    const fc = overlayConnectorsToGeoJSON(null);
    assert.equal(fc.features.length, 0);
  });

  it('connector threshold is a small snap distance', () => {
    assert.equal(ROUTE_CONNECTOR_SNAP_THRESHOLD_METERS, 5);
  });

  it('shows connectors for gaps above 5 meters only', () => {
    const fc = overlayConnectorsToGeoJSON({
      from: [96.1, 16.8],
      to: [96.2, 16.9],
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.1, 16.8],
          [96.2, 16.9],
        ],
      },
    });
    assert.equal(fc.features.length, 0);

    const withGap = overlayConnectorsToGeoJSON({
      from: [96.1, 16.8],
      to: [96.25, 16.92],
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.12, 16.81],
          [96.22, 16.9],
        ],
      },
    });
    assert.equal(withGap.features.length, 2);
  });

  it('tags route line features for main route layer filter', () => {
    const fc = overlayToGeoJSON({
      from: null,
      to: null,
      geometry: {
        type: 'LineString',
        coordinates: [
          [96.1, 16.8],
          [96.2, 16.9],
        ],
      },
    });
    assert.equal(fc.features[0]?.properties?.kind, 'route');
  });
});

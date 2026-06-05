import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ENABLE_OVERVIEW_VIEWPORT_LOCK,
  OVERVIEW_FALLBACK_CENTER,
  OVERVIEW_FALLBACK_MIN_ZOOM,
  OVERVIEW_FALLBACK_ZOOM,
  OVERVIEW_FIT_BOUNDS,
  OVERVIEW_STARTUP_PADDING_COLLAPSED,
  OVERVIEW_STARTUP_PADDING_EXPANDED,
  PUBLIC_MAP_OVERVIEW_CENTER,
  PUBLIC_MAP_OVERVIEW_MAX_BOUNDS,
  PUBLIC_MAP_OVERVIEW_MIN_ZOOM,
  clampLngLatToPublicMapBounds,
  clampPublicMapFlyToTarget,
  clampZoomToPublicMap,
  getPublicMapInitialCamera,
  getPublicMapOverviewStartupFitPadding,
  normalizeRestoredPublicMapViewport,
  shouldFitPublicMapOverviewOnLoad,
} from './publicMapViewport.js';

describe('publicMapViewport constants', () => {
  it('matches Myanmar overview startup spec', () => {
    assert.deepEqual(OVERVIEW_FIT_BOUNDS, [
      [80.0, 5.0],
      [110.0, 32.0],
    ]);
    assert.deepEqual(PUBLIC_MAP_OVERVIEW_CENTER, [95, 18.5]);
    assert.equal(OVERVIEW_FALLBACK_ZOOM, 4.0);
    assert.equal(OVERVIEW_FALLBACK_MIN_ZOOM, 2.0);
    assert.deepEqual(PUBLIC_MAP_OVERVIEW_MAX_BOUNDS, [
      [78.0, 3.0],
      [112.0, 34.0],
    ]);
    assert.equal(OVERVIEW_STARTUP_PADDING_EXPANDED.left, 560);
    assert.equal(OVERVIEW_STARTUP_PADDING_EXPANDED.right, 72);
    assert.equal(OVERVIEW_STARTUP_PADDING_COLLAPSED.left, 120);
    assert.equal(getPublicMapOverviewStartupFitPadding(true).left, 560);
    assert.equal(getPublicMapOverviewStartupFitPadding(false).left, 120);
  });
});

describe('clampLngLatToPublicMapBounds', () => {
  it('clamps coordinates to maxBounds when viewport lock is enabled', () => {
    if (!ENABLE_OVERVIEW_VIEWPORT_LOCK) {
      assert.deepEqual(clampLngLatToPublicMapBounds(50, 50), [50, 50]);
      return;
    }
    assert.deepEqual(clampLngLatToPublicMapBounds(50, 50), [78.0, 34.0]);
    assert.deepEqual(clampLngLatToPublicMapBounds(96.2, 20.5), [96.2, 20.5]);
  });
});

describe('normalizeRestoredPublicMapViewport', () => {
  it('accepts valid restored camera', () => {
    const v = normalizeRestoredPublicMapViewport({
      center: [96.2, 20.5],
      zoom: 8,
    });
    assert.ok(v);
    assert.equal(v?.zoom, 8);
  });

  it('rejects center outside overview bounds when viewport lock is enabled', () => {
    if (!ENABLE_OVERVIEW_VIEWPORT_LOCK) {
      assert.ok(normalizeRestoredPublicMapViewport({ center: [10, 10], zoom: 6 }));
      return;
    }
    assert.equal(
      normalizeRestoredPublicMapViewport({ center: [10, 10], zoom: 6 }),
      null,
    );
  });
});

describe('getPublicMapInitialCamera', () => {
  it('defaults to fallback center and zoom when nothing restored', () => {
    const cam = getPublicMapInitialCamera();
    if (readRestoredBlocksStartupFit()) {
      return;
    }
    assert.deepEqual(cam.center, OVERVIEW_FALLBACK_CENTER);
    assert.equal(cam.zoom, OVERVIEW_FALLBACK_ZOOM);
    assert.equal(shouldFitPublicMapOverviewOnLoad(), true);
  });
});

describe('clampPublicMapFlyToTarget', () => {
  it('preserves detail zoom above minZoom', () => {
    const t = clampPublicMapFlyToTarget([96.3, 16.6], 16);
    assert.equal(t.zoom, 16);
  });

  it('raises zoom to minZoom floor', () => {
    const t = clampPublicMapFlyToTarget([96.2, 20.5], 2);
    assert.equal(
      t.zoom,
      ENABLE_OVERVIEW_VIEWPORT_LOCK ? PUBLIC_MAP_OVERVIEW_MIN_ZOOM : OVERVIEW_FALLBACK_MIN_ZOOM,
    );
  });
});

describe('clampZoomToPublicMap', () => {
  it('clamps zoom range', () => {
    assert.equal(
      clampZoomToPublicMap(2),
      ENABLE_OVERVIEW_VIEWPORT_LOCK ? PUBLIC_MAP_OVERVIEW_MIN_ZOOM : OVERVIEW_FALLBACK_MIN_ZOOM,
    );
    assert.equal(clampZoomToPublicMap(25), 20);
  });
});

function readRestoredBlocksStartupFit(): boolean {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem('coremap.public-map.viewport.v1') !== null;
  } catch {
    return false;
  }
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getSatelliteRasterConfig, isMapModeAvailable } from '../../config/mapModes.js';
import {
  validateWebBasemapLayerCoverage,
  WEB_HYBRID_ON_LAYERS,
  WEB_IMAGERY_OFF_FILL_LAYERS,
  WEB_TOGGLE_VECTOR_LAYERS,
} from './webBasemapMode.js';
import {
  normalizeMapMode,
  persistMapMode,
  readPersistedMapMode,
} from '../../config/mapModeStorage.js';

describe('getSatelliteRasterConfig', () => {
  it('defaults to Esri World Imagery when env override is unset', () => {
    const config = getSatelliteRasterConfig();
    assert.ok(config);
    assert.match(config.tilesUrl, /World_Imagery/);
    assert.equal(config.tileSize, 256);
    assert.ok(config.attribution?.includes('Esri'));
  });
});

describe('isMapModeAvailable', () => {
  it('enables all map modes when satellite config exists', () => {
    assert.equal(isMapModeAvailable('normal'), true);
    assert.equal(isMapModeAvailable('satellite'), true);
    assert.equal(isMapModeAvailable('hybrid'), true);
  });
});

describe('mapModeStorage', () => {
  it('normalizes valid persisted modes', () => {
    assert.equal(normalizeMapMode('satellite'), 'satellite');
    assert.equal(normalizeMapMode('invalid'), null);
  });

  it('reads null when localStorage is unavailable', () => {
    assert.equal(readPersistedMapMode(), null);
  });

  it('persists without throwing when localStorage is unavailable', () => {
    assert.doesNotThrow(() => persistMapMode('hybrid'));
  });
});

describe('webBasemapMode layer lists', () => {
  it('covers every overview layer id', () => {
    assert.doesNotThrow(() => validateWebBasemapLayerCoverage());
  });

  it('keeps hybrid-safe layers in the on list', () => {
    for (const id of [
      'admin-boundaries',
      'road-major-fill',
      'road-labels-major',
      'admin-labels-township',
      'overview-country-labels',
      'overview-mmr-admin1-labels',
    ]) {
      assert.ok(WEB_TOGGLE_VECTOR_LAYERS.includes(id as (typeof WEB_TOGGLE_VECTOR_LAYERS)[number]));
      assert.equal(WEB_HYBRID_ON_LAYERS.has(id), true);
    }
  });

  it('excludes medium/local roads and buildings from hybrid', () => {
    for (const id of [
      'road-medium-fill',
      'road-local-fill',
      'road-labels-medium',
      'buildings',
      'landuse',
    ]) {
      assert.equal(WEB_HYBRID_ON_LAYERS.has(id), false);
    }
  });

  it('turns off solid fills when imagery is shown', () => {
    assert.ok(WEB_IMAGERY_OFF_FILL_LAYERS.includes('background'));
    assert.ok(WEB_IMAGERY_OFF_FILL_LAYERS.includes('overview-ocean'));
  });
});

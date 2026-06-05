import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';

import {
  REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM,
  REGIONAL_VECTOR_SOURCE_MAX_ZOOM,
  patchRegionalLayersForProgressiveDetail,
} from './basemapZoomVisibility';
import { composeWebMapStyle } from './composeWebMapStyle';
import {
  REQUIRED_REGIONAL_PMTILES_SOURCE_LAYERS,
  findMissingRequiredRegionalStyleSourceLayers,
  getBasemapJsonRegionalSourceLayers,
  validateRegionalOverzoomLayerMaxZoom,
} from './regionalBasemapValidation';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const YANGON_V2_PMTILES = path.join(
  REPO_ROOT,
  'infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles',
);
const VALIDATE_SCRIPT = path.join(
  REPO_ROOT,
  'infrastructure/tiles/pmtiles/scripts/validate-regional-pmtiles-metadata.py',
);

describe('regional basemap style ↔ PMTiles contract', () => {
  it('base-map.json references all required regional source-layers', () => {
    assert.deepEqual(findMissingRequiredRegionalStyleSourceLayers(), []);
    for (const name of ['streets', 'road_labels', 'buildings', 'water_polygons', 'water_lines', 'landuse', 'admin_boundaries', 'admin_area_label_points'] as const) {
      assert.ok(getBasemapJsonRegionalSourceLayers().includes(name), name);
    }
  });

  it('patchRegionalLayersForProgressiveDetail does not cap basemap geometry below overzoom floor', () => {
    const patched = patchRegionalLayersForProgressiveDetail(BaseMapStyle.layers as never);
    assert.deepEqual(validateRegionalOverzoomLayerMaxZoom(patched), []);
    const buildings = patched.find((l) => l.id === 'buildings');
    assert.ok(
      buildings?.maxzoom === undefined || buildings.maxzoom >= REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM,
    );
    const major = patched.find((l) => l.id === 'road-major-fill');
    assert.ok(
      major?.maxzoom === undefined || major.maxzoom >= REGIONAL_LAYER_OVERZOOM_MIN_MAX_ZOOM,
    );
    const roadLabels = patched.find((l) => l.id === 'road-labels-major');
    assert.equal(roadLabels?.maxzoom, 20);
  });

  it('composeWebMapStyle keeps local-basemap source maxzoom at native z20', () => {
    const style = composeWebMapStyle(BaseMapStyle as never, 'https://cdn.example/overview.pmtiles');
    const src = style.sources?.['local-basemap'] as { maxzoom?: number; minzoom?: number } | undefined;
    assert.equal(src?.minzoom, 0);
    assert.equal(src?.maxzoom, REGIONAL_VECTOR_SOURCE_MAX_ZOOM);
  });

  it('yangon-v2.pmtiles includes required source-layers when archive exists', () => {
    if (!existsSync(YANGON_V2_PMTILES)) {
      console.warn(`skip: missing ${YANGON_V2_PMTILES} — run tiles:build yangon v2`);
      return;
    }
    execFileSync('python3', [VALIDATE_SCRIPT, YANGON_V2_PMTILES], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';

import { OVERVIEW_SOURCE_ID } from './overviewBasemap.js';
import {
  LOCAL_REGION_PMTILES_QA_ENTRIES,
  composeLocalRegionPmtilesQaWebMapStyle,
  isLoadAllLocalRegionPmtilesQaEnabled,
  regionalPmtilesQaHttpUrl,
  regionalPmtilesQaSourceId,
} from './localRegionPmtilesQa.js';

const REGIONAL_LAYER_COUNT = BaseMapStyle.layers.filter(
  (layer) => layer.id !== 'background' && 'source' in layer && layer.source === 'local-basemap',
).length;

describe('localRegionPmtilesQa', () => {
  it('builds localhost archive URLs per region/version', () => {
    assert.equal(
      regionalPmtilesQaHttpUrl('yangon', 'v2'),
      'http://localhost:8080/regions/yangon/yangon-v2.pmtiles',
    );
    assert.equal(regionalPmtilesQaSourceId('bago', 'v1'), 'local-basemap-bago-v1');
  });

  it('composes overview plus every regional source and suffixed layers', () => {
    const overviewUrl = 'http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles';
    const style = composeLocalRegionPmtilesQaWebMapStyle(overviewUrl);

    assert.ok(style.sources?.[OVERVIEW_SOURCE_ID]);
    assert.equal(
      Object.keys(style.sources ?? {}).filter((id) => id.startsWith('local-basemap-')).length,
      LOCAL_REGION_PMTILES_QA_ENTRIES.length,
    );
    assert.equal(
      style.layers?.filter((layer) => layer.id.startsWith('landuse-')).length,
      LOCAL_REGION_PMTILES_QA_ENTRIES.length,
    );
    assert.equal(
      style.layers?.filter((layer) => 'source' in layer && String(layer.source).startsWith('local-basemap-'))
        .length,
      REGIONAL_LAYER_COUNT * LOCAL_REGION_PMTILES_QA_ENTRIES.length,
    );
    assert.ok(!style.sources?.['local-basemap']);
    assert.ok(style.layers?.some((layer) => layer.id === 'landuse-yangon-v2'));
    assert.ok(style.layers?.some((layer) => layer.id === 'road-major-fill-shan-v1'));
  });

  it('keeps overview layers unchanged below regional stacks', () => {
    const style = composeLocalRegionPmtilesQaWebMapStyle('https://cdn.example/overview.pmtiles');
    const ids = style.layers?.map((layer) => layer.id) ?? [];
    const bg = ids.indexOf('background');
    const firstOverview = ids.indexOf('overview-ocean');
    const firstRegional = ids.indexOf('landuse-yangon-v2');
    assert.equal(bg, 0);
    assert.ok(firstOverview > bg);
    assert.ok(firstRegional > ids.indexOf('overview-populated-places'));
  });

  it('is disabled outside Vite dev even when env flag is set', () => {
    assert.equal(isLoadAllLocalRegionPmtilesQaEnabled(), false);
  });
});

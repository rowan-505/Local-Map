import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import BaseMapStyle from '../../../../../../../packages/map-style/base-map.json';

import { OVERVIEW_LAYER_IDS, OVERVIEW_SOURCE_ID } from './overviewBasemap.js';
import {
  REGIONAL_DETAIL_MIN_ZOOM,
  composeWebMapStyle,
  getComposedWebMapLayerIds,
} from './composeWebMapStyle.js';

const REGIONAL_LAYER_IDS = BaseMapStyle.layers.map((l) => l.id);

describe('composeWebMapStyle', () => {
  it('adds overview source with pmtiles URL from runtime env injection', () => {
    const overviewHttpUrl = 'https://cdn.example/basemaps/overview/v1/basemap.pmtiles';
    const style = composeWebMapStyle(BaseMapStyle as never, overviewHttpUrl);
    const src = style.sources?.[OVERVIEW_SOURCE_ID] as { url?: string } | undefined;
    assert.ok(src);
    assert.equal(src.url, `pmtiles://${overviewHttpUrl}`);
    assert.equal(src.url.includes('localhost'), false);
    assert.equal(src.url.includes('__OVERVIEW_PMTILES_URL__'), false);
  });

  it('places overview layers below regional layers (above background)', () => {
    const style = composeWebMapStyle(BaseMapStyle as never, 'https://cdn.example/overview.pmtiles');
    const ids = style.layers?.map((l) => l.id) ?? [];
    assert.deepEqual(ids, getComposedWebMapLayerIds(REGIONAL_LAYER_IDS));

    const bg = ids.indexOf('background');
    const firstOverview = ids.indexOf(OVERVIEW_LAYER_IDS[0]);
    const firstRegional = ids.indexOf('landuse');
    assert.equal(bg, 0);
    assert.ok(firstOverview > bg);
    assert.ok(firstRegional > ids.indexOf(OVERVIEW_LAYER_IDS[OVERVIEW_LAYER_IDS.length - 1]));
  });

  it('delays regional base layers until z7 (progressive detail)', () => {
    const style = composeWebMapStyle(BaseMapStyle as never, 'https://cdn.example/overview.pmtiles');
    const water = style.layers?.find((l) => l.id === 'water-polygons');
    assert.equal(water?.minzoom, REGIONAL_DETAIL_MIN_ZOOM);
    assert.equal(REGIONAL_DETAIL_MIN_ZOOM, 7);
  });

  it('hides overview labels by z10', () => {
    const style = composeWebMapStyle(BaseMapStyle as never, 'https://cdn.example/overview.pmtiles');
    const country = style.layers?.find((l) => l.id === 'overview-country-labels');
    assert.equal(country?.maxzoom, 10);
  });

  it('keeps regional source and layers intact', () => {
    const style = composeWebMapStyle(BaseMapStyle as never, 'https://cdn.example/overview.pmtiles');
    assert.ok(style.sources?.['local-basemap']);
    assert.ok(style.layers?.some((l) => l.id === 'road-fill'));
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import OverviewMapStyle from './overview-map.json';
import {
  OVERVIEW_PMTILES_SOURCE_LAYERS,
  OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER,
  OVERVIEW_VECTOR_SOURCE_ID,
} from './overviewConstants';
import { createOverviewStyle } from './overviewSource.js';
import {
  findLocalhostUrlsInStyle,
  findUnreferencedOverviewSourceLayers,
  getOverviewStyleLayerDefinitions,
  getOverviewVectorSourceUrl,
  validateCommittedOverviewMapJson,
  validateOverviewStyle,
} from './overviewStyleValidation.js';

describe('getOverviewStyleLayerDefinitions', () => {
  it('reads layers from overview-map.json', () => {
    const layers = getOverviewStyleLayerDefinitions();
    assert.ok(layers.length >= 10);
    assert.equal(layers[0]?.id, 'overview-ocean');
    assert.equal(layers.at(-1)?.id, 'overview-populated-places');
  });
});

describe('validateCommittedOverviewMapJson', () => {
  it('passes for the committed overview-map.json template', () => {
    const result = validateCommittedOverviewMapJson(OverviewMapStyle);
    assert.equal(
      result.ok,
      true,
      result.issues.join('\n'),
    );
  });

  it('rejects localhost URLs in committed style JSON', () => {
    const style = structuredClone(OverviewMapStyle) as typeof OverviewMapStyle;
    (style.sources.overview as { url: string }).url =
      'pmtiles://http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles';

    assert.deepEqual(findLocalhostUrlsInStyle(style).length > 0, true);

    const result = validateCommittedOverviewMapJson(style);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.includes('localhost')));
  });

  it('requires the overview PMTiles URL placeholder in committed JSON', () => {
    assert.equal(getOverviewVectorSourceUrl(OverviewMapStyle), OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER);
  });
});

describe('validateOverviewStyle', () => {
  it('passes for the committed overview-map.json', () => {
    const result = validateOverviewStyle(OverviewMapStyle);
    assert.equal(
      result.ok,
      true,
      result.issues.map((i) => i.message).join('\n'),
    );
  });

  it('requires overview vector source', () => {
    const result = validateOverviewStyle({ sources: {}, layers: [] });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === 'missing_overview_source'));
  });

  it('rejects unknown source-layer names', () => {
    const style = structuredClone(OverviewMapStyle) as typeof OverviewMapStyle;
    const layer = style.layers.find((l) => l.id === 'overview-land');
    assert.ok(layer);
    (layer as { 'source-layer'?: string })['source-layer'] = 'admin1_global';

    const result = validateOverviewStyle(style);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === 'invalid_source_layer'));
  });

  it('rejects regional OSM source-layers', () => {
    const style = structuredClone(OverviewMapStyle) as typeof OverviewMapStyle;
    style.layers = [
      ...style.layers,
      {
        id: 'overview-streets-bad',
        type: 'line',
        source: OVERVIEW_VECTOR_SOURCE_ID,
        'source-layer': 'streets',
      },
    ];

    const result = validateOverviewStyle(style);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === 'forbidden_source_layer'));
  });

  it('requires fill and line layers before symbols, with symbols on top', () => {
    const style = structuredClone(OverviewMapStyle) as typeof OverviewMapStyle;
    const symbolIdx = style.layers.findIndex((l) => l.id === 'overview-country-labels');
    const fillIdx = style.layers.findIndex((l) => l.id === 'overview-countries-fill');
    assert.ok(symbolIdx > 0 && fillIdx > 0);

    const tmp = style.layers[symbolIdx];
    style.layers[symbolIdx] = style.layers[fillIdx];
    style.layers[fillIdx] = tmp;

    const result = validateOverviewStyle(style);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === 'layer_type_order'));
  });

  it('rejects fill or line layers after symbols', () => {
    const style = structuredClone(OverviewMapStyle) as typeof OverviewMapStyle;
    style.layers.push({
      id: 'overview-bad-fill-after-labels',
      type: 'fill',
      source: OVERVIEW_VECTOR_SOURCE_ID,
      'source-layer': 'land',
    });

    const result = validateOverviewStyle(style);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.message.includes('after a symbol layer')));
  });
});

describe('overview PMTiles source-layer coverage', () => {
  it('uses only expected source-layer names', () => {
    const used = new Set(
      getOverviewStyleLayerDefinitions()
        .map((l) => l['source-layer'])
        .filter((sl): sl is string => typeof sl === 'string'),
    );

    for (const name of used) {
      assert.ok(
        (OVERVIEW_PMTILES_SOURCE_LAYERS as readonly string[]).includes(name),
        `unexpected source-layer "${name}"`,
      );
    }
  });

  it('references every expected PMTiles source-layer at least once', () => {
    const missing = findUnreferencedOverviewSourceLayers();
    assert.deepEqual(missing, [], `unreferenced: ${missing.join(', ')}`);
  });
});

describe('createOverviewStyle', () => {
  it('injects overview source URL while preserving layer stack', () => {
    const httpUrl = 'https://cdn.example/basemaps/overview/v1/myanmar-overview-v1.pmtiles';
    const style = createOverviewStyle(httpUrl);
    const source = style.sources[OVERVIEW_VECTOR_SOURCE_ID] as { url?: string };
    assert.equal(source.url, `pmtiles://${httpUrl}`);
    assert.equal(findLocalhostUrlsInStyle(style).length, 0);

    const result = validateOverviewStyle(style);
    assert.equal(result.ok, true, result.issues.map((i) => i.message).join('\n'));
  });

  it('replaces committed placeholder URL at runtime', () => {
    assert.equal(getOverviewVectorSourceUrl(OverviewMapStyle), OVERVIEW_PMTILES_SOURCE_URL_PLACEHOLDER);
    const runtime = createOverviewStyle('https://tiles.example/overview.pmtiles');
    assert.equal(
      getOverviewVectorSourceUrl(runtime),
      'pmtiles://https://tiles.example/overview.pmtiles',
    );
  });
});

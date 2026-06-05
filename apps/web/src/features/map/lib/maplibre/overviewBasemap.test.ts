import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXPECTED_OVERVIEW_SOURCE_LAYERS,
  OVERVIEW_LAYER_IDS,
  OVERVIEW_SOURCE_ID,
  createOverviewBasemapStyle,
  createOverviewLayers,
  createOverviewSource,
  validateOverviewLayerDefinitions,
} from './overviewBasemap.js';
import {
  OVERVIEW_COUNTRY_LABEL_TEXT_FIELD,
  OVERVIEW_MMR_ADMIN1_LABEL_TEXT_FIELD,
  OVERVIEW_POPULATED_PLACES_TEXT_FIELD,
} from './overviewLabelTextFields.js';
import {
  collectStepExpressions,
  validateOverviewLayerExpressions,
} from './overviewExpressionValidation.js';

const FORBIDDEN_SOURCE_LAYER_PATTERNS = [
  'road',
  'street',
  'building',
  'landuse',
  'poi',
  'bus',
  'rail',
  'transit',
] as const;

describe('OVERVIEW_SOURCE_ID', () => {
  it('is stable for MapLibre source and style wiring', () => {
    assert.equal(OVERVIEW_SOURCE_ID, 'overview');
  });
});

describe('overview layer sources', () => {
  const layers = createOverviewLayers();

  it('assigns source "overview" on every layer', () => {
    for (const layer of layers) {
      assert.equal(layer.source, OVERVIEW_SOURCE_ID, `layer ${layer.id}`);
    }
  });

  it('uses only expected PMTiles source-layer names', () => {
    const allowed = new Set<string>(EXPECTED_OVERVIEW_SOURCE_LAYERS);
    for (const layer of layers) {
      const sl = 'source-layer' in layer ? layer['source-layer'] : undefined;
      assert.equal(typeof sl, 'string', `layer ${layer.id} missing source-layer`);
      assert.ok(allowed.has(sl!), `layer ${layer.id} unexpected source-layer ${sl}`);
    }
  });

  it('references each expected source-layer at least once', () => {
    const used = new Set(
      layers
        .map((l) => ('source-layer' in l ? l['source-layer'] : undefined))
        .filter((sl): sl is string => typeof sl === 'string'),
    );
    for (const name of EXPECTED_OVERVIEW_SOURCE_LAYERS) {
      assert.ok(used.has(name), `missing source-layer ${name}`);
    }
    assert.equal(used.size, EXPECTED_OVERVIEW_SOURCE_LAYERS.length);
  });

  it('does not reference regional OSM source-layers (roads, buildings, POI, bus, rail)', () => {
    for (const layer of layers) {
      const sl = String(('source-layer' in layer && layer['source-layer']) || '').toLowerCase();
      for (const pattern of FORBIDDEN_SOURCE_LAYER_PATTERNS) {
        assert.ok(
          !sl.includes(pattern),
          `layer ${layer.id} source-layer "${sl}" must not match "${pattern}"`,
        );
      }
    }
  });
});

describe('overview label text-field', () => {
  const layers = createOverviewLayers();

  it('matches shared overview expressions used by localization', () => {
    const country = layers.find((l) => l.id === 'overview-country-labels');
    const admin1 = layers.find((l) => l.id === 'overview-mmr-admin1-labels');
    const places = layers.find((l) => l.id === 'overview-populated-places');
    assert.deepEqual(country?.layout?.['text-field'], OVERVIEW_COUNTRY_LABEL_TEXT_FIELD);
    assert.deepEqual(admin1?.layout?.['text-field'], OVERVIEW_MMR_ADMIN1_LABEL_TEXT_FIELD);
    assert.deepEqual(places?.layout?.['text-field'], OVERVIEW_POPULATED_PLACES_TEXT_FIELD);
  });

  it('boundary line-opacity uses top-level interpolate or constant (no nested zoom)', () => {
    for (const id of ['overview-coastline', 'myanmar-internal-admin-boundary-line'] as const) {
      const opacity = layers.find((l) => l.id === id)?.paint?.['line-opacity'];
      assert.ok(Array.isArray(opacity) && opacity[0] === 'interpolate');
      assert.equal(JSON.stringify(opacity).includes('"*"'), false);
    }
    const neighbor = layers.find((l) => l.id === 'neighbor-country-boundary-line');
    assert.equal((neighbor?.paint?.['line-opacity'] as unknown[])?.[0], 'interpolate');
    const admin0 = layers.find((l) => l.id === 'myanmar-admin0-boundary-line-z56');
    assert.equal((admin0?.paint?.['line-opacity'] as unknown[])?.[0], 'interpolate');
    const casing = layers.find((l) => l.id === 'myanmar-admin0-boundary-casing-z56');
    assert.equal((casing?.paint?.['line-opacity'] as unknown[])?.[0], 'interpolate');
    const casingWidth = casing?.paint?.['line-width'];
    assert.ok(Array.isArray(casingWidth) && casingWidth[0] === 'interpolate');
    assert.equal(JSON.stringify(casingWidth).includes('"+"'), false);
  });

  it('paints Myanmar admin0 above neighbor and internal boundaries', () => {
    const ids = layers.map((l) => l.id);
    assert.ok(
      ids.indexOf('neighbor-country-boundary-line') < ids.indexOf('myanmar-admin0-boundary-casing-z02'),
      'neighbor boundaries below Myanmar admin0 casing',
    );
    assert.ok(
      ids.indexOf('myanmar-internal-admin-boundary-line') < ids.indexOf('myanmar-admin0-boundary-line-z56'),
      'internal admin boundaries below Myanmar admin0 line',
    );
    assert.ok(
      ids.indexOf('myanmar-admin0-boundary-casing-z56') < ids.indexOf('myanmar-admin0-boundary-line-z56'),
      'casing below main Myanmar admin0 line',
    );
    assert.ok(
      ids.indexOf('myanmar-admin0-boundary-line-z56') < ids.indexOf('overview-country-labels'),
      'Myanmar admin0 line below labels',
    );
  });

  it('Myanmar admin0 uses zoom-tier source-layers and hides at z7', () => {
    const tiers = [
      { line: 'myanmar-admin0-boundary-line-z02', casing: 'myanmar-admin0-boundary-casing-z02', sl: 'mmr_admin0_z0_2', min: 0, max: 3 },
      { line: 'myanmar-admin0-boundary-line-z34', casing: 'myanmar-admin0-boundary-casing-z34', sl: 'mmr_admin0_z3_4', min: 3, max: 5 },
      { line: 'myanmar-admin0-boundary-line-z56', casing: 'myanmar-admin0-boundary-casing-z56', sl: 'mmr_admin0_z5_6', min: 5, max: 7 },
    ] as const;
    for (const tier of tiers) {
      const line = layers.find((l) => l.id === tier.line);
      const casing = layers.find((l) => l.id === tier.casing);
      assert.equal(line?.['source-layer'], tier.sl);
      assert.equal(casing?.['source-layer'], tier.sl);
      assert.equal(line?.minzoom, tier.min);
      assert.equal(line?.maxzoom, tier.max);
      assert.equal(casing?.maxzoom, tier.max);
    }
    const admin0 = JSON.stringify(
      layers.find((l) => l.id === 'myanmar-admin0-boundary-line-z56')?.paint?.['line-width'],
    );
    const casingWidth = JSON.stringify(
      layers.find((l) => l.id === 'myanmar-admin0-boundary-casing-z56')?.paint?.['line-width'],
    );
    assert.ok(admin0.includes('0,0.9') && admin0.includes('6,1.65'));
    assert.ok(casingWidth.includes('0,1.4') && casingWidth.includes('6,2.2'));
    assert.equal(
      layers.find((l) => l.id === 'myanmar-admin0-boundary-line-z56')?.paint?.['line-color'],
      '#5f5478',
    );
    assert.equal(layers.find((l) => l.id === 'myanmar-internal-admin-boundary-line')?.minzoom, 3);
    assert.equal(layers.find((l) => l.id === 'myanmar-internal-admin-boundary-line')?.maxzoom, 10);
  });

  it('country and place labels do not use regional-only name_mm/name_en fields', () => {
    for (const id of ['overview-country-labels', 'overview-populated-places'] as const) {
      const json = JSON.stringify(layers.find((l) => l.id === id)?.layout?.['text-field']);
      assert.equal(json.includes('"name_mm"'), false);
      assert.equal(json.includes('"name_en"'), false);
    }
  });
});

describe('overview layer expressions', () => {
  const layers = createOverviewLayers();

  it('has no malformed step/match filters or invalid fill-color paints', () => {
    assert.deepEqual(validateOverviewLayerExpressions(layers), []);
  });

  it('does not use zoom step expressions in lakes or rivers filters', () => {
    for (const id of ['overview-lakes', 'overview-rivers'] as const) {
      const layer = layers.find((l) => l.id === id);
      assert.ok(layer && 'filter' in layer && layer.filter !== undefined);
      const steps = collectStepExpressions(layer.filter);
      assert.equal(steps.length, 0, `${id} filter must not contain step`);
    }
  });

  it('uses ascending step stops when any overview filter contains step', () => {
    for (const layer of layers) {
      if (!('filter' in layer) || layer.filter === undefined) continue;
      const issues = validateOverviewLayerExpressions([layer]);
      assert.deepEqual(issues, [], `layer ${layer.id}`);
    }
  });

  it('uses hex or interpolate fill-color on mmr_admin1 fill', () => {
    const admin1 = layers.find((l) => l.id === 'overview-mmr-admin1-fill');
    assert.ok(admin1 && admin1.type === 'fill');
    const color = admin1.paint?.['fill-color'];
    assert.ok(
      typeof color === 'string' || (Array.isArray(color) && color[0] === 'interpolate'),
      'fill-color must be string or interpolate expression',
    );
  });
});

describe('overview layer paint order', () => {
  const layers = createOverviewLayers();

  it('places first fill before first line', () => {
    const paint = layers.filter((l) => l.type === 'fill' || l.type === 'line' || l.type === 'symbol');
    const firstFill = paint.findIndex((l) => l.type === 'fill');
    const firstLine = paint.findIndex((l) => l.type === 'line');
    assert.ok(firstFill >= 0 && firstLine >= 0);
    assert.ok(firstFill < firstLine, 'first fill must come before first line');
  });

  it('places symbol layers after fills and lines', () => {
    const paint = layers.filter((l) => l.type === 'fill' || l.type === 'line' || l.type === 'symbol');
    const firstSymbol = paint.findIndex((l) => l.type === 'symbol');
    assert.ok(firstSymbol > 0);
    const beforeSymbols = paint.slice(0, firstSymbol);
    assert.ok(beforeSymbols.some((l) => l.type === 'fill'));
    assert.ok(beforeSymbols.some((l) => l.type === 'line'));
    assert.ok(!paint.slice(firstSymbol + 1).some((l) => l.type === 'fill' || l.type === 'line'));
  });

  it('passes validateOverviewLayerDefinitions with no issues', () => {
    assert.deepEqual(validateOverviewLayerDefinitions(layers), []);
  });
});

describe('overview layer ids', () => {
  it('returns stable ordered layer ids', () => {
    assert.deepEqual(
      createOverviewLayers().map((l) => l.id),
      [...OVERVIEW_LAYER_IDS],
    );
  });

  it('has no OSM-style layer ids', () => {
    for (const id of OVERVIEW_LAYER_IDS) {
      assert.ok(!id.includes('road'), id);
      assert.ok(!id.includes('building'), id);
      assert.ok(!id.includes('street'), id);
      assert.ok(!/poi|bus|rail/i.test(id), id);
    }
  });
});

describe('createOverviewSource', () => {
  it('uses source id overview and pmtiles scheme URL', () => {
    const src = createOverviewSource('https://cdn.example/basemaps/overview/v1/basemap.pmtiles');
    assert.equal(src.type, 'vector');
    assert.equal((src as { url: string }).url, 'pmtiles://https://cdn.example/basemaps/overview/v1/basemap.pmtiles');
    assert.equal((src as { maxzoom: number }).maxzoom, 8);
  });

  it('builds runtime URL from VITE_OVERVIEW_PMTILES_URL shape without localhost', () => {
    const envUrl =
      'https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/overview/v1/myanmar-overview-v1.pmtiles';
    const src = createOverviewSource(envUrl);
    assert.equal((src as { url: string }).url, `pmtiles://${envUrl}`);
    assert.equal((src as { url: string }).url.includes('localhost'), false);
  });
});

describe('createOverviewBasemapStyle', () => {
  it('wires overview source and layers', () => {
    const style = createOverviewBasemapStyle('https://cdn.example/overview.pmtiles');
    assert.equal(style.version, 8);
    assert.ok(style.sources?.[OVERVIEW_SOURCE_ID]);
    assert.equal(style.layers?.length, OVERVIEW_LAYER_IDS.length);
  });
});

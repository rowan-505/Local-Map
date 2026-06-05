import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ROAD_LABEL_LAYER_IDS,
  getRoadLabelTextField,
  isRoadLabelLayerId,
  roadLabelTextFieldExpression,
} from './roadLabelTextFields.js';

describe('road label text-field (PMTiles road_labels only)', () => {
  it('registers all basemap road label layer ids', () => {
    assert.ok(ROAD_LABEL_LAYER_IDS.includes('road-labels-major'));
    assert.ok(ROAD_LABEL_LAYER_IDS.includes('road-labels-medium'));
    assert.ok(ROAD_LABEL_LAYER_IDS.includes('road-labels-local'));
    assert.equal(isRoadLabelLayerId('road-major-fill'), false);
  });

  it('myanmar mode prefers name_mm, then name, then name_en', () => {
    const expr = roadLabelTextFieldExpression('my');
    assert.deepEqual(expr, ['coalesce', ['get', 'name_mm'], ['get', 'name'], ['get', 'name_en']]);
    assert.ok(!JSON.stringify(expr).includes('canonical_name'));
  });

  it('english mode prefers name_en, then name, then name_mm', () => {
    const expr = roadLabelTextFieldExpression('en');
    assert.deepEqual(expr, ['coalesce', ['get', 'name_en'], ['get', 'name'], ['get', 'name_mm']]);
  });

  it('getRoadLabelTextField returns null for non-road layers', () => {
    assert.equal(getRoadLabelTextField('admin-labels-township', 'en'), null);
    assert.deepEqual(
      getRoadLabelTextField('road-labels-local', 'en'),
      roadLabelTextFieldExpression('en'),
    );
  });
});

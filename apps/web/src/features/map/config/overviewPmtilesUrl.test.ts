import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  validateOverviewPmtilesHttpUrl,
} from './overviewPmtilesUrl.js';

describe('validateOverviewPmtilesHttpUrl', () => {
  it('accepts local and hosted http(s) pmtiles URLs', () => {
    assert.equal(
      validateOverviewPmtilesHttpUrl(
        'http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles',
      ).ok,
      true,
    );
    assert.equal(
      validateOverviewPmtilesHttpUrl(
        'https://cdn.example/basemaps/overview/v1/basemap.pmtiles',
      ).ok,
      true,
    );
  });

  it('rejects non-http schemes', () => {
    const result = validateOverviewPmtilesHttpUrl('file:///tmp/x.pmtiles');
    assert.equal(result.ok, false);
  });

  it('rejects URLs without pmtiles path', () => {
    const result = validateOverviewPmtilesHttpUrl('https://cdn.example/tiles/style.json');
    assert.equal(result.ok, false);
  });
});

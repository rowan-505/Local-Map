import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PublicSearchResult } from './publicMapApi';
import { flattenPublicSearchPages } from './publicSearchPages';

function makeResult(id: string): PublicSearchResult {
  return {
    id,
    type: 'place',
    entityType: 'place',
    entityId: id,
    publicId: null,
    displayName: id,
    name: id,
    lat: 16,
    lng: 96,
    center: [96, 16],
    bbox: null,
    hasGeometry: true,
    mode: null,
    stopType: null,
    reviewStatus: null,
    verificationStatus: null,
    score: 1,
    plusCode: null,
    reverseAddress: null,
    cameraTarget: undefined,
  };
}

describe('flattenPublicSearchPages', () => {
  it('appends pages in order and deduplicates by id', () => {
    const merged = flattenPublicSearchPages([
      { items: [makeResult('1'), makeResult('2')] },
      { items: [makeResult('2'), makeResult('3')] },
    ]);
    assert.deepEqual(merged.map((row) => row.id), ['1', '2', '3']);
  });
});

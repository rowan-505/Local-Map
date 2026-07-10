import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PublicSearchResult } from './publicMapApi';
import { PublicMapApiError } from './publicMapApiError';
import { formatPublicSearchGeoKey, publicSearchGeoBiasFromKey } from './publicSearchGeoBias';
import { flattenPublicSearchPages } from './publicSearchPages';
import {
  shouldAutoLoadMorePublicSearch,
  shouldRetryPublicSearch,
} from './publicSearchRetry';

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

describe('public search geo-bias session keys', () => {
  it('uses the rounded query-key coordinates as the request coordinates', () => {
    const geoKey = formatPublicSearchGeoKey({ lat: 16.84041, lng: 96.17349 });

    assert.equal(geoKey, '16.84,96.173');
    assert.deepEqual(publicSearchGeoBiasFromKey(geoKey), {
      lat: 16.84,
      lng: 96.173,
    });
  });
});

describe('public search infinite-query retry policy', () => {
  it('does not retry deterministic client errors', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(
        shouldRetryPublicSearch(0, new PublicMapApiError(status, `HTTP ${status}`)),
        false,
      );
    }
  });

  it('does not retry aborted requests or rate limits automatically', () => {
    assert.equal(shouldRetryPublicSearch(0, new DOMException('cancelled', 'AbortError')), false);
    assert.equal(shouldRetryPublicSearch(0, new PublicMapApiError(429, 'Too many requests')), false);
  });

  it('retries 5xx and network failures only within the limited retry budget', () => {
    assert.equal(shouldRetryPublicSearch(0, new PublicMapApiError(500, 'Server error')), true);
    assert.equal(shouldRetryPublicSearch(1, new PublicMapApiError(503, 'Unavailable')), true);
    assert.equal(shouldRetryPublicSearch(2, new PublicMapApiError(503, 'Unavailable')), false);

    assert.equal(shouldRetryPublicSearch(0, new TypeError('NetworkError')), true);
    assert.equal(shouldRetryPublicSearch(1, new TypeError('NetworkError')), true);
    assert.equal(shouldRetryPublicSearch(2, new TypeError('NetworkError')), false);
  });

  it('keeps already-loaded pages visible after a failed next page', () => {
    const merged = flattenPublicSearchPages([
      { items: [makeResult('1'), makeResult('2')] },
      { items: [makeResult('3')] },
    ]);

    assert.deepEqual(merged.map((row) => row.id), ['1', '2', '3']);
  });

  it('prevents automatic load-more storms until manual retry clears the error state', () => {
    assert.equal(
      shouldAutoLoadMorePublicSearch({
        hasMoreSearch: true,
        searchReachedCap: false,
        searchLoadingMore: false,
        searchFetchMoreError: true,
      }),
      false,
    );

    assert.equal(
      shouldAutoLoadMorePublicSearch({
        hasMoreSearch: true,
        searchReachedCap: false,
        searchLoadingMore: false,
        searchFetchMoreError: false,
      }),
      true,
    );
  });
});

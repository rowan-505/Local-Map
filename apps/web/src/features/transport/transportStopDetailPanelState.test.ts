import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TransportStopDetail } from '@/types';
import type { TransportMapSelection } from './transportMapSelection.js';
import {
  isTransportStopDetailNotFoundError,
  resolveTransportStopDetailPanelState,
} from './transportStopDetailPanelState.js';

function httpError(status: number, message: string): Error {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function previewDetail(): TransportStopDetail {
  return {
    id: '1',
    publicId: 'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
    name: 'Tile Stop',
    nameMm: null,
    nameEn: 'Tile Stop',
    nameUnd: null,
    myanmarName: null,
    englishName: 'Tile Stop',
    displayName: 'Tile Stop',
    primaryName: 'Tile Stop',
    canonicalName: null,
    stopCode: null,
    mode: 'bus',
    stopType: 'bus_stop',
    adminAreaName: null,
    latitude: 16.91,
    longitude: 96.09,
    isVerified: false,
    confidenceScore: null,
    routeCount: 0,
  };
}

function apiDetail(): TransportStopDetail {
  return {
    ...previewDetail(),
    name: 'API Stop',
    displayName: 'API Stop',
    adminAreaName: 'Kyauktan',
    routeCount: 2,
    routesServingThisStop: [],
  };
}

function stopSelection(
  overrides: Partial<TransportMapSelection> = {},
): TransportMapSelection {
  const preview = previewDetail();
  return {
    lookupId: preview.publicId,
    apiLookupId: preview.publicId,
    kind: 'stop',
    coordinates: [96.09, 16.91],
    highlight: {
      id: preview.publicId,
      coordinates: [96.09, 16.91],
      kind: 'stop',
      label: preview.name,
      nameMm: null,
      nameEn: preview.nameEn,
    },
    preview,
    ...overrides,
  };
}

describe('resolveTransportStopDetailPanelState', () => {
  it('returns idle without a selection', () => {
    assert.equal(resolveTransportStopDetailPanelState({
      selection: null,
      apiDetail: undefined,
      loading: false,
      fetched: false,
      error: null,
    }).kind, 'idle');
  });

  it('returns loading while API detail is in flight', () => {
    const state = resolveTransportStopDetailPanelState({
      selection: stopSelection(),
      apiDetail: undefined,
      loading: true,
      fetched: false,
      error: null,
    });
    assert.equal(state.kind, 'loading');
  });

  it('returns loaded when API detail is present', () => {
    const state = resolveTransportStopDetailPanelState({
      selection: stopSelection(),
      apiDetail: apiDetail(),
      loading: false,
      fetched: true,
      error: null,
    });
    assert.equal(state.kind, 'loaded');
    if (state.kind === 'loaded') {
      assert.equal(state.detail.name, 'API Stop');
    }
  });

  it('returns not_found on 404 after fetch completes', () => {
    const state = resolveTransportStopDetailPanelState({
      selection: stopSelection(),
      apiDetail: undefined,
      loading: false,
      fetched: true,
      error: httpError(404, 'Stop not found'),
    });
    assert.equal(state.kind, 'not_found');
  });

  it('returns network_error on non-404 failures', () => {
    const state = resolveTransportStopDetailPanelState({
      selection: stopSelection(),
      apiDetail: undefined,
      loading: false,
      fetched: true,
      error: httpError(503, 'Service unavailable'),
    });
    assert.equal(state.kind, 'network_error');
  });

  it('returns preview_only when no API lookup id exists', () => {
    const state = resolveTransportStopDetailPanelState({
      selection: stopSelection({ apiLookupId: null, kind: 'terminal' }),
      apiDetail: undefined,
      loading: false,
      fetched: false,
      error: null,
    });
    assert.equal(state.kind, 'preview_only');
  });
});

describe('isTransportStopDetailNotFoundError', () => {
  it('detects HTTP 404 errors', () => {
    assert.equal(isTransportStopDetailNotFoundError(httpError(404, 'missing')), true);
    assert.equal(isTransportStopDetailNotFoundError(httpError(500, 'boom')), false);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveTransportStopApiLookupId,
  resolveTransportStopLookupId,
} from './transportStopLookup.js';

describe('resolveTransportStopLookupId', () => {
  it('prefers public_id from tile properties', () => {
    assert.equal(
      resolveTransportStopLookupId({
        public_id: 'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
        id: 19370,
      }),
      'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
    );
  });

  it('falls back to MapLibre feature id when properties are empty', () => {
    assert.equal(resolveTransportStopLookupId({}, 17600), '17600');
  });
});

describe('resolveTransportStopApiLookupId', () => {
  it('prefers numeric tile id for API lookup', () => {
    assert.equal(
      resolveTransportStopApiLookupId(
        {
          public_id: 'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
          id: 19370,
        },
        19370,
      ),
      '19370',
    );
  });

  it('uses feature id when properties omit id/public_id', () => {
    assert.equal(resolveTransportStopApiLookupId({}, 8441), '8441');
  });

  it('falls back to public_id uuid only when no numeric id is available', () => {
    assert.equal(
      resolveTransportStopApiLookupId({
        public_id: 'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
      }),
      'b441f97a-3a4b-43cb-8a16-1ce88869a1aa',
    );
  });

  it('returns null instead of guessing a non-numeric, non-uuid id', () => {
    assert.equal(
      resolveTransportStopApiLookupId({ public_id: 'not-a-uuid' }, 'also-not-valid'),
      null,
    );
  });

  it('returns null when there is no usable identifier', () => {
    assert.equal(resolveTransportStopApiLookupId({}), null);
  });
});

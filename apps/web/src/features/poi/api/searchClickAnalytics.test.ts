import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PublicSearchResult } from './publicMapApi';
import {
  buildPublicSearchClickAnalyticsBody,
  computePublicSearchClickedRank,
  recordPublicSearchResultClick,
  resolvePublicSearchAnalyticsEventId,
} from './searchClickAnalytics';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function makeResult(id: string, entityType: PublicSearchResult['entityType'] = 'place'): PublicSearchResult {
  return {
    id,
    type: entityType,
    entityType,
    entityId: id,
    displayName: id,
    display_name: id,
  };
}

describe('computePublicSearchClickedRank', () => {
  const page1 = Array.from({ length: 20 }, (_, index) => makeResult(String(index + 1)));
  const page2 = [makeResult('21')];
  const merged = [...page1, ...page2];

  it('uses 1-based rank on the first page', () => {
    assert.equal(computePublicSearchClickedRank(merged, makeResult('1')), 1);
    assert.equal(computePublicSearchClickedRank(merged, makeResult('20')), 20);
  });

  it('continues rank across lazy-loaded pages', () => {
    assert.equal(computePublicSearchClickedRank(merged, makeResult('21')), 21);
  });
});

describe('buildPublicSearchClickAnalyticsBody', () => {
  it('builds canonical entity type and numeric entity id', () => {
    const body = buildPublicSearchClickAnalyticsBody({
      eventId: EVENT_ID,
      result: makeResult('42', 'transport_stop'),
      clickedRank: 3,
      searchStartedAtMs: 1_000,
    }, 2_500);

    assert.deepEqual(body, {
      event_id: EVENT_ID,
      entity_type: 'transport_stop',
      entity_id: '42',
      clicked_rank: 3,
      time_to_click_ms: 1_500,
    });
  });

  it('returns null when correlation id is missing', () => {
    const body = buildPublicSearchClickAnalyticsBody({
      eventId: null,
      result: makeResult('1'),
      clickedRank: 1,
    });
    assert.equal(body, null);
  });

  it('returns null for non-numeric entity ids (plus_code / coordinate pins)', () => {
    const body = buildPublicSearchClickAnalyticsBody({
      eventId: EVENT_ID,
      result: {
        ...makeResult('plus:abc', 'plus_code'),
        entityId: 'plus:abc',
      },
      clickedRank: 1,
    });
    assert.equal(body, null);
  });
});

describe('resolvePublicSearchAnalyticsEventId', () => {
  it('reads event id from the first page only', () => {
    const eventId = resolvePublicSearchAnalyticsEventId([
      { analytics: { eventId: EVENT_ID } },
      { analytics: undefined },
    ]);
    assert.equal(eventId, EVENT_ID);
  });
});

describe('recordPublicSearchResultClick', () => {
  it('posts one click event and never throws when post fails', () => {
    let calls = 0;
    recordPublicSearchResultClick({
      eventId: EVENT_ID,
      result: makeResult('9'),
      clickedRank: 2,
      postClick: async () => {
        calls += 1;
        throw new Error('network down');
      },
    });
    assert.equal(calls, 1);
  });

  it('does not post when correlation id is missing', () => {
    let calls = 0;
    recordPublicSearchResultClick({
      eventId: null,
      result: makeResult('9'),
      clickedRank: 1,
      postClick: async () => {
        calls += 1;
      },
    });
    assert.equal(calls, 0);
  });

  it('does not double-post from a single record call', () => {
    let calls = 0;
    recordPublicSearchResultClick({
      eventId: EVENT_ID,
      result: makeResult('5'),
      clickedRank: 5,
      postClick: async () => {
        calls += 1;
      },
    });
    assert.equal(calls, 1);
  });
});

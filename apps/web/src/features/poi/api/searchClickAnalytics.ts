import type { PublicSearchPage, PublicSearchResult, SearchEntityType } from './publicMapApi';

const SEARCH_CLICK_ANALYTICS_PATH = '/public/search/analytics/clicks';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NUMERIC_ENTITY_ID_RE = /^\d+$/;

export type PublicSearchClickAnalyticsBody = {
  readonly event_id: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly clicked_rank: number;
  readonly time_to_click_ms?: number;
};

export type RecordPublicSearchResultClickInput = {
  readonly eventId: string | null | undefined;
  readonly result: PublicSearchResult;
  readonly clickedRank: number | null | undefined;
  readonly searchStartedAtMs?: number | null;
  /** Test hook — defaults to fire-and-forget POST. */
  readonly postClick?: (body: PublicSearchClickAnalyticsBody) => Promise<void>;
};

export function isPublicSearchAnalyticsEventId(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && UUID_RE.test(trimmed);
}

/** First-page search responses carry analytics.eventId; pagination pages omit it. */
export function resolvePublicSearchAnalyticsEventId(
  pages: ReadonlyArray<Pick<PublicSearchPage, 'analytics'>> | undefined,
): string | null {
  if (!pages || pages.length === 0) return null;

  for (const page of pages) {
    const eventId = page.analytics?.eventId?.trim();
    if (isPublicSearchAnalyticsEventId(eventId)) {
      return eventId;
    }
  }

  return null;
}

/** Global 1-based rank across flattened, deduped infinite-search pages. */
export function computePublicSearchClickedRank(
  results: readonly PublicSearchResult[],
  result: PublicSearchResult,
): number | null {
  const index = results.findIndex((row) => row.id === result.id);
  if (index < 0) return null;
  return index + 1;
}

export function clampPublicSearchClickedRank(rank: number): number {
  if (!Number.isFinite(rank)) return 1;
  return Math.max(1, Math.min(100, Math.floor(rank)));
}

export function normalizeSearchClickAnalyticsEntityType(entityType: SearchEntityType): string {
  switch (entityType) {
    case 'bus_stop':
      return 'transport_stop';
    case 'bus_route':
      return 'transport_route';
    case 'bus_route_variant':
      return 'transport_route_variant';
    default:
      return entityType;
  }
}

/** Backend click analytics only accepts numeric database entity ids. */
export function resolveSearchClickAnalyticsEntityId(
  result: PublicSearchResult,
): string | null {
  const raw = result.entityId?.trim();
  if (!raw || !NUMERIC_ENTITY_ID_RE.test(raw)) {
    return null;
  }
  return raw;
}

export function computeSearchTimeToClickMs(
  searchStartedAtMs: number | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  if (searchStartedAtMs === null || searchStartedAtMs === undefined) {
    return undefined;
  }
  if (!Number.isFinite(searchStartedAtMs) || searchStartedAtMs <= 0) {
    return undefined;
  }

  const elapsed = Math.round(nowMs - searchStartedAtMs);
  if (elapsed < 0) return undefined;
  // Match API clamp (30 minutes).
  return Math.min(elapsed, 30 * 60 * 1000);
}

export function buildPublicSearchClickAnalyticsBody(
  input: RecordPublicSearchResultClickInput,
  nowMs: number = Date.now(),
): PublicSearchClickAnalyticsBody | null {
  const eventId = input.eventId?.trim();
  if (!isPublicSearchAnalyticsEventId(eventId)) {
    return null;
  }

  if (input.clickedRank === null || input.clickedRank === undefined) {
    return null;
  }

  const entityId = resolveSearchClickAnalyticsEntityId(input.result);
  if (!entityId) {
    return null;
  }

  const timeToClickMs = computeSearchTimeToClickMs(input.searchStartedAtMs, nowMs);
  const body: PublicSearchClickAnalyticsBody = {
    event_id: eventId,
    entity_type: normalizeSearchClickAnalyticsEntityType(input.result.entityType),
    entity_id: entityId,
    clicked_rank: clampPublicSearchClickedRank(input.clickedRank),
  };

  if (timeToClickMs !== undefined) {
    return { ...body, time_to_click_ms: timeToClickMs };
  }

  return body;
}

function getApiBaseUrl(): string | null {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  return raw.replace(/\/+$/, '');
}

async function defaultPostSearchClick(body: PublicSearchClickAnalyticsBody): Promise<void> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return;

  const response = await fetch(`${baseUrl}${SEARCH_CLICK_ANALYTICS_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  });

  if (!response.ok) {
    throw new Error(`search click analytics failed: ${response.status}`);
  }
}

/**
 * Fire-and-forget search result click analytics. Never throws to callers.
 */
export function recordPublicSearchResultClick(input: RecordPublicSearchResultClickInput): void {
  const body = buildPublicSearchClickAnalyticsBody(input);
  if (!body) return;

  const post = input.postClick ?? defaultPostSearchClick;
  void post(body).catch(() => {
    // Analytics must never affect map UX.
  });
}

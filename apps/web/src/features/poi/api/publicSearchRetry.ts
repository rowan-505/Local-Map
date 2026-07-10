import { PublicMapApiError } from './publicMapApiError';

const NON_RETRYABLE_PUBLIC_SEARCH_STATUSES = new Set([400, 401, 403, 404, 422]);
const MAX_PUBLIC_SEARCH_RETRIES = 2;

export function isAbortError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError';
}

export function publicSearchErrorStatus(error: unknown): number | null {
  if (error instanceof PublicMapApiError) return error.status;
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isFinite(status) ? status : null;
}

export function shouldRetryPublicSearch(failureCount: number, error: unknown): boolean {
  if (isAbortError(error)) return false;
  const status = publicSearchErrorStatus(error);
  if (status !== null) {
    if (NON_RETRYABLE_PUBLIC_SEARCH_STATUSES.has(status)) return false;
    if (status === 429) return false;
    if (status < 500) return false;
  }
  return failureCount < MAX_PUBLIC_SEARCH_RETRIES;
}

export function publicSearchRetryDelay(attemptIndex: number): number {
  return Math.min(500 * 2 ** attemptIndex, 2_000);
}

export function shouldAutoLoadMorePublicSearch(input: {
  hasMoreSearch: boolean;
  searchReachedCap: boolean;
  searchLoadingMore: boolean;
  searchFetchMoreError: boolean;
}): boolean {
  return (
    input.hasMoreSearch &&
    !input.searchReachedCap &&
    !input.searchLoadingMore &&
    !input.searchFetchMoreError
  );
}

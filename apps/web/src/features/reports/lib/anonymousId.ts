/**
 * Stable per-browser identifier for anonymous (guest) report submissions.
 *
 * Persisted in localStorage so a guest's reports can be grouped server-side
 * (rate limiting + duplicate detection key by anonymous_id). It is NOT a login
 * and grants no rewards — anonymous reports never earn points.
 */
const ANONYMOUS_ID_KEY = 'coremap_anonymous_id';

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID.
  return `anon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Returns the existing anonymous id, creating and persisting one on first use. */
export function getOrCreateAnonymousId(): string {
  if (!hasWindow()) {
    return randomId();
  }

  const existing = window.localStorage.getItem(ANONYMOUS_ID_KEY);
  if (existing && existing.trim() !== '') {
    return existing;
  }

  const created = randomId();
  window.localStorage.setItem(ANONYMOUS_ID_KEY, created);
  return created;
}

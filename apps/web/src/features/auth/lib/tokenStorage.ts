/**
 * Token storage for the public web app.
 *
 * MVP convention: persist the access + refresh tokens in localStorage, matching
 * the dashboard's existing `accessToken` key. This is intentionally simple so the
 * public map keeps working offline-friendly without an auth backend round trip.
 *
 * TODO(auth-cookie): move the refresh token to an httpOnly, Secure cookie issued
 * by the API so it is not readable from JS. The access token can stay in memory
 * with a short TTL. Until then we accept the XSS risk of localStorage for MVP.
 */

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

export type StoredTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

function hasWindow(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getAccessToken(): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(tokens: StoredTokens): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function hasStoredSession(): boolean {
  return getAccessToken() !== null && getRefreshToken() !== null;
}

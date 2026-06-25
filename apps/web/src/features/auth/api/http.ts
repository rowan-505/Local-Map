/**
 * Authenticated HTTP layer for the public web app.
 *
 * Wraps `fetch` with the API base URL, bearer access token, JSON handling and a
 * single transparent refresh-token retry on 401. Unauthenticated public calls
 * keep using the existing `publicMapApi` fetcher; this layer is only for the
 * logged-in surfaces (account, saved places, email verification).
 */
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from '../lib/tokenStorage';
import type { SessionResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function getApiBaseUrl(): string {
  if (typeof API_BASE_URL !== 'string' || API_BASE_URL.trim() === '') {
    throw new Error('Missing VITE_API_BASE_URL');
  }

  return API_BASE_URL.replace(/\/+$/, '');
}

/** Listeners notified when the session is cleared (refresh failed / logout). */
const sessionClearedListeners = new Set<() => void>();

export function onSessionCleared(listener: () => void): () => void {
  sessionClearedListeners.add(listener);
  return () => sessionClearedListeners.delete(listener);
}

function notifySessionCleared(): void {
  clearTokens();
  for (const listener of sessionClearedListeners) {
    listener();
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body?.message === 'string' && body.message.trim() !== '') {
      message = body.message;
    }
  } catch {
    // Non-JSON error body; keep the generic message.
  }
  return new ApiError(response.status, message);
}

/** Plain (no bearer) JSON POST used by auth endpoints that issue/replace tokens. */
export async function publicJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await parseError(response);
  }

  return response.json() as Promise<T>;
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const session = await publicJson<SessionResponse>('/auth/refresh', {
          refreshToken,
        });
        setTokens({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        });
        return session.accessToken;
      } catch {
        notifySessionCleared();
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

type AuthFetchOptions = {
  readonly method?: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
};

/** Authenticated JSON request with one transparent refresh retry on 401. */
export async function authJson<T>(path: string, options: AuthFetchOptions = {}): Promise<T> {
  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;

    return fetch(`${getApiBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  };

  let response = await send(getAccessToken());

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await send(refreshed);
    }
  }

  if (!response.ok) {
    throw await parseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export { notifySessionCleared };

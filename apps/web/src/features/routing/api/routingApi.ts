import type {
  RouteRequestPayload,
  RouteResponse,
  RoutingFeedbackPayload,
  RoutingFeedbackResponse,
  RoutingHealthResponse,
  RoutingProfilesResponse,
} from '@/features/routing/types';

import { RoutingApiError } from './routingApiError';

export { RoutingApiError, isRoutingApiError, type RoutingApiErrorBody } from './routingApiError';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

const ROUTING_API_PREFIX = '/api/routing';

function getApiBaseUrl(): string {
  if (typeof API_BASE_URL !== 'string' || API_BASE_URL.trim() === '') {
    throw new Error('Missing VITE_API_BASE_URL');
  }

  return API_BASE_URL.replace(/\/+$/, '');
}

function routingPath(segment: string): string {
  const normalized = segment.startsWith('/') ? segment : `/${segment}`;
  return `${ROUTING_API_PREFIX}${normalized}`;
}

async function routingFetchJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, init);

  if (!response.ok) {
    throw await RoutingApiError.fromResponse(response);
  }

  return response.json() as Promise<T>;
}

/** GET /api/routing/health — service and engine availability. */
export async function getRoutingHealth(
  signal?: AbortSignal,
): Promise<RoutingHealthResponse> {
  return routingFetchJson<RoutingHealthResponse>(routingPath('/health'), { signal });
}

/** GET /api/routing/profiles — public routing profiles from API/DB. */
export async function getRoutingProfiles(
  signal?: AbortSignal,
): Promise<RoutingProfilesResponse> {
  return routingFetchJson<RoutingProfilesResponse>(routingPath('/profiles'), { signal });
}

/** POST /api/routing/route — normalized directions (Valhalla via API adapter only). */
export async function requestRoute(
  payload: RouteRequestPayload,
  options?: { signal?: AbortSignal },
): Promise<RouteResponse> {
  return routingFetchJson<RouteResponse>(routingPath('/route'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
}

/** POST /api/routing/feedback — user route quality report linked to optional requestId. */
export async function submitRoutingFeedback(
  payload: RoutingFeedbackPayload,
  options?: { signal?: AbortSignal },
): Promise<RoutingFeedbackResponse> {
  return routingFetchJson<RoutingFeedbackResponse>(routingPath('/feedback'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
}


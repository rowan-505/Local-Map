/**
 * Public admin-area (region/township) search used by the account region picker.
 *
 * These endpoints are public and read-only, so they use a plain `fetch` against
 * the API base URL (no bearer token) — the signup form must work for guests too.
 */
import { ApiError, getApiBaseUrl } from '@/features/auth/api/http';

/** Public admin-area option returned by /public/admin-areas. No internal fields. */
export type RegionOption = {
  readonly id: string;
  readonly name: string;
  readonly name_my: string | null;
  readonly name_en: string | null;
  readonly admin_level: string | null;
  readonly admin_level_code: string | null;
  readonly parent_name: string | null;
  readonly display_name: string;
};

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body?.message === 'string' && body.message.trim() !== '') {
        message = body.message;
      }
    } catch {
      // Non-JSON body; keep the generic message.
    }
    throw new ApiError(response.status, message);
  }

  return response.json() as Promise<T>;
}

export async function searchRegions(
  query: string,
  limit = 20,
  signal?: AbortSignal,
): Promise<RegionOption[]> {
  const params = new URLSearchParams();
  const trimmed = query.trim();
  if (trimmed !== '') params.set('q', trimmed);
  params.set('limit', String(limit));
  return getJson<RegionOption[]>(`/public/admin-areas/search?${params.toString()}`, signal);
}

/** Resolve a single region by id (used to label a preselected primaryRegionId). */
export async function getRegionById(
  id: string,
  signal?: AbortSignal,
): Promise<RegionOption | null> {
  try {
    return await getJson<RegionOption>(`/public/admin-areas/${encodeURIComponent(id)}`, signal);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

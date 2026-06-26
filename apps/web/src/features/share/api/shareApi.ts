/**
 * CoreMap-only share link API client.
 *
 * Public endpoints (no auth): mints and resolves short /s/:code links for a map
 * point or a core place. Uses the shared public fetch/error handling (ApiError).
 */
import { publicGet, publicJson } from '@/features/auth/api/http';

export type ShareTargetType = 'point' | 'place';

export type CreateShareLinkPayload =
  | {
      readonly target_type: 'point';
      readonly lat: number;
      readonly lng: number;
      readonly zoom?: number;
      readonly address_line?: string | null;
      readonly plus_code?: string | null;
    }
  | {
      readonly target_type: 'place';
      readonly place_public_id: string;
    };

export type CreateShareLinkResponse = {
  readonly code: string;
  readonly url: string;
};

export type ResolvedShareLink =
  | {
      readonly target_type: 'point';
      readonly lat: number;
      readonly lng: number;
      readonly zoom: number | null;
      readonly address_line: string | null;
      readonly plus_code: string | null;
    }
  | {
      readonly target_type: 'place';
      readonly place_public_id: string;
    };

/** Creates (or reuses, via server-side dedup) a share link for the given target. */
export async function createShareLink(
  payload: CreateShareLinkPayload,
): Promise<CreateShareLinkResponse> {
  return publicJson<CreateShareLinkResponse>('/share/links', payload);
}

/** Resolves a short share code to its target (point snapshot or place public id). */
export async function resolveShareLink(
  code: string,
  signal?: AbortSignal,
): Promise<ResolvedShareLink> {
  return publicGet<ResolvedShareLink>(`/share/links/${encodeURIComponent(code)}`, signal);
}

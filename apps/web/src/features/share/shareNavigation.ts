/**
 * Hand-off payload from the /s/:code resolver to HomePage via react-router
 * location state. The resolver does all async work (resolve + place coords) so
 * HomePage can apply the shared map state synchronously in its initial render.
 */
export const SHARE_NAV_STATE_KEY = 'coremapShare';

export type ShareNavTarget =
  | {
      readonly kind: 'point';
      readonly lat: number;
      readonly lng: number;
      readonly zoom: number | null;
      readonly addressLine: string | null;
      readonly plusCode: string | null;
    }
  | {
      readonly kind: 'place';
      readonly placePublicId: string;
      readonly lat: number;
      readonly lng: number;
      readonly name: string | null;
      readonly addressLine: string | null;
      readonly plusCode: string | null;
    };

/** Safely extracts a share target from opaque router location state. */
export function readShareNavState(state: unknown): ShareNavTarget | null {
  if (!state || typeof state !== 'object') return null;
  const value = (state as Record<string, unknown>)[SHARE_NAV_STATE_KEY];
  if (!value || typeof value !== 'object') return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'point' || kind === 'place') {
    return value as ShareNavTarget;
  }
  return null;
}

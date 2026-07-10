import type { TransportStopDetail } from '@/types';
import type { TransportMapSelection } from './transportMapSelection';

export type TransportStopDetailPanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly selection: TransportMapSelection }
  | {
      readonly kind: 'loaded';
      readonly selection: TransportMapSelection;
      readonly detail: TransportStopDetail;
    }
  | {
      readonly kind: 'not_found';
      readonly selection: TransportMapSelection;
      readonly preview: TransportStopDetail;
    }
  | {
      readonly kind: 'network_error';
      readonly selection: TransportMapSelection;
      readonly preview: TransportStopDetail;
    }
  | {
      readonly kind: 'preview_only';
      readonly selection: TransportMapSelection;
      readonly preview: TransportStopDetail;
    };

export type ResolveTransportStopDetailPanelStateInput = {
  readonly selection: TransportMapSelection | null;
  readonly apiDetail: TransportStopDetail | undefined;
  readonly loading: boolean;
  readonly fetched: boolean;
  readonly error: Error | null;
};

function readHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  const status = (error as { status: unknown }).status;
  return typeof status === 'number' ? status : null;
}

export function isTransportStopDetailNotFoundError(error: unknown): boolean {
  return readHttpStatus(error) === 404;
}

/** Derives panel state — API detail is primary; tile preview is degraded fallback only. */
export function resolveTransportStopDetailPanelState(
  input: ResolveTransportStopDetailPanelStateInput,
): TransportStopDetailPanelState {
  const { selection, apiDetail, loading, fetched, error } = input;
  if (!selection) {
    return { kind: 'idle' };
  }

  if (apiDetail) {
    return { kind: 'loaded', selection, detail: apiDetail };
  }

  const expectsApi =
    selection.apiLookupId !== null && selection.apiLookupId.trim() !== '';

  if (expectsApi) {
    if (loading || !fetched) {
      return { kind: 'loading', selection };
    }

    if (error) {
      if (isTransportStopDetailNotFoundError(error)) {
        return { kind: 'not_found', selection, preview: selection.preview };
      }
      return { kind: 'network_error', selection, preview: selection.preview };
    }

    return { kind: 'not_found', selection, preview: selection.preview };
  }

  return { kind: 'preview_only', selection, preview: selection.preview };
}

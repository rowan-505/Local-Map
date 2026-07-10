import type { TransportStopDetailPanelState } from './transportStopDetailPanelState';

/** User-facing status line shown inside the detail card (never dev/technical copy). */
export function transportStopDetailPanelBanner(
  state: Exclude<TransportStopDetailPanelState, { kind: 'idle' }>,
): { message: string; tone: 'neutral' | 'error'; showRetry?: boolean } | null {
  switch (state.kind) {
    case 'loading':
      return { message: 'Loading details…', tone: 'neutral' };
    case 'preview_only':
      return null;
    case 'not_found':
      return {
        message: 'More details are not available for this stop.',
        tone: 'neutral',
      };
    case 'network_error':
      return {
        message: 'Could not load details. Check your connection and try again.',
        tone: 'error',
        showRetry: true,
      };
    case 'loaded':
      return null;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

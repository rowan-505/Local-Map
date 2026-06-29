/**
 * Derives a subtle, transient toast from own-user location state so the user
 * naturally learns the outcome of pressing locate: precise tracking vs a Yangon
 * fallback. Client-side only — no network, no persistence.
 *
 * One toast per meaningful state change (deduped), auto-dismissed after a short
 * delay. Transient/neutral states (idle, stopped, requesting) show nothing and
 * reset the dedupe key so the next outcome announces again.
 */
import { useEffect, useRef, useState } from 'react';
import type { UserLocationState } from './userLocationTypes';

export type LocationToastTone = 'success' | 'warn';

export type LocationToast = {
  readonly id: number;
  readonly message: string;
  readonly tone: LocationToastTone;
};

const AUTO_DISMISS_MS = 4000;

type LocationToastInput = Pick<
  UserLocationState,
  'status' | 'isOutOfCoverage' | 'errorMessage'
>;

export function useLocationToast(state: LocationToastInput): LocationToast | null {
  const { status, isOutOfCoverage, errorMessage } = state;
  const [toast, setToast] = useState<LocationToast | null>(null);
  const idRef = useRef(0);
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const next = deriveToast(status, isOutOfCoverage, errorMessage);
    if (!next) {
      // Neutral/transient state — allow the next real outcome to re-announce.
      lastKeyRef.current = null;
      return;
    }
    const key = `${status}:${isOutOfCoverage}`;
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    idRef.current += 1;
    if (import.meta.env.DEV) {
      console.debug('[location] toast generated', { tone: next.tone, message: next.message });
    }
    setToast({ id: idRef.current, message: next.message, tone: next.tone });
  }, [status, isOutOfCoverage, errorMessage]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return toast;
}

function deriveToast(
  status: UserLocationState['status'],
  isOutOfCoverage: boolean,
  errorMessage: string | null,
): { message: string; tone: LocationToastTone } | null {
  switch (status) {
    case 'tracking':
      return isOutOfCoverage
        ? {
            message: 'Outside CoreMap coverage — showing Yangon Region',
            tone: 'warn',
          }
        : { message: 'Showing your location', tone: 'success' };
    case 'permission_denied':
      return { message: 'Location denied — showing Yangon Region', tone: 'warn' };
    case 'unavailable':
      return { message: 'Location unavailable — showing Yangon Region', tone: 'warn' };
    case 'timeout':
      return { message: 'Location timeout — showing Yangon Region', tone: 'warn' };
    case 'unsupported':
      // Surface the specific reason (e.g. HTTPS requirement) when available.
      return {
        message: errorMessage ?? 'Location not available — showing Yangon Region',
        tone: 'warn',
      };
    default:
      // idle, stopped, requesting_permission
      return null;
  }
}

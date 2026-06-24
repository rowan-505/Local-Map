import { useEffect, useRef, useState } from 'react';
import { getReverseAddress, type ReverseAddressResult } from '@/features/poi/api/publicMapApi';

export type ReverseAddressState = {
  readonly data: ReverseAddressResult | null;
  readonly loading: boolean;
  readonly error: boolean;
};

const IDLE: ReverseAddressState = { data: null, loading: false, error: false };

/**
 * Reverse-geocode the given point. Race-safe (latest click wins) and abortable.
 * No global state — local component state only.
 */
export function useReverseAddress(
  coordinates: readonly [number, number] | null,
): ReverseAddressState {
  const [state, setState] = useState<ReverseAddressState>(IDLE);
  const requestIdRef = useRef(0);

  const lng = coordinates ? coordinates[0] : null;
  const lat = coordinates ? coordinates[1] : null;

  useEffect(() => {
    if (lat === null || lng === null) {
      setState(IDLE);
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    setState({ data: null, loading: true, error: false });

    getReverseAddress(lat, lng, controller.signal)
      .then((result) => {
        if (requestId !== requestIdRef.current) return;
        setState({ data: result, loading: false, error: false });
      })
      .catch(() => {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        setState({ data: null, loading: false, error: true });
      });

    return () => {
      controller.abort();
    };
  }, [lat, lng]);

  return state;
}

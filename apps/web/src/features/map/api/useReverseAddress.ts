import { useEffect, useRef, useState } from 'react';
import { getReverseAddress, type ReverseAddressResult } from '@/features/poi/api/publicMapApi';
import { useMapUiStore } from '@/features/map/state/mapUiStore';

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
  const languageMode = useMapUiStore((state) => state.languageMode);
  const [state, setState] = useState<ReverseAddressState>(IDLE);
  const requestIdRef = useRef(0);

  const lng = coordinates ? coordinates[0] : null;
  const lat = coordinates ? coordinates[1] : null;

  useEffect(() => {
    if (lat === null || lng === null) {
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setState({ data: null, loading: true, error: false });
    });

    getReverseAddress(lat, lng, languageMode, controller.signal)
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
  }, [languageMode, lat, lng]);

  return coordinates ? state : IDLE;
}

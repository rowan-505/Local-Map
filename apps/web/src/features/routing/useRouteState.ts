import { useCallback, useMemo, useState } from 'react';

import { formatCoordinates } from '@/features/routing/lib/routePoint';
import type { RouteResponse } from '@/features/routing/types';

import {
  createInitialRouteState,
  EMPTY_ROUTE_ENDPOINT,
  isEndpointEmpty,
  resolveEndpointCoordinates,
  type RouteEndpoint,
  type RouteInputField,
  type RouteState,
  type RoutingTravelMode,
} from './routeState';

export type RouteStateActions = {
  readonly setFrom: (endpoint: RouteEndpoint) => void;
  readonly setTo: (endpoint: RouteEndpoint) => void;
  readonly setActiveInput: (field: RouteInputField | null) => void;
  readonly startMapPick: (field: RouteInputField) => void;
  readonly cancelMapPick: () => void;
  readonly applyMapPickedPoint: (lat: number, lng: number, label?: string) => void;
  readonly swapEndpoints: () => void;
  readonly clearRoute: () => void;
  readonly clearAll: () => void;
  readonly setRouteResult: (result: RouteResponse | null) => void;
  readonly setSelectedMode: (mode: RoutingTravelMode) => void;
  readonly setIsLoading: (isLoading: boolean) => void;
  readonly setError: (error: string | null) => void;
};

export type UseRouteStateReturn = RouteState &
  RouteStateActions & {
    readonly canGetRoute: boolean;
    readonly fromCoordinates: readonly [number, number] | null;
    readonly toCoordinates: readonly [number, number] | null;
  };

function clearRouteFields(state: RouteState): RouteState {
  return {
    ...state,
    routeResult: null,
    isLoading: false,
    error: null,
    pickMode: null,
    activeInput: null,
  };
}

export function useRouteState(
  initialMode: RoutingTravelMode = 'motorcycle',
): UseRouteStateReturn {
  const [state, setState] = useState<RouteState>(() => createInitialRouteState(initialMode));

  const setFrom = useCallback((endpoint: RouteEndpoint) => {
    setState((prev) =>
      clearRouteFields({
        ...prev,
        from: isEndpointEmpty(endpoint) ? { ...EMPTY_ROUTE_ENDPOINT } : endpoint,
      }),
    );
  }, []);

  const setTo = useCallback((endpoint: RouteEndpoint) => {
    setState((prev) =>
      clearRouteFields({
        ...prev,
        to: isEndpointEmpty(endpoint) ? { ...EMPTY_ROUTE_ENDPOINT } : endpoint,
      }),
    );
  }, []);

  const setActiveInput = useCallback((field: RouteInputField | null) => {
    setState((prev) => ({ ...prev, activeInput: field }));
  }, []);

  const startMapPick = useCallback((field: RouteInputField) => {
    setState((prev) => ({
      ...prev,
      pickMode: field,
      activeInput: null,
    }));
  }, []);

  const cancelMapPick = useCallback(() => {
    setState((prev) => ({ ...prev, pickMode: null }));
  }, []);

  const applyMapPickedPoint = useCallback((lat: number, lng: number, label?: string) => {
    setState((prev) => {
      const field = prev.pickMode;
      if (!field) return prev;

      const endpoint: RouteEndpoint = {
        kind: 'map_click',
        label: label ?? formatCoordinates(lng, lat),
        lat,
        lng,
        source: 'map_click',
      };

      return clearRouteFields({
        ...prev,
        pickMode: null,
        activeInput: null,
        [field]: endpoint,
      });
    });
  }, []);

  const swapEndpoints = useCallback(() => {
    setState((prev) =>
      clearRouteFields({
        ...prev,
        from: prev.to,
        to: prev.from,
      }),
    );
  }, []);

  const clearRoute = useCallback(() => {
    setState((prev) => clearRouteFields(prev));
  }, []);

  const clearAll = useCallback(() => {
    setState((prev) =>
      clearRouteFields({
        ...prev,
        from: { ...EMPTY_ROUTE_ENDPOINT },
        to: { ...EMPTY_ROUTE_ENDPOINT },
      }),
    );
  }, []);

  const setRouteResult = useCallback((result: RouteResponse | null) => {
    setState((prev) => ({ ...prev, routeResult: result }));
  }, []);

  const setSelectedMode = useCallback((mode: RoutingTravelMode) => {
    setState((prev) => clearRouteFields({ ...prev, selectedMode: mode }));
  }, []);

  const setIsLoading = useCallback((isLoading: boolean) => {
    setState((prev) => ({ ...prev, isLoading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const fromCoordinates = useMemo(
    () => resolveEndpointCoordinates(state.from),
    [state.from],
  );
  const toCoordinates = useMemo(
    () => resolveEndpointCoordinates(state.to),
    [state.to],
  );
  const canGetRoute = Boolean(fromCoordinates && toCoordinates);

  return useMemo(
    (): UseRouteStateReturn => ({
      ...state,
      setFrom,
      setTo,
      setActiveInput,
      startMapPick,
      cancelMapPick,
      applyMapPickedPoint,
      swapEndpoints,
      clearRoute,
      clearAll,
      setRouteResult,
      setSelectedMode,
      setIsLoading,
      setError,
      canGetRoute,
      fromCoordinates,
      toCoordinates,
    }),
    [
      state,
      setFrom,
      setTo,
      setActiveInput,
      startMapPick,
      cancelMapPick,
      applyMapPickedPoint,
      swapEndpoints,
      clearRoute,
      clearAll,
      setRouteResult,
      setSelectedMode,
      setIsLoading,
      setError,
      canGetRoute,
      fromCoordinates,
      toCoordinates,
    ],
  );
}

"use client";

import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";

/**
 * Client-side caching for Transport list pages, built on the dashboard's existing
 * TanStack Query provider (no new state library added).
 *
 * Behaviour:
 *   - Caches each list response by ["transport", resource, params] — i.e. endpoint
 *     + full query params, so revisiting a filter/page combination is instant.
 *   - `keepPreviousData` keeps the previously loaded rows on screen while the next
 *     query loads, so changing filters/pages never blanks the table.
 *   - Opening/closing a detail drawer changes only an unrelated URL param
 *     (?route=/?stop=/?line=), which is excluded from `params`, so the list query
 *     key is unchanged and no refetch happens.
 *
 * Stale windows: lists default to 30s; imports/overview pass 60s.
 */

export const TRANSPORT_LIST_STALE_MS = 30_000;
export const TRANSPORT_IMPORTS_STALE_MS = 60_000;

export type TransportListData<T> = { items: T[]; total: number };

/** Root key for a Transport resource — pass to invalidateQueries after a mutation. */
export function transportListRootKey(resource: string): readonly [string, string] {
    return ["transport", resource];
}

export function useTransportListQuery<T>(args: {
    readonly resource: string;
    readonly params: Record<string, unknown>;
    readonly queryFn: (signal: AbortSignal) => Promise<TransportListData<T>>;
    readonly staleTimeMs?: number;
    readonly enabled?: boolean;
}): UseQueryResult<TransportListData<T>> {
    return useQuery({
        queryKey: ["transport", args.resource, args.params],
        queryFn: ({ signal }) => args.queryFn(signal),
        staleTime: args.staleTimeMs ?? TRANSPORT_LIST_STALE_MS,
        placeholderData: keepPreviousData,
        enabled: args.enabled,
    });
}

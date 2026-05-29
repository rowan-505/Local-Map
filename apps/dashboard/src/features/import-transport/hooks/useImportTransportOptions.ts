"use client";

import { useQuery } from "@tanstack/react-query";

import { getImportTransportOptions } from "../api/importTransportApiClient";

export function useImportTransportOptions(enabled = true) {
    return useQuery({
        queryKey: ["import-transport", "options"] as const,
        queryFn: ({ signal }) => getImportTransportOptions({ signal }),
        enabled,
        staleTime: 10 * 60_000,
        gcTime: 30 * 60_000,
    });
}

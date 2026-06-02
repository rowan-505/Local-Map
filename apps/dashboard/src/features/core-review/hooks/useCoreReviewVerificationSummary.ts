"use client";

import { useQuery } from "@tanstack/react-query";

import { getCoreReviewVerificationSummary, type CoreReviewVerificationSummaryResponse } from "@/src/lib/api";

import { coreReviewQueryKeys } from "./coreReviewQueryKeys";

const STALE_MS = 60_000;
const GC_MS = 10 * 60_000;

export function useCoreReviewVerificationSummary(enabled = true) {
    return useQuery<CoreReviewVerificationSummaryResponse>({
        queryKey: coreReviewQueryKeys.overviewVerificationSummary(),
        queryFn: ({ signal }) => getCoreReviewVerificationSummary({ signal }),
        enabled,
        staleTime: STALE_MS,
        gcTime: GC_MS,
        refetchOnWindowFocus: false,
    });
}

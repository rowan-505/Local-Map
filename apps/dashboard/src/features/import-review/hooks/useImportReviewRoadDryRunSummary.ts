"use client";

import { useEffect, useState } from "react";

import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";
import {
    getImportReviewRoadDryRunSummary,
    isAbortError,
    type ImportReviewRoadDryRunSummaryResponse,
} from "@/src/lib/api";

export function useImportReviewRoadDryRunSummary(
    apiScopeQuery: ImportReviewScopeQueryParams | null,
    enabled: boolean
) {
    const [summary, setSummary] = useState<ImportReviewRoadDryRunSummaryResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!enabled || !apiScopeQuery) {
            setSummary(null);
            setError(null);
            setIsLoading(false);
            return;
        }
        const controller = new AbortController();
        setIsLoading(true);
        setError(null);
        void getImportReviewRoadDryRunSummary(apiScopeQuery, { signal: controller.signal })
            .then((res) => {
                setSummary(res);
            })
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                setSummary(null);
                setError(err instanceof Error ? err.message : "Failed to load dry-run summary");
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            });
        return () => controller.abort();
    }, [enabled, apiScopeQuery]);

    return { summary, isLoading, error };
}

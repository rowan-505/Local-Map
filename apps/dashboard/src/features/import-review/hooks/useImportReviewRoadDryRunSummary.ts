"use client";

import { useEffect, useState } from "react";

import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";
import {
    getImportReviewRoadDryRunSummary,
    isAbortError,
    type ImportReviewRoadDryRunSummaryResponse,
} from "@/src/lib/api";
import { logImportReviewClientFetch } from "@/src/features/import-review/utils/importReviewClientFetchLog";

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
        const startedAt = performance.now();
        setIsLoading(true);
        setError(null);
        logImportReviewClientFetch({
            phase: "roads-dry-run-summary",
            family: "roads",
            status: "start",
            query: { ...apiScopeQuery },
        });
        void getImportReviewRoadDryRunSummary(apiScopeQuery, { signal: controller.signal })
            .then((res) => {
                logImportReviewClientFetch({
                    phase: "roads-dry-run-summary",
                    family: "roads",
                    status: "success",
                    durationMs: Math.round(performance.now() - startedAt),
                    itemCount: Object.keys(res.items_by_candidate_id ?? {}).length,
                });
                setSummary(res);
            })
            .catch((err) => {
                if (isAbortError(err)) {
                    logImportReviewClientFetch({
                        phase: "roads-dry-run-summary",
                        family: "roads",
                        status: "abort",
                        durationMs: Math.round(performance.now() - startedAt),
                    });
                    return;
                }
                logImportReviewClientFetch({
                    phase: "roads-dry-run-summary",
                    family: "roads",
                    status: "error",
                    durationMs: Math.round(performance.now() - startedAt),
                    error: err instanceof Error ? err.message : String(err),
                });
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

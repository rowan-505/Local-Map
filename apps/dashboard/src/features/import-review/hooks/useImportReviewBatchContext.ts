"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getImportReviewSummaryClient } from "@/src/features/import-review/api/importReviewApiClient";
import {
    formatImportReviewApiError,
    importReviewAmbiguousFromError,
} from "@/src/features/import-review/api/importReviewApiErrors";
import {
    buildImportReviewEntityUrl,
    type ImportReviewEntityUrlFilters,
} from "@/src/features/import-review/navigation/buildImportReviewEntityUrl";
import type { ImportReviewBatchChoice } from "@/src/lib/api";
import { isAbortError } from "@/src/lib/api";
import {
    applyImportReviewScopeSearchParams,
    importReviewScopeQueryForApi,
    importReviewScopeQueryFromSearch,
    reviewBatchIdFromImportReviewSearch,
    snapshotVersionFromImportReviewSearch,
    syncImportReviewUrlToResolvedBatch,
    type ImportReviewScopeQueryParams,
} from "@/src/lib/importReviewSnapshot";

const ENV_SNAPSHOT_DEFAULT = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?.trim() ?? "";

export type ImportReviewBatchContextStatus =
    | "no_scope"
    | "loading"
    | "resolved"
    | "multiple_batches"
    | "error";

export type UseImportReviewBatchContextOptions = {
    /** When true (default), snapshot-only URLs probe summary to detect 409 ambiguity. */
    resolveSnapshotScope?: boolean;
    /** Pass false on entity pages that should not use env default snapshot. */
    useEnvDefault?: boolean;
};

export type ImportReviewBatchContext = {
    status: ImportReviewBatchContextStatus;
    isLoadingBatchContext: boolean;
    /** Snapshot-only scope: summary probe to resolve review_batch_id. */
    isResolvingReviewBatch: boolean;
    error: string;
    /** Scope safe for `/api/import-review/*` after resolution. */
    apiScopeQuery: ImportReviewScopeQueryParams | null;
    reviewBatchId: string | null;
    sourceSnapshotVersion: string | null;
    ambiguousBatches: ImportReviewBatchChoice[] | null;
    ambiguousSnapshot: string;
    /** Replace URL with review_batch_id (preferred navigation). */
    selectBatch: (batchId: string) => void;
    /** Use latest=true with current snapshot (backend picks latest batch). */
    selectLatestForSnapshot: () => void;
    /** After list/detail returns review_batch_id, sync URL if missing. */
    syncResolvedBatchToUrl: (reviewBatchId: string | null | undefined) => void;
    buildEntityUrl: (slug: string, filters?: ImportReviewEntityUrlFilters) => string;
};

export function useImportReviewBatchContext(
    options: UseImportReviewBatchContextOptions = {}
): ImportReviewBatchContext {
    const resolveSnapshotScope = options.resolveSnapshotScope !== false;
    const useEnvDefault = options.useEnvDefault !== false;

    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [isLoadingBatchContext, setIsLoadingBatchContext] = useState(false);
    const [error, setError] = useState("");
    const [ambiguousBatches, setAmbiguousBatches] = useState<ImportReviewBatchChoice[] | null>(null);
    const [ambiguousSnapshot, setAmbiguousSnapshot] = useState("");
    const [resolvedScope, setResolvedScope] = useState<ImportReviewScopeQueryParams | null>(null);

    const urlBatch = reviewBatchIdFromImportReviewSearch(searchParams);
    const urlSnapshot = snapshotVersionFromImportReviewSearch(searchParams);

    const urlScopeQuery = useMemo(
        () =>
            importReviewScopeQueryFromSearch(searchParams, ENV_SNAPSHOT_DEFAULT, {
                useEnvDefault,
            }),
        [searchParams, useEnvDefault]
    );

    const replaceQuery = useCallback(
        (mutate: (p: URLSearchParams) => void) => {
            const p = new URLSearchParams(searchParams.toString());
            mutate(p);
            const qs = p.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        },
        [router, pathname, searchParams]
    );

    const selectBatch = useCallback(
        (batchId: string) => {
            const id = batchId.trim();
            if (!id) {
                return;
            }
            replaceQuery((p) => {
                applyImportReviewScopeSearchParams(p, "", id);
            });
        },
        [replaceQuery]
    );

    const selectLatestForSnapshot = useCallback(() => {
        const snap = ambiguousSnapshot || urlSnapshot || ENV_SNAPSHOT_DEFAULT;
        replaceQuery((p) => {
            applyImportReviewScopeSearchParams(p, snap, "");
            p.set("latest", "true");
        });
    }, [ambiguousSnapshot, urlSnapshot, replaceQuery]);

    const syncResolvedBatchToUrl = useCallback(
        (reviewBatchId: string | null | undefined) => {
            const id = reviewBatchId?.trim();
            if (!id || urlBatch.trim()) {
                return;
            }
            replaceQuery((p) => {
                syncImportReviewUrlToResolvedBatch(p, id);
            });
        },
        [replaceQuery, urlBatch]
    );

    const buildEntityUrl = useCallback(
        (slug: string, filters?: ImportReviewEntityUrlFilters) => {
            const scope = resolvedScope ?? urlScopeQuery;
            if (!scope) {
                return buildImportReviewEntityUrl(slug, { filters });
            }
            if ("review_batch_id" in scope) {
                return buildImportReviewEntityUrl(slug, {
                    review_batch_id: scope.review_batch_id,
                    filters,
                });
            }
            return buildImportReviewEntityUrl(slug, {
                source_snapshot_version: scope.source_snapshot_version,
                filters: {
                    ...filters,
                    ...(scope.latest ? { latest: true } : undefined),
                },
            });
        },
        [resolvedScope, urlScopeQuery]
    );

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        queueMicrotask(() => {
            if (!active) {
                return;
            }

            setAmbiguousBatches(null);
            setAmbiguousSnapshot("");
            setError("");

            if (!urlScopeQuery) {
                setResolvedScope(null);
                setIsLoadingBatchContext(false);
                return;
            }

            if ("review_batch_id" in urlScopeQuery) {
                setResolvedScope(urlScopeQuery);
                setIsLoadingBatchContext(false);
                return;
            }

            if (!resolveSnapshotScope) {
                setResolvedScope(urlScopeQuery);
                setIsLoadingBatchContext(false);
                return;
            }

            const apiScope = importReviewScopeQueryForApi(urlScopeQuery);
            if (!apiScope) {
                setResolvedScope(null);
                setIsLoadingBatchContext(false);
                return;
            }

            setIsLoadingBatchContext(true);

            void getImportReviewSummaryClient(apiScope, { signal: controller.signal })
                .then((summary) => {
                    if (!active) {
                        return;
                    }
                    const batchId = summary.review_batch_id?.trim();
                    if (batchId) {
                        setResolvedScope({ review_batch_id: batchId });
                    } else {
                        setResolvedScope(urlScopeQuery);
                    }
                })
                .catch((err) => {
                    if (!active || isAbortError(err)) {
                        return;
                    }
                    const ambiguous = importReviewAmbiguousFromError(err);
                    if (ambiguous) {
                        setAmbiguousBatches(ambiguous.batches);
                        setAmbiguousSnapshot(ambiguous.sourceSnapshotVersion || urlSnapshot);
                        setResolvedScope(null);
                        setError("");
                        return;
                    }
                    setResolvedScope(null);
                    setError(formatImportReviewApiError(err, "Failed to resolve review batch context."));
                })
                .finally(() => {
                    if (active && !controller.signal.aborted) {
                        setIsLoadingBatchContext(false);
                    }
                });
        });

        return () => {
            active = false;
            controller.abort();
        };
    }, [urlScopeQuery, urlSnapshot, resolveSnapshotScope]);

    const apiScopeQuery = useMemo(() => {
        if (ambiguousBatches && ambiguousBatches.length > 0) {
            return null;
        }
        if (resolvedScope) {
            return importReviewScopeQueryForApi(resolvedScope);
        }
        return importReviewScopeQueryForApi(urlScopeQuery);
    }, [resolvedScope, urlScopeQuery, ambiguousBatches]);

    const status: ImportReviewBatchContextStatus = useMemo(() => {
        if (ambiguousBatches && ambiguousBatches.length > 0) {
            return "multiple_batches";
        }
        if (isLoadingBatchContext) {
            return "loading";
        }
        if (error) {
            return "error";
        }
        if (!apiScopeQuery) {
            return "no_scope";
        }
        return "resolved";
    }, [ambiguousBatches, isLoadingBatchContext, error, apiScopeQuery]);

    const reviewBatchId =
        apiScopeQuery && "review_batch_id" in apiScopeQuery ? apiScopeQuery.review_batch_id : urlBatch || null;

    const sourceSnapshotVersion =
        apiScopeQuery && "source_snapshot_version" in apiScopeQuery
            ? apiScopeQuery.source_snapshot_version
            : urlSnapshot || null;

    const isResolvingReviewBatch =
        isLoadingBatchContext &&
        !urlBatch.trim() &&
        urlScopeQuery !== null &&
        "source_snapshot_version" in urlScopeQuery;

    return useMemo(
        () => ({
            status,
            isLoadingBatchContext,
            isResolvingReviewBatch,
            error,
            apiScopeQuery,
            reviewBatchId: reviewBatchId || null,
            sourceSnapshotVersion: sourceSnapshotVersion || null,
            ambiguousBatches,
            ambiguousSnapshot,
            selectBatch,
            selectLatestForSnapshot,
            syncResolvedBatchToUrl,
            buildEntityUrl,
        }),
        [
            status,
            isLoadingBatchContext,
            isResolvingReviewBatch,
            error,
            apiScopeQuery,
            reviewBatchId,
            sourceSnapshotVersion,
            ambiguousBatches,
            ambiguousSnapshot,
            selectBatch,
            selectLatestForSnapshot,
            syncResolvedBatchToUrl,
            buildEntityUrl,
        ]
    );
}

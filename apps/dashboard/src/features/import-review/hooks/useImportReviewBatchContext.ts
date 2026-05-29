"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useImportReviewSummary } from "@/src/features/import-review/hooks/useImportReviewSummary";
import {
    buildImportReviewEntityUrl,
    type ImportReviewEntityUrlFilters,
} from "@/src/features/import-review/navigation/buildImportReviewEntityUrl";
import {
    replaceImportReviewSearchParams,
    type ReplaceImportReviewSearchParamsMeta,
} from "@/src/features/import-review/navigation/replaceImportReviewSearchParams";
import type { ImportReviewBatchChoice } from "@/src/lib/api";
import { IMPORT_TRANSPORT_PATH } from "@/src/lib/dashboardPaths";
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
    /** When false, no summary probe or scope resolution runs (entity route not active). */
    enabled?: boolean;
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

    const onImportTransportRoute =
        (pathname ?? "") === IMPORT_TRANSPORT_PATH ||
        (pathname ?? "").startsWith(`${IMPORT_TRANSPORT_PATH}/`);
    const enabled = options.enabled !== false && !onImportTransportRoute;

    const [isLoadingBatchContext, setIsLoadingBatchContext] = useState(false);
    const [error, setError] = useState("");
    const [ambiguousBatches, setAmbiguousBatches] = useState<ImportReviewBatchChoice[] | null>(null);
    const [ambiguousSnapshot, setAmbiguousSnapshot] = useState("");
    const [resolvedScope, setResolvedScope] = useState<ImportReviewScopeQueryParams | null>(null);

    const searchKey = searchParams.toString();
    const urlBatch = reviewBatchIdFromImportReviewSearch(searchParams);
    const urlSnapshot = snapshotVersionFromImportReviewSearch(searchParams);

    const urlScopeQuery = useMemo(() => {
        const sp = new URLSearchParams(searchKey);
        return importReviewScopeQueryFromSearch(sp, ENV_SNAPSHOT_DEFAULT, {
            useEnvDefault,
        });
    }, [searchKey, useEnvDefault]);

    const replaceQuery = useCallback(
        (mutate: (p: URLSearchParams) => void, meta?: ReplaceImportReviewSearchParamsMeta) => {
            replaceImportReviewSearchParams(router, pathname, searchParams, mutate, meta);
        },
        [router, pathname, searchParams]
    );

    const selectBatch = useCallback(
        (batchId: string) => {
            const id = batchId.trim();
            if (!id) {
                return;
            }
            replaceQuery(
                (p) => {
                    applyImportReviewScopeSearchParams(p, "", id);
                },
                { source: "batch_context:select_batch" }
            );
        },
        [replaceQuery]
    );

    const selectLatestForSnapshot = useCallback(() => {
        const snap = ambiguousSnapshot || urlSnapshot || ENV_SNAPSHOT_DEFAULT;
        replaceQuery(
            (p) => {
                applyImportReviewScopeSearchParams(p, snap, "");
                p.set("latest", "true");
            },
            { source: "batch_context:select_latest_snapshot" }
        );
    }, [ambiguousSnapshot, urlSnapshot, replaceQuery]);

    const syncResolvedBatchToUrl = useCallback(
        (reviewBatchId: string | null | undefined) => {
            const id = reviewBatchId?.trim();
            if (!id || urlBatch.trim()) {
                return;
            }
            replaceQuery(
                (p) => {
                    syncImportReviewUrlToResolvedBatch(p, id);
                },
                { source: "batch_context:sync_resolved_batch" }
            );
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

    const snapshotProbeScope = useMemo(() => {
        if (!enabled || !urlScopeQuery) {
            return null;
        }
        if ("review_batch_id" in urlScopeQuery) {
            return null;
        }
        if (!resolveSnapshotScope) {
            return null;
        }
        return importReviewScopeQueryForApi(urlScopeQuery);
    }, [enabled, urlScopeQuery, resolveSnapshotScope]);

    const snapshotSummary = useImportReviewSummary(snapshotProbeScope, {
        enabled: snapshotProbeScope !== null,
    });

    useEffect(() => {
        setAmbiguousBatches(null);
        setAmbiguousSnapshot("");
        setError("");

        if (!enabled) {
            setResolvedScope(null);
            setIsLoadingBatchContext(false);
            return;
        }

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

        setIsLoadingBatchContext(snapshotSummary.isLoading);

        if (snapshotSummary.ambiguousBatches && snapshotSummary.ambiguousBatches.length > 0) {
            setAmbiguousBatches(snapshotSummary.ambiguousBatches);
            setAmbiguousSnapshot(snapshotSummary.ambiguousSnapshot || urlSnapshot);
            setResolvedScope(null);
            return;
        }

        if (snapshotSummary.error) {
            setResolvedScope(null);
            setError(snapshotSummary.error);
            return;
        }

        if (snapshotSummary.data) {
            const batchId = snapshotSummary.data.review_batch_id?.trim();
            setResolvedScope(batchId ? { review_batch_id: batchId } : urlScopeQuery);
            return;
        }

        if (!snapshotSummary.isLoading) {
            setResolvedScope(urlScopeQuery);
        }
    }, [
        enabled,
        urlScopeQuery,
        urlSnapshot,
        resolveSnapshotScope,
        snapshotSummary.isLoading,
        snapshotSummary.data,
        snapshotSummary.error,
        snapshotSummary.ambiguousBatches,
        snapshotSummary.ambiguousSnapshot,
    ]);

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

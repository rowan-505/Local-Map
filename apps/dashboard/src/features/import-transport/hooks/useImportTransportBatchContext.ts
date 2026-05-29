"use client";

import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { IMPORT_TRANSPORT_PATH } from "@/src/lib/dashboardPaths";

import type {
    ImportTransportBatchListItem,
    ImportTransportScopeQuery,
    ImportTransportSummaryResponse,
} from "../config/types";
import { buildImportTransportEntityUrl } from "../navigation/buildImportTransportEntityUrl";
import { replaceImportTransportSearchParams } from "../navigation/replaceImportTransportSearchParams";
import {
    importBatchIdFromTransportSearch,
    importTransportScopeQueryFromSearch,
    snapshotVersionFromTransportSearch,
    syncImportTransportUrlToResolvedBatch,
} from "../utils/importTransportScope";

import { useImportTransportBatches, useImportTransportSummary } from "./useImportTransportOverview";

export type ImportTransportBatchContextStatus =
    | "loading"
    | "resolved"
    | "multiple_batches"
    | "no_batches"
    | "error";

export type ImportTransportCurrentBatch = {
    id: string;
    batch_name: string;
    import_status: string;
    validation_status: string;
    source_snapshot_version: string | null;
    imported_at: string | null;
    created_at: string;
};

export type ImportTransportBatchContext = {
    status: ImportTransportBatchContextStatus;
    isLoadingBatchContext: boolean;
    isResolvingImportBatch: boolean;
    error: string;
    apiScopeQuery: ImportTransportScopeQuery | null;
    importBatchId: string | null;
    sourceSnapshotVersion: string | null;
    currentBatch: ImportTransportCurrentBatch | null;
    summary: ImportTransportSummaryResponse | null;
    ambiguousBatches: ImportTransportBatchListItem[] | null;
    ambiguousSnapshot: string;
    applyScopeToUrl: (draft?: { snapshotInput: string; batchInput: string; latest?: boolean }) => void;
    selectBatch: (batchId: string) => void;
    selectLatestForSnapshot: () => void;
    syncResolvedBatchToUrl: (importBatchId: string | null | undefined) => void;
    buildEntityUrl: (slug: string) => string;
};

const ImportTransportBatchScopeContext = createContext<ImportTransportBatchContext | null>(null);

function isImportTransportRoutePath(pathname: string): boolean {
    return pathname === IMPORT_TRANSPORT_PATH || pathname.startsWith(`${IMPORT_TRANSPORT_PATH}/`);
}

function batchFromListItem(item: ImportTransportBatchListItem): ImportTransportCurrentBatch {
    return {
        id: item.id,
        batch_name: item.batch_name,
        import_status: item.import_status,
        validation_status: item.validation_status,
        source_snapshot_version: item.source_snapshot_version,
        imported_at: item.imported_at,
        created_at: item.created_at,
    };
}

function batchFromSummary(
    summary: ImportTransportSummaryResponse,
    importBatchId: string
): ImportTransportCurrentBatch {
    return {
        id: summary.import_batch_id?.trim() || importBatchId,
        batch_name: summary.batch_name?.trim() || `Import batch #${importBatchId}`,
        import_status: summary.import_status?.trim() || "—",
        validation_status: summary.validation_status?.trim() || "—",
        source_snapshot_version: summary.source_snapshot_version ?? null,
        imported_at: null,
        created_at: "",
    };
}

function useImportTransportBatchContextValue(): ImportTransportBatchContext {
    const router = useRouter();
    const pathname = usePathname() ?? "";
    const searchParams = useSearchParams();
    const searchKey = searchParams.toString();

    const enabled = isImportTransportRoutePath(pathname);

    const urlBatch = useMemo(
        () => importBatchIdFromTransportSearch(searchParams),
        [searchKey]
    );
    const urlSnapshot = useMemo(
        () => snapshotVersionFromTransportSearch(searchParams),
        [searchKey]
    );

    const urlScopeQuery = useMemo(
        () => importTransportScopeQueryFromSearch(searchParams),
        [searchKey]
    );

    const hasUrlScope = Boolean(urlBatch || urlSnapshot);

    const [resolvedScope, setResolvedScope] = useState<ImportTransportScopeQuery | null>(null);
    const [error, setError] = useState("");
    const [ambiguousBatches, setAmbiguousBatches] = useState<ImportTransportBatchListItem[] | null>(
        null
    );
    const [ambiguousSnapshot, setAmbiguousSnapshot] = useState("");

    const snapshotProbeScope = useMemo(() => {
        if (!enabled || !urlScopeQuery?.source_snapshot_version || urlScopeQuery.import_batch_id) {
            return null;
        }
        return urlScopeQuery;
    }, [enabled, urlScopeQuery]);

    const snapshotSummary = useImportTransportSummary(snapshotProbeScope, snapshotProbeScope !== null);

    const latestBatchQuery = useImportTransportBatches(
        { limit: 1, offset: 0 },
        enabled && !hasUrlScope
    );

    const batchesForCardQuery = useImportTransportBatches(
        { limit: 100, offset: 0 },
        enabled && Boolean(urlBatch || resolvedScope?.import_batch_id)
    );

    const snapshotBatchesQuery = useImportTransportBatches(
        { limit: 100, offset: 0 },
        enabled && Boolean(urlSnapshot) && !urlBatch
    );

    const replaceQuery = useCallback(
        (mutate: (params: URLSearchParams) => void) => {
            replaceImportTransportSearchParams(router, pathname, searchParams, mutate);
        },
        [router, pathname, searchParams]
    );

    const applyScopeToUrl = useCallback(
        (draft?: { snapshotInput: string; batchInput: string; latest?: boolean }) => {
            replaceQuery((params) => {
                params.delete("source_snapshot_version");
                params.delete("import_batch_id");
                params.delete("latest");
                const batch = (draft?.batchInput ?? urlBatch).trim();
                const snapshot = (draft?.snapshotInput ?? urlSnapshot).trim();
                if (batch) {
                    params.set("import_batch_id", batch);
                } else if (snapshot) {
                    params.set("source_snapshot_version", snapshot);
                }
                if (draft?.latest) {
                    params.set("latest", "true");
                }
            });
        },
        [replaceQuery, urlBatch, urlSnapshot]
    );

    const selectBatch = useCallback(
        (batchId: string) => {
            const id = batchId.trim();
            if (!id) {
                return;
            }
            replaceQuery((params) => {
                syncImportTransportUrlToResolvedBatch(params, id);
            });
        },
        [replaceQuery]
    );

    const selectLatestForSnapshot = useCallback(() => {
        const snap = ambiguousSnapshot || urlSnapshot;
        replaceQuery((params) => {
            params.delete("import_batch_id");
            params.delete("latest");
            params.set("source_snapshot_version", snap);
            params.set("latest", "true");
        });
    }, [ambiguousSnapshot, replaceQuery, urlSnapshot]);

    const syncResolvedBatchToUrl = useCallback(
        (importBatchId: string | null | undefined) => {
            const id = importBatchId?.trim();
            if (!id || urlBatch.trim()) {
                return;
            }
            replaceQuery((params) => {
                syncImportTransportUrlToResolvedBatch(params, id);
            });
        },
        [replaceQuery, urlBatch]
    );

    const buildEntityUrl = useCallback(
        (slug: string) => {
            const scope = resolvedScope ?? urlScopeQuery;
            if (!scope) {
                return buildImportTransportEntityUrl(slug);
            }
            if (scope.import_batch_id != null && scope.import_batch_id !== "") {
                return buildImportTransportEntityUrl(slug, {
                    import_batch_id: String(scope.import_batch_id),
                });
            }
            return buildImportTransportEntityUrl(slug, {
                source_snapshot_version: scope.source_snapshot_version,
                filters: scope.latest ? { latest: true } : undefined,
            });
        },
        [resolvedScope, urlScopeQuery]
    );

    useEffect(() => {
        setAmbiguousBatches(null);
        setAmbiguousSnapshot("");
        setError("");

        if (!enabled) {
            setResolvedScope(null);
            return;
        }

        if (urlScopeQuery?.import_batch_id) {
            setResolvedScope(urlScopeQuery);
            return;
        }

        if (!urlScopeQuery) {
            setResolvedScope(null);
            return;
        }

        if (urlSnapshot && !urlBatch && snapshotBatchesQuery.data) {
            const matches = snapshotBatchesQuery.data.items.filter(
                (batch) => (batch.source_snapshot_version ?? "").trim() === urlSnapshot.trim()
            );
            if (matches.length > 1) {
                setAmbiguousBatches(matches);
                setAmbiguousSnapshot(urlSnapshot);
                setResolvedScope(null);
                return;
            }
        }

        if (snapshotSummary.error) {
            setResolvedScope(null);
            setError(snapshotSummary.error);
            return;
        }

        if (snapshotSummary.data?.import_batch_id?.trim()) {
            setResolvedScope({ import_batch_id: snapshotSummary.data.import_batch_id.trim() });
            return;
        }

        if (snapshotSummary.isLoading || snapshotBatchesQuery.isLoading) {
            return;
        }

        setResolvedScope(urlScopeQuery);
    }, [
        enabled,
        urlScopeQuery,
        urlBatch,
        urlSnapshot,
        snapshotSummary.data,
        snapshotSummary.error,
        snapshotSummary.isLoading,
        snapshotBatchesQuery.data,
        snapshotBatchesQuery.isLoading,
    ]);

    useEffect(() => {
        if (!enabled || urlBatch || urlSnapshot) {
            return;
        }
        if (latestBatchQuery.isLoading) {
            return;
        }
        const latest = latestBatchQuery.data?.items[0];
        if (!latest) {
            return;
        }
        setResolvedScope({ import_batch_id: latest.id });
        syncResolvedBatchToUrl(latest.id);
    }, [
        enabled,
        urlBatch,
        urlSnapshot,
        latestBatchQuery.isLoading,
        latestBatchQuery.data,
        syncResolvedBatchToUrl,
    ]);

    useEffect(() => {
        const id = resolvedScope?.import_batch_id;
        if (id == null || id === "" || urlBatch.trim()) {
            return;
        }
        syncResolvedBatchToUrl(String(id));
    }, [resolvedScope?.import_batch_id, urlBatch, syncResolvedBatchToUrl]);

    const apiScopeQuery = useMemo(() => {
        if (ambiguousBatches && ambiguousBatches.length > 0) {
            return null;
        }
        if (resolvedScope?.import_batch_id != null && resolvedScope.import_batch_id !== "") {
            return { import_batch_id: String(resolvedScope.import_batch_id) };
        }
        if (urlScopeQuery?.import_batch_id) {
            return { import_batch_id: String(urlScopeQuery.import_batch_id) };
        }
        if (resolvedScope) {
            return resolvedScope;
        }
        return urlScopeQuery;
    }, [resolvedScope, urlScopeQuery, ambiguousBatches]);

    const importBatchId =
        apiScopeQuery?.import_batch_id != null && apiScopeQuery.import_batch_id !== ""
            ? String(apiScopeQuery.import_batch_id)
            : urlBatch || null;

    const summaryScope = importBatchId ? { import_batch_id: importBatchId } : null;
    const summaryQuery = useImportTransportSummary(
        summaryScope,
        enabled && summaryScope !== null && !(ambiguousBatches && ambiguousBatches.length > 0)
    );

    const isLoadingBatchContext =
        enabled &&
        ((Boolean(snapshotProbeScope) && snapshotSummary.isLoading) ||
            (Boolean(urlSnapshot) && !urlBatch && snapshotBatchesQuery.isLoading) ||
            (!hasUrlScope && latestBatchQuery.isLoading) ||
            (!hasUrlScope && Boolean(latestBatchQuery.data?.items[0]) && !urlBatch));

    const status: ImportTransportBatchContextStatus = useMemo(() => {
        if (ambiguousBatches && ambiguousBatches.length > 0) {
            return "multiple_batches";
        }
        if (
            enabled &&
            !hasUrlScope &&
            !latestBatchQuery.isLoading &&
            (latestBatchQuery.data?.total ?? 0) === 0
        ) {
            return "no_batches";
        }
        if (isLoadingBatchContext) {
            return "loading";
        }
        if (error) {
            return "error";
        }
        if (!apiScopeQuery?.import_batch_id && !apiScopeQuery?.source_snapshot_version) {
            return "no_batches";
        }
        if (apiScopeQuery.import_batch_id || (urlBatch && apiScopeQuery)) {
            return "resolved";
        }
        if (apiScopeQuery.source_snapshot_version && !importBatchId) {
            return "loading";
        }
        return "resolved";
    }, [
        ambiguousBatches,
        enabled,
        hasUrlScope,
        latestBatchQuery.isLoading,
        latestBatchQuery.data?.total,
        isLoadingBatchContext,
        error,
        apiScopeQuery,
        urlBatch,
        importBatchId,
    ]);

    const sourceSnapshotVersion =
        apiScopeQuery?.source_snapshot_version ?? (urlSnapshot || null);

    const isResolvingImportBatch =
        isLoadingBatchContext && !urlBatch && Boolean(urlScopeQuery?.source_snapshot_version);

    const currentBatch = useMemo((): ImportTransportCurrentBatch | null => {
        if (!importBatchId) {
            return null;
        }
        const fromList = batchesForCardQuery.data?.items.find((item) => item.id === importBatchId);
        if (fromList) {
            return batchFromListItem(fromList);
        }
        if (summaryQuery.data) {
            return batchFromSummary(summaryQuery.data, importBatchId);
        }
        return {
            id: importBatchId,
            batch_name: `Import batch #${importBatchId}`,
            import_status: "—",
            validation_status: "—",
            source_snapshot_version: sourceSnapshotVersion,
            imported_at: null,
            created_at: "",
        };
    }, [
        importBatchId,
        batchesForCardQuery.data,
        summaryQuery.data,
        sourceSnapshotVersion,
    ]);

    return useMemo(
        () => ({
            status,
            isLoadingBatchContext,
            isResolvingImportBatch,
            error,
            apiScopeQuery,
            importBatchId,
            sourceSnapshotVersion,
            currentBatch,
            summary: summaryQuery.data,
            ambiguousBatches,
            ambiguousSnapshot,
            applyScopeToUrl,
            selectBatch,
            selectLatestForSnapshot,
            syncResolvedBatchToUrl,
            buildEntityUrl,
        }),
        [
            status,
            isLoadingBatchContext,
            isResolvingImportBatch,
            error,
            apiScopeQuery,
            importBatchId,
            sourceSnapshotVersion,
            currentBatch,
            summaryQuery.data,
            ambiguousBatches,
            ambiguousSnapshot,
            applyScopeToUrl,
            selectBatch,
            selectLatestForSnapshot,
            syncResolvedBatchToUrl,
            buildEntityUrl,
        ]
    );
}

export function ImportTransportBatchScopeProvider({ children }: { children: ReactNode }) {
    const value = useImportTransportBatchContextValue();
    return createElement(ImportTransportBatchScopeContext.Provider, { value }, children);
}

export function useImportTransportBatchContext(): ImportTransportBatchContext {
    const context = useContext(ImportTransportBatchScopeContext);
    if (!context) {
        throw new Error(
            "useImportTransportBatchContext must be used within ImportTransportBatchScopeProvider"
        );
    }
    return context;
}

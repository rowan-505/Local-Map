"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { transportPath } from "@/src/lib/dashboardNavigation";
import {
    getTransportImportBatches,
    getTransportImportErrors,
    getTransportOverview,
    getTransportSourceLinks,
} from "./api";
import {
    TRANSPORT_IMPORTS_STALE_MS,
    useTransportListQuery,
} from "./transportListQuery";
import type {
    TransportImportBatchListItem,
    TransportImportErrorListItem,
    TransportImportIssueBreakdown,
    TransportSourceLinkListItem,
} from "./types";

const PAGE_SIZE = 50;

/** Top import-issue categories shown above the issues table. */
const IMPORT_ISSUE_LABELS: { key: keyof TransportImportIssueBreakdown; label: string }[] = [
    { key: "missingNameMm", label: "Missing Myanmar name" },
    { key: "missingNameEn", label: "Missing English name" },
    { key: "fallbackName", label: "Fallback / generated name" },
    { key: "lowConfidence", label: "Low confidence" },
    { key: "routeGeometry", label: "Route geometry issue" },
    { key: "routeStopMember", label: "Missing route stop member" },
    { key: "other", label: "Other issues" },
];

const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const INPUT_CLASS =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

type TabKey = "batches" | "source-links" | "errors";

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
    { key: "batches", label: "Import batches" },
    { key: "source-links", label: "Source links" },
    { key: "errors", label: "Import issues" },
];

function formatTimestamp(value: string | null): string {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function FilterField({
    label,
    children,
}: {
    readonly label: string;
    readonly children: React.ReactNode;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {label}
            </span>
            {children}
        </label>
    );
}

function PaginationFooter({
    page,
    total,
    loading,
    onPageChange,
}: {
    readonly page: number;
    readonly total: number;
    readonly loading: boolean;
    readonly onPageChange: (page: number) => void;
}) {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(page * PAGE_SIZE, total);
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
            <span aria-live="polite">
                {total === 0
                    ? "0 results"
                    : `${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
            </span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    disabled={loading || page <= 1}
                    onClick={() => onPageChange(page - 1)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Previous
                </button>
                <span className="tabular-nums">
                    Page {page} of {totalPages}
                </span>
                <button
                    type="button"
                    disabled={loading || page >= totalPages}
                    onClick={() => onPageChange(page + 1)}
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Next
                </button>
            </div>
        </div>
    );
}

function ImportBatchesTab() {
    const [sourceName, setSourceName] = useState("");
    const [sourceKind, setSourceKind] = useState("");
    const [status, setStatus] = useState("");
    const [applied, setApplied] = useState({ sourceName: "", sourceKind: "", status: "" });
    const [page, setPage] = useState(1);

    const apiQuery = useMemo(
        () => ({
            sourceName: applied.sourceName || undefined,
            sourceKind: applied.sourceKind || undefined,
            status: applied.status || undefined,
            limit: PAGE_SIZE,
            page,
        }),
        [applied, page]
    );

    const { data, isPending, isFetching, isError, error: queryError } =
        useTransportListQuery<TransportImportBatchListItem>({
            resource: "import-batches",
            params: apiQuery,
            queryFn: (signal) => getTransportImportBatches(apiQuery, { signal }),
            staleTimeMs: TRANSPORT_IMPORTS_STALE_MS,
        });

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const loading = isPending;
    const error = isError
        ? queryError instanceof Error
            ? queryError.message
            : "Failed to load import batches."
        : "";

    const apply = () => {
        setPage(1);
        setApplied({
            sourceName: sourceName.trim(),
            sourceKind: sourceKind.trim(),
            status: status.trim(),
        });
    };
    const reset = () => {
        setSourceName("");
        setSourceKind("");
        setStatus("");
        setPage(1);
        setApplied({ sourceName: "", sourceKind: "", status: "" });
    };

    return (
        <div className="space-y-4">
            <form
                className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                onSubmit={(e) => {
                    e.preventDefault();
                    apply();
                }}
            >
                <FilterField label="Source name">
                    <input
                        value={sourceName}
                        onChange={(e) => setSourceName(e.target.value)}
                        placeholder="Any"
                        className={`w-48 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="Source kind">
                    <input
                        value={sourceKind}
                        onChange={(e) => setSourceKind(e.target.value)}
                        placeholder="Any"
                        className={`w-40 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="Status">
                    <input
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        placeholder="Any"
                        className={`w-40 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <div className="flex gap-2">
                    <button
                        type="submit"
                        className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                        Apply
                    </button>
                    <button
                        type="button"
                        onClick={reset}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Reset
                    </button>
                </div>
            </form>

            {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {error}
                </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                    <thead className="border-b text-xs uppercase text-gray-500">
                        <tr>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2">Kind</th>
                            <th className="px-3 py-2">Scope</th>
                            <th className="px-3 py-2">Mode</th>
                            <th className="px-3 py-2">Status</th>
                            <th className="px-3 py-2">Started</th>
                            <th className="px-3 py-2">Finished</th>
                            <th className="px-3 py-2 text-right">Ins</th>
                            <th className="px-3 py-2 text-right">Upd</th>
                            <th className="px-3 py-2 text-right">Skip</th>
                            <th className="px-3 py-2 text-right">Err</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={11} className="px-3 py-8 text-center text-gray-500">
                                    Loading import batches…
                                </td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={11} className="px-3 py-8 text-center text-gray-500">
                                    No import batches match the current filters.
                                </td>
                            </tr>
                        ) : (
                            items.map((row) => (
                                <tr key={row.public_id} className="border-b border-gray-100">
                                    <td className="px-3 py-2 font-medium text-gray-900">
                                        {row.source_name}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700">{row.source_kind}</td>
                                    <td className="px-3 py-2 text-gray-700">{row.import_scope}</td>
                                    <td className="px-3 py-2 text-gray-700">{row.import_mode}</td>
                                    <td className="px-3 py-2 text-gray-700">{row.status}</td>
                                    <td className="px-3 py-2 text-gray-700">
                                        {formatTimestamp(row.started_at)}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700">
                                        {formatTimestamp(row.finished_at)}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                        {row.inserted_count.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                        {row.updated_count.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                        {row.skipped_count.toLocaleString()}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                        {row.error_count > 0 ? (
                                            <span className="font-medium text-red-700">
                                                {row.error_count.toLocaleString()}
                                            </span>
                                        ) : (
                                            "0"
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <PaginationFooter
                page={page}
                total={total}
                loading={isFetching}
                onPageChange={setPage}
            />
        </div>
    );
}

function SourceLinksTab() {
    const [entityType, setEntityType] = useState("");
    const [entityId, setEntityId] = useState("");
    const [sourceName, setSourceName] = useState("");
    const [sourceKind, setSourceKind] = useState("");
    const [externalId, setExternalId] = useState("");
    const [applied, setApplied] = useState({
        entityType: "",
        entityId: "",
        sourceName: "",
        sourceKind: "",
        externalId: "",
    });
    const [page, setPage] = useState(1);

    const apiQuery = useMemo(() => {
        const idNum = Number(applied.entityId);
        return {
            entityType: applied.entityType || undefined,
            entityId:
                applied.entityId && Number.isFinite(idNum) && idNum >= 1
                    ? Math.floor(idNum)
                    : undefined,
            sourceName: applied.sourceName || undefined,
            sourceKind: applied.sourceKind || undefined,
            externalId: applied.externalId || undefined,
            limit: PAGE_SIZE,
            page,
        };
    }, [applied, page]);

    const { data, isPending, isFetching, isError, error: queryError } =
        useTransportListQuery<TransportSourceLinkListItem>({
            resource: "source-links",
            params: apiQuery,
            queryFn: (signal) => getTransportSourceLinks(apiQuery, { signal }),
            staleTimeMs: TRANSPORT_IMPORTS_STALE_MS,
        });

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const loading = isPending;
    const error = isError
        ? queryError instanceof Error
            ? queryError.message
            : "Failed to load source links."
        : "";

    const apply = () => {
        setPage(1);
        setApplied({
            entityType: entityType.trim(),
            entityId: entityId.trim(),
            sourceName: sourceName.trim(),
            sourceKind: sourceKind.trim(),
            externalId: externalId.trim(),
        });
    };
    const reset = () => {
        setEntityType("");
        setEntityId("");
        setSourceName("");
        setSourceKind("");
        setExternalId("");
        setPage(1);
        setApplied({
            entityType: "",
            entityId: "",
            sourceName: "",
            sourceKind: "",
            externalId: "",
        });
    };

    return (
        <div className="space-y-4">
            <form
                className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                onSubmit={(e) => {
                    e.preventDefault();
                    apply();
                }}
            >
                <FilterField label="Entity type">
                    <input
                        value={entityType}
                        onChange={(e) => setEntityType(e.target.value)}
                        placeholder="e.g. stop, route"
                        className={`w-40 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="Entity ID">
                    <input
                        type="number"
                        min={1}
                        value={entityId}
                        onChange={(e) => setEntityId(e.target.value)}
                        placeholder="Any"
                        className={`w-28 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="Source name">
                    <input
                        value={sourceName}
                        onChange={(e) => setSourceName(e.target.value)}
                        placeholder="Any"
                        className={`w-40 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="Source kind">
                    <input
                        value={sourceKind}
                        onChange={(e) => setSourceKind(e.target.value)}
                        placeholder="e.g. osm_way"
                        className={`w-40 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="External ID">
                    <input
                        value={externalId}
                        onChange={(e) => setExternalId(e.target.value)}
                        placeholder="Any"
                        className={`w-40 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <div className="flex gap-2">
                    <button
                        type="submit"
                        className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                        Apply
                    </button>
                    <button
                        type="button"
                        onClick={reset}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Reset
                    </button>
                </div>
            </form>

            {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {error}
                </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                    <thead className="border-b text-xs uppercase text-gray-500">
                        <tr>
                            <th className="px-3 py-2">Entity type</th>
                            <th className="px-3 py-2 text-right">Entity ID</th>
                            <th className="px-3 py-2">Source</th>
                            <th className="px-3 py-2">Kind</th>
                            <th className="px-3 py-2">External ID</th>
                            <th className="px-3 py-2">Primary</th>
                            <th className="px-3 py-2 text-right">Confidence</th>
                            <th className="px-3 py-2">Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                                    Loading source links…
                                </td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                                    No source links match the current filters.
                                </td>
                            </tr>
                        ) : (
                            items.map((row) => (
                                <tr key={row.id} className="border-b border-gray-100">
                                    <td className="px-3 py-2 text-gray-700">{row.entity_type}</td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                        {row.entity_id}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700">{row.source_name}</td>
                                    <td className="px-3 py-2 text-gray-700">{row.source_kind}</td>
                                    <td className="px-3 py-2 font-mono text-xs text-gray-700">
                                        {row.external_id ?? "—"}
                                    </td>
                                    <td className="px-3 py-2">
                                        {row.is_primary ? (
                                            <span className="text-emerald-700">Primary</span>
                                        ) : (
                                            <span className="text-gray-400">—</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                        {row.confidence_score === null
                                            ? "—"
                                            : Math.round(row.confidence_score)}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700">
                                        {formatTimestamp(row.created_at)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <PaginationFooter
                page={page}
                total={total}
                loading={isFetching}
                onPageChange={setPage}
            />
        </div>
    );
}

/** Read-only top-category breakdown of import issues (reuses the cached overview aggregate). */
function ImportIssueBreakdownPanel() {
    // Cached overview aggregate (60s); shared across tab visits so revisiting the
    // Issues tab does not re-fetch the breakdown.
    const { data: overview } = useQuery({
        queryKey: ["transport", "overview"],
        queryFn: ({ signal }) => getTransportOverview({ signal }),
        staleTime: TRANSPORT_IMPORTS_STALE_MS,
    });

    const issues: TransportImportIssueBreakdown | null = overview?.importIssues ?? null;
    const total = overview?.counts.importErrors ?? 0;

    if (!issues) {
        return null;
    }

    const entries = IMPORT_ISSUE_LABELS.map((entry) => ({
        ...entry,
        value: issues[entry.key],
    }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value);

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">
                    Top import issues ({total.toLocaleString()})
                </h2>
            </div>
            {entries.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No import issues recorded.</p>
            ) : (
                <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {entries.map((entry) => (
                        <li
                            key={entry.key}
                            className="flex items-center justify-between gap-3 text-sm"
                        >
                            <span className="text-gray-700">{entry.label}</span>
                            <span className="font-medium tabular-nums text-gray-900">
                                {entry.value.toLocaleString()}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ImportErrorsTab() {
    const [importBatchId, setImportBatchId] = useState("");
    const [entityType, setEntityType] = useState("");
    const [errorCode, setErrorCode] = useState("");
    const [search, setSearch] = useState("");
    const [applied, setApplied] = useState({
        importBatchId: "",
        entityType: "",
        errorCode: "",
        search: "",
    });
    const [page, setPage] = useState(1);

    const apiQuery = useMemo(() => {
        const batchNum = Number(applied.importBatchId);
        return {
            importBatchId:
                applied.importBatchId && Number.isFinite(batchNum) && batchNum >= 1
                    ? Math.floor(batchNum)
                    : undefined,
            entityType: applied.entityType || undefined,
            errorCode: applied.errorCode || undefined,
            search: applied.search || undefined,
            limit: PAGE_SIZE,
            page,
        };
    }, [applied, page]);

    const { data, isPending, isFetching, isError, error: queryError } =
        useTransportListQuery<TransportImportErrorListItem>({
            resource: "import-errors",
            params: apiQuery,
            queryFn: (signal) => getTransportImportErrors(apiQuery, { signal }),
            staleTimeMs: TRANSPORT_IMPORTS_STALE_MS,
        });

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const loading = isPending;
    const error = isError
        ? queryError instanceof Error
            ? queryError.message
            : "Failed to load import issues."
        : "";

    const apply = () => {
        setPage(1);
        setApplied({
            importBatchId: importBatchId.trim(),
            entityType: entityType.trim(),
            errorCode: errorCode.trim(),
            search: search.trim(),
        });
    };
    const reset = () => {
        setImportBatchId("");
        setEntityType("");
        setErrorCode("");
        setSearch("");
        setPage(1);
        setApplied({ importBatchId: "", entityType: "", errorCode: "", search: "" });
    };

    return (
        <div className="space-y-4">
            <ImportIssueBreakdownPanel />
            <form
                className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                onSubmit={(e) => {
                    e.preventDefault();
                    apply();
                }}
            >
                <FilterField label="Import batch ID">
                    <input
                        type="number"
                        min={1}
                        value={importBatchId}
                        onChange={(e) => setImportBatchId(e.target.value)}
                        placeholder="Any"
                        className={`w-28 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="Entity type">
                    <input
                        value={entityType}
                        onChange={(e) => setEntityType(e.target.value)}
                        placeholder="e.g. stop, route"
                        className={`w-40 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="Error code">
                    <input
                        value={errorCode}
                        onChange={(e) => setErrorCode(e.target.value)}
                        placeholder="e.g. WARN_FALLBACK_NAME"
                        className={`w-52 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <FilterField label="Search external ID / message">
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Any"
                        autoComplete="off"
                        className={`w-56 ${INPUT_CLASS}`}
                    />
                </FilterField>
                <div className="flex gap-2">
                    <button
                        type="submit"
                        className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                        Apply
                    </button>
                    <button
                        type="button"
                        onClick={reset}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Reset
                    </button>
                </div>
            </form>

            {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    {error}
                </div>
            ) : null}

            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                    <thead className="border-b text-xs uppercase text-gray-500">
                        <tr>
                            <th className="px-3 py-2 text-right">Batch</th>
                            <th className="px-3 py-2">Entity type</th>
                            <th className="px-3 py-2">External ID</th>
                            <th className="px-3 py-2">Error code</th>
                            <th className="px-3 py-2">Message</th>
                            <th className="px-3 py-2">Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                                    Loading import issues…
                                </td>
                            </tr>
                        ) : items.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-3 py-8 text-center text-gray-500">
                                    No import issues match the current filters.
                                </td>
                            </tr>
                        ) : (
                            items.map((row) => (
                                <tr key={row.id} className="border-b border-gray-100 align-top">
                                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                        {row.import_batch_id ?? "—"}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700">{row.entity_type}</td>
                                    <td className="px-3 py-2 font-mono text-xs text-gray-700">
                                        {row.external_id ?? "—"}
                                    </td>
                                    <td className="px-3 py-2 text-gray-700">{row.error_code}</td>
                                    <td className="px-3 py-2 text-gray-700">
                                        <span className="block max-w-md wrap-break-word">
                                            {row.error_message}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-gray-700">
                                        {formatTimestamp(row.created_at)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <PaginationFooter
                page={page}
                total={total}
                loading={isFetching}
                onPageChange={setPage}
            />
        </div>
    );
}

export default function TransportImportsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeTab = useMemo<TabKey>(() => {
        const t = searchParams.get("tab");
        return t === "source-links" || t === "errors" ? t : "batches";
    }, [searchParams]);

    const setTab = useCallback(
        (tab: TabKey) => {
            const base = transportPath("imports");
            router.replace(tab === "batches" ? base : `${base}?tab=${tab}`);
        },
        [router]
    );

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Imports</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Read-only view of transport import batches, source links, and import
                        issues. This page does not run or retry imports.
                    </p>
                    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Skipped
                            </dt>
                            <dd className="mt-0.5 text-xs text-gray-600">
                                Candidates intentionally ignored because they were not publishable
                                or useful for the transport tables.
                            </dd>
                        </div>
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                            <dt className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                                Issues
                            </dt>
                            <dd className="mt-0.5 text-xs text-amber-900">
                                Warnings or problems recorded during import. Many are
                                missing-name / fallback-name warnings, not fatal failures.
                            </dd>
                        </div>
                    </dl>
                </header>

                <div className="flex gap-1 border-b border-gray-200">
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setTab(tab.key)}
                            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                                activeTab === tab.key
                                    ? "border-gray-900 text-gray-900"
                                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {activeTab === "batches" ? <ImportBatchesTab /> : null}
                {activeTab === "source-links" ? <SourceLinksTab /> : null}
                {activeTab === "errors" ? <ImportErrorsTab /> : null}
            </div>
        </main>
    );
}

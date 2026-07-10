"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";

import {
    createSearchAlias,
    listFailedSearches,
    listSearchDocuments,
    updateFailedSearch,
} from "./api";
import FailedSearchInspectPanel from "./FailedSearchInspectPanel";
import FailedSearchResolveDialog from "./FailedSearchResolveDialog";
import SearchAliasFormDialog, { type SearchAliasFormValues } from "./SearchAliasFormDialog";
import SearchDocumentInspectPanel from "./SearchDocumentInspectPanel";
import type { SelectedSearchEntity } from "./SearchEntityPicker";
import {
    FAILED_SEARCH_SORT_OPTIONS,
    SEARCH_ALIAS_LANGUAGE_OPTIONS,
    failedSearchFilterSummary,
    formatDateTime,
    resolutionTypeLabel,
} from "./constants";
import { formatMutationSuccess } from "./searchAliasMessages";
import { getSearchListPageState } from "./searchListPageState";
import type {
    FailedSearchItem,
    FailedSearchResolutionType,
    FailedSearchesListFilters,
    SearchDocumentItem,
} from "./types";
import { CELL_TEXT_CLASS, INPUT_CLASS, PRIMARY_BTN, SECONDARY_BTN, SELECT_CLASS, useClampPageToTotal } from "./ui";

const PAGE_SIZE = 25;

type TriState = "" | "true" | "false";

type Filters = {
    q: string;
    lang: string;
    resolved: TriState;
    min_occurrence: string;
    last_seen_from: string;
    last_seen_to: string;
    sort: string;
    order: "asc" | "desc";
};

const EMPTY_FILTERS: Filters = {
    q: "",
    lang: "",
    resolved: "false",
    min_occurrence: "",
    last_seen_from: "",
    last_seen_to: "",
    sort: "occurrence_count",
    order: "desc",
};

type FlashMessage = {
    type: "success" | "error";
    message: string;
};

function toIsoStart(value: string): string | undefined {
    if (!value) return undefined;
    return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function toIsoEnd(value: string): string | undefined {
    if (!value) return undefined;
    return new Date(`${value}T23:59:59.999Z`).toISOString();
}

function parseMinOccurrence(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export default function SearchFailedSearchesPage() {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [searchInput, setSearchInput] = useState("");
    const [page, setPage] = useState(1);

    const [data, setData] = useState<Awaited<ReturnType<typeof listFailedSearches>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [flash, setFlash] = useState<FlashMessage | null>(null);
    const requestSequence = useRef(0);

    const [inspectItem, setInspectItem] = useState<FailedSearchItem | null>(null);
    const [candidateDocuments, setCandidateDocuments] = useState<SearchDocumentItem[]>([]);
    const [candidateLoading, setCandidateLoading] = useState(false);
    const [inspectDocument, setInspectDocument] = useState<SearchDocumentItem | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    const [aliasDialogItem, setAliasDialogItem] = useState<FailedSearchItem | null>(null);
    const [presetEntity, setPresetEntity] = useState<SelectedSearchEntity | null>(null);
    const [aliasFormError, setAliasFormError] = useState("");
    const [aliasSaving, setAliasSaving] = useState(false);

    const [resolveDialogItem, setResolveDialogItem] = useState<FailedSearchItem | null>(null);
    const [resolveError, setResolveError] = useState("");
    const [resolveSaving, setResolveSaving] = useState(false);

    const apiFilters = useMemo<FailedSearchesListFilters>(
        () => ({
            q: filters.q || undefined,
            lang: filters.lang || undefined,
            resolved: filters.resolved === "" ? undefined : filters.resolved === "true",
            min_occurrence: parseMinOccurrence(filters.min_occurrence),
            last_seen_from: toIsoStart(filters.last_seen_from),
            last_seen_to: toIsoEnd(filters.last_seen_to),
            sort: filters.sort,
            order: filters.order,
            page,
            pageSize: PAGE_SIZE,
        }),
        [filters, page],
    );

    const load = useCallback(
        async (signal?: AbortSignal) => {
            const requestId = requestSequence.current + 1;
            requestSequence.current = requestId;
            setLoading(true);
            setError("");
            try {
                const res = await listFailedSearches(apiFilters, signal ? { signal } : undefined);
                if (requestSequence.current !== requestId) return;
                setData(res);
            } catch (err) {
                if (isAbortError(err)) return;
                if (requestSequence.current !== requestId) return;
                setError(err instanceof Error ? err.message : "Failed to load failed searches.");
                setData(null);
            } finally {
                if (requestSequence.current === requestId) {
                    setLoading(false);
                }
            }
        },
        [apiFilters],
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const loadCandidates = useCallback(async (item: FailedSearchItem, signal?: AbortSignal) => {
        setCandidateLoading(true);
        try {
            const res = await listSearchDocuments(
                {
                    q: item.normalized_query ?? item.query,
                    is_active: true,
                    is_public: true,
                    page: 1,
                    pageSize: 6,
                    sort: "name",
                    order: "asc",
                },
                signal ? { signal } : undefined,
            );
            setCandidateDocuments(res.items);
        } catch (err) {
            if (isAbortError(err)) return;
            setCandidateDocuments([]);
        } finally {
            setCandidateLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!inspectItem) {
            setCandidateDocuments([]);
            setPresetEntity(null);
            return;
        }
        const controller = new AbortController();
        void loadCandidates(inspectItem, controller.signal);
        return () => controller.abort();
    }, [inspectItem, loadCandidates]);

    const selectedAliasTargetKey = presetEntity
        ? `${presetEntity.entity_type}:${presetEntity.entity_id}`
        : null;

    const patch = useCallback((next: Partial<Filters>) => {
        setFilters((prev) => ({ ...prev, ...next }));
        setPage(1);
    }, []);

    const resetFilters = useCallback(() => {
        setFilters(EMPTY_FILTERS);
        setSearchInput("");
        setPage(1);
    }, []);

    const handleCreateAlias = useCallback(
        async (values: SearchAliasFormValues) => {
            if (!aliasDialogItem) return;
            if (!values.entity) {
                setAliasFormError("Select an indexed searchable entity.");
                return;
            }

            setAliasSaving(true);
            setAliasFormError("");
            try {
                const language =
                    values.language_code.trim() === "" ? null : values.language_code.trim();
                const created = await createSearchAlias({
                    entity_type: values.entity.entity_type,
                    entity_id: values.entity.entity_id,
                    alias_text: values.alias_text.trim(),
                    alias_type: values.alias_type,
                    language_code: language,
                    source: `failed_search:${aliasDialogItem.id}`,
                });

                let resolved: FailedSearchItem;
                try {
                    resolved = await updateFailedSearch(aliasDialogItem.id, {
                        action: "resolve",
                        resolution_type: "alias",
                        linked_alias_id: created.id,
                    });
                } catch (resolveErr) {
                    setAliasFormError(
                        resolveErr instanceof Error
                            ? `Alias was created, but marking this failed search resolved failed: ${resolveErr.message}`
                            : "Alias was created, but marking this failed search resolved failed.",
                    );
                    setAliasDialogItem(null);
                    await load();
                    return;
                }

                setFlash({
                    type: created.index_sync?.ok === false ? "error" : "success",
                    message: `${formatMutationSuccess(created, "created")} Failed search marked resolved.`,
                });
                setAliasDialogItem(null);
                setPresetEntity(null);
                setInspectItem(resolved);
                await load();
            } catch (err) {
                setAliasFormError(err instanceof Error ? err.message : "Failed to create alias.");
            } finally {
                setAliasSaving(false);
            }
        },
        [aliasDialogItem, load],
    );

    const handleMarkResolved = useCallback(
        async (resolutionType: FailedSearchResolutionType) => {
            if (!resolveDialogItem) return;
            setResolveSaving(true);
            setResolveError("");
            try {
                const updated = await updateFailedSearch(resolveDialogItem.id, {
                    action: "resolve",
                    resolution_type: resolutionType,
                });
                setFlash({
                    type: "success",
                    message: `Failed search marked resolved (${resolutionTypeLabel(resolutionType)}).`,
                });
                setResolveDialogItem(null);
                setInspectItem(updated);
                await load();
            } catch (err) {
                setResolveError(
                    err instanceof Error ? err.message : "Failed to mark search as resolved.",
                );
            } finally {
                setResolveSaving(false);
            }
        },
        [resolveDialogItem, load],
    );

    const handleReopen = useCallback(async () => {
        if (!inspectItem) return;
        if (!window.confirm(`Reopen failed search "${inspectItem.query}" for review?`)) {
            return;
        }
        setActionLoading(true);
        setFlash(null);
        try {
            const updated = await updateFailedSearch(inspectItem.id, { action: "reopen" });
            setFlash({ type: "success", message: "Failed search reopened." });
            setInspectItem(updated);
            await load();
        } catch (err) {
            setFlash({
                type: "error",
                message: err instanceof Error ? err.message : "Failed to reopen failed search.",
            });
        } finally {
            setActionLoading(false);
        }
    }, [inspectItem, load]);

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    useClampPageToTotal(page, setPage, total, PAGE_SIZE);
    const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(page * PAGE_SIZE, total);
    const tableState = getSearchListPageState({ loading, error, data, items });

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Failed searches</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Review repeated zero-result queries and convert them into aliases or mark
                        them resolved. Aliases are never auto-created.
                    </p>
                </header>

                {flash ? (
                    <div
                        className={`rounded-lg border p-4 text-sm ${
                            flash.type === "success"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                                : "border-red-200 bg-red-50 text-red-800"
                        }`}
                    >
                        {flash.message}
                    </div>
                ) : null}

                <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <form
                        className="flex flex-col gap-2 sm:flex-row"
                        onSubmit={(e) => {
                            e.preventDefault();
                            patch({ q: searchInput.trim() });
                        }}
                    >
                        <input
                            type="search"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search failed query text…"
                            className={`${INPUT_CLASS} flex-1`}
                        />
                        <div className="flex gap-2">
                            <button type="submit" className={PRIMARY_BTN}>
                                Search
                            </button>
                            <button type="button" className={SECONDARY_BTN} onClick={resetFilters}>
                                Reset
                            </button>
                        </div>
                    </form>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Status</span>
                            <select
                                value={filters.resolved}
                                onChange={(e) => patch({ resolved: e.target.value as TriState })}
                                className={SELECT_CLASS}
                            >
                                <option value="false">Unresolved</option>
                                <option value="true">Resolved</option>
                                <option value="">All</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Language</span>
                            <select
                                value={filters.lang}
                                onChange={(e) => patch({ lang: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                {SEARCH_ALIAS_LANGUAGE_OPTIONS.filter((o) => o.value).map(
                                    (option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Min occurrences</span>
                            <input
                                type="number"
                                min={1}
                                value={filters.min_occurrence}
                                onChange={(e) => patch({ min_occurrence: e.target.value })}
                                placeholder="e.g. 3"
                                className={INPUT_CLASS}
                            />
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Last seen from</span>
                            <input
                                type="date"
                                value={filters.last_seen_from}
                                onChange={(e) => patch({ last_seen_from: e.target.value })}
                                className={INPUT_CLASS}
                            />
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Last seen to</span>
                            <input
                                type="date"
                                value={filters.last_seen_to}
                                onChange={(e) => patch({ last_seen_to: e.target.value })}
                                className={INPUT_CLASS}
                            />
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Sort</span>
                            <select
                                value={filters.sort}
                                onChange={(e) => patch({ sort: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                {FAILED_SEARCH_SORT_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Order</span>
                            <select
                                value={filters.order}
                                onChange={(e) =>
                                    patch({ order: e.target.value as Filters["order"] })
                                }
                                className={SELECT_CLASS}
                            >
                                <option value="desc">Descending</option>
                                <option value="asc">Ascending</option>
                            </select>
                        </label>
                    </div>
                </div>

                {error ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        <span>{error}</span>
                        <button
                            type="button"
                            className={SECONDARY_BTN}
                            onClick={() => void load()}
                        >
                            Retry
                        </button>
                    </div>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-4 py-3">Query</th>
                                <th className="px-4 py-3">Count</th>
                                <th className="px-4 py-3">Language</th>
                                <th className="px-4 py-3">Filter context</th>
                                <th className="px-4 py-3">Last seen</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {tableState === "loading" ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                                        Loading failed searches…
                                    </td>
                                </tr>
                            ) : tableState === "error" ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-red-700">
                                        Failed searches could not be loaded.
                                    </td>
                                </tr>
                            ) : tableState === "idle" ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                                        Failed searches have not loaded yet.
                                    </td>
                                </tr>
                            ) : tableState === "empty" ? (
                                <tr>
                                    <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                                        No failed searches match the current filters.
                                    </td>
                                </tr>
                            ) : (
                                items.map((item) => (
                                    <tr key={item.id} className="align-top hover:bg-gray-50">
                                        <td className={`px-4 py-3 ${CELL_TEXT_CLASS}`}>
                                            <div className="font-medium text-gray-900">{item.query}</div>
                                            <div className="text-xs text-gray-500">
                                                {item.normalized_query}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-900">
                                            {item.occurrence_count.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-gray-700">
                                            {item.language ?? "—"}
                                        </td>
                                        <td className="px-4 py-3 text-gray-700">
                                            {failedSearchFilterSummary(item)}
                                        </td>
                                        <td className="px-4 py-3 text-gray-600">
                                            {formatDateTime(item.last_seen_at)}
                                        </td>
                                        <td className="px-4 py-3">
                                            {item.is_resolved ? (
                                                <span className="text-emerald-700">Resolved</span>
                                            ) : (
                                                <span className="text-amber-700">Open</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                type="button"
                                                className={SECONDARY_BTN}
                                                onClick={() => {
                                                    setInspectItem(item);
                                                    setFlash(null);
                                                }}
                                            >
                                                Inspect
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-gray-600">
                        {total === 0
                            ? "No results"
                            : `Showing ${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
                    </p>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className={SECONDARY_BTN}
                            disabled={page <= 1 || loading}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                            Previous
                        </button>
                        <span className="text-sm text-gray-600">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            type="button"
                            className={SECONDARY_BTN}
                            disabled={page >= totalPages || loading}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>

            {inspectItem ? (
                <FailedSearchInspectPanel
                    item={inspectItem}
                    candidateDocuments={candidateDocuments}
                    candidateLoading={candidateLoading}
                    selectedAliasTargetKey={selectedAliasTargetKey}
                    actionLoading={actionLoading}
                    onClose={() => {
                        setInspectItem(null);
                        setPresetEntity(null);
                    }}
                    onCreateAlias={() => {
                        if (!presetEntity) {
                            setFlash({
                                type: "error",
                                message: "Select an indexed target before creating an alias.",
                            });
                            return;
                        }
                        setAliasDialogItem(inspectItem);
                        setAliasFormError("");
                    }}
                    onMarkResolved={() => {
                        setResolveDialogItem(inspectItem);
                        setResolveError("");
                    }}
                    onReopen={() => void handleReopen()}
                    onInspectDocument={(document) => setInspectDocument(document)}
                    onUseAsAliasTarget={(document) => {
                        setPresetEntity({
                            entity_type: document.entity_type,
                            entity_id: document.entity_id,
                            display_name: document.display_name ?? "Untitled",
                            public_id: document.public_id,
                        });
                        setFlash(null);
                    }}
                />
            ) : null}

            {aliasDialogItem ? (
                <SearchAliasFormDialog
                    mode="create"
                    presetEntity={presetEntity}
                    presetAliasText={aliasDialogItem.query}
                    presetLanguageCode={aliasDialogItem.language ?? ""}
                    saving={aliasSaving}
                    error={aliasFormError}
                    onClose={() => {
                        if (aliasSaving) return;
                        setAliasDialogItem(null);
                        setPresetEntity(null);
                        setAliasFormError("");
                    }}
                    onSubmit={handleCreateAlias}
                />
            ) : null}

            {resolveDialogItem ? (
                <FailedSearchResolveDialog
                    query={resolveDialogItem.query}
                    saving={resolveSaving}
                    error={resolveError}
                    onClose={() => {
                        if (resolveSaving) return;
                        setResolveDialogItem(null);
                        setResolveError("");
                    }}
                    onConfirm={handleMarkResolved}
                />
            ) : null}

            {inspectDocument ? (
                <SearchDocumentInspectPanel
                    item={inspectDocument}
                    onClose={() => setInspectDocument(null)}
                />
            ) : null}
        </main>
    );
}

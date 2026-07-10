"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";

import { listSearchDocuments } from "./api";
import SearchDocumentInspectPanel from "./SearchDocumentInspectPanel";
import {
    SEARCH_ALIAS_ENTITY_TYPES,
    SEARCH_DOCUMENT_SORT_OPTIONS,
    SEARCH_DOCUMENT_SYNC_STATES,
    TRANSPORT_MODE_OPTIONS,
    entityTypeLabel,
    formatDateTime,
    syncStateLabel,
} from "./constants";
import type { SearchDocumentItem, SearchDocumentsListFilters } from "./types";
import {
    INPUT_CLASS,
    PRIMARY_BTN,
    SECONDARY_BTN,
    SELECT_CLASS,
    SyncStateBadge,
    CELL_TEXT_CLASS,
    useClampPageToTotal,
} from "./ui";

const PAGE_SIZE = 25;

type TriState = "" | "true" | "false";

type Filters = {
    q: string;
    entity_type: string;
    transport_mode: string;
    review_status: string;
    is_verified: TriState;
    is_public: TriState;
    is_active: TriState;
    has_alias: TriState;
    sync_state: string;
    language: string;
    sort: string;
    order: "asc" | "desc";
};

const EMPTY_FILTERS: Filters = {
    q: "",
    entity_type: "",
    transport_mode: "",
    review_status: "",
    is_verified: "",
    is_public: "",
    is_active: "",
    has_alias: "",
    sync_state: "",
    language: "",
    sort: "indexed_at",
    order: "desc",
};

export default function SearchDocumentsPage() {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [searchInput, setSearchInput] = useState("");
    const [page, setPage] = useState(1);
    const [inspectItem, setInspectItem] = useState<SearchDocumentItem | null>(null);

    const [data, setData] = useState<Awaited<ReturnType<typeof listSearchDocuments>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const apiFilters = useMemo<SearchDocumentsListFilters>(
        () => ({
            q: filters.q || undefined,
            entity_type: filters.entity_type || undefined,
            transport_mode: filters.transport_mode || undefined,
            review_status: filters.review_status || undefined,
            is_verified:
                filters.is_verified === "" ? undefined : filters.is_verified === "true",
            is_public: filters.is_public === "" ? undefined : filters.is_public === "true",
            is_active: filters.is_active === "" ? undefined : filters.is_active === "true",
            has_alias: filters.has_alias === "" ? undefined : filters.has_alias === "true",
            sync_state:
                filters.sync_state === ""
                    ? undefined
                    : (filters.sync_state as SearchDocumentsListFilters["sync_state"]),
            language:
                filters.language === ""
                    ? undefined
                    : (filters.language as SearchDocumentsListFilters["language"]),
            sort: filters.sort,
            order: filters.order,
            page,
            pageSize: PAGE_SIZE,
        }),
        [filters, page],
    );

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const res = await listSearchDocuments(apiFilters, signal ? { signal } : undefined);
                setData(res);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load search documents.");
                setData(null);
            } finally {
                setLoading(false);
            }
        },
        [apiFilters],
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const patch = useCallback((next: Partial<Filters>) => {
        setFilters((prev) => ({ ...prev, ...next }));
        setPage(1);
    }, []);

    const resetFilters = useCallback(() => {
        setFilters(EMPTY_FILTERS);
        setSearchInput("");
        setPage(1);
    }, []);

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    useClampPageToTotal(page, setPage, total, PAGE_SIZE);
    const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(page * PAGE_SIZE, total);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Search documents</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Inspect unified search index rows, sync freshness, and alias coverage. Canonical
                        names are read-only; use aliases to improve matching.
                    </p>
                </header>

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
                            placeholder="Search display name, public id, or entity id…"
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
                            <span className="text-gray-600">Entity type</span>
                            <select
                                value={filters.entity_type}
                                onChange={(e) => patch({ entity_type: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                {SEARCH_ALIAS_ENTITY_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                        {entityTypeLabel(type)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Transport mode</span>
                            <select
                                value={filters.transport_mode}
                                onChange={(e) => patch({ transport_mode: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                {TRANSPORT_MODE_OPTIONS.map((mode) => (
                                    <option key={mode} value={mode}>
                                        {mode}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Review status</span>
                            <input
                                value={filters.review_status}
                                onChange={(e) => patch({ review_status: e.target.value })}
                                placeholder="verified, reviewed…"
                                className={INPUT_CLASS}
                            />
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Sync state</span>
                            <select
                                value={filters.sync_state}
                                onChange={(e) => patch({ sync_state: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All indexed states</option>
                                {SEARCH_DOCUMENT_SYNC_STATES.map((state) => (
                                    <option key={state} value={state}>
                                        {syncStateLabel(state)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Verified</span>
                            <select
                                value={filters.is_verified}
                                onChange={(e) =>
                                    patch({ is_verified: e.target.value as TriState })
                                }
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                <option value="true">Verified</option>
                                <option value="false">Not verified</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Public</span>
                            <select
                                value={filters.is_public}
                                onChange={(e) => patch({ is_public: e.target.value as TriState })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                <option value="true">Public</option>
                                <option value="false">Not public</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Active</span>
                            <select
                                value={filters.is_active}
                                onChange={(e) => patch({ is_active: e.target.value as TriState })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                <option value="true">Active</option>
                                <option value="false">Inactive</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Has alias</span>
                            <select
                                value={filters.has_alias}
                                onChange={(e) => patch({ has_alias: e.target.value as TriState })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                <option value="true">Has aliases</option>
                                <option value="false">No aliases</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Language</span>
                            <select
                                value={filters.language}
                                onChange={(e) => patch({ language: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                <option value="my">Myanmar primary</option>
                                <option value="en">English primary</option>
                                <option value="und">Undetermined primary</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Sort</span>
                            <select
                                value={filters.sort}
                                onChange={(e) => patch({ sort: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                {SEARCH_DOCUMENT_SORT_OPTIONS.map((option) => (
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
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Entity</th>
                                <th className="px-4 py-3">Mode</th>
                                <th className="px-4 py-3">Review</th>
                                <th className="px-4 py-3">Sync</th>
                                <th className="px-4 py-3">Scores</th>
                                <th className="px-4 py-3">Aliases</th>
                                <th className="px-4 py-3">Indexed</th>
                                <th className="px-4 py-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {loading ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                                        Loading search documents…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                                        No search documents match the current filters.
                                    </td>
                                </tr>
                            ) : (
                                items.map((item) => (
                                    <tr key={`${item.entity_type}:${item.entity_id}`} className="align-top hover:bg-gray-50">
                                        <td className={`px-4 py-3 ${CELL_TEXT_CLASS}`}>
                                            <div className="font-medium text-gray-900">
                                                {item.display_name ?? "Untitled"}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {item.public_id ?? "No public id"}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div>{entityTypeLabel(item.entity_type)}</div>
                                            <div className="text-xs text-gray-500">id {item.entity_id}</div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-700">
                                            {item.transport_mode ?? "—"}
                                        </td>
                                        <td className="px-4 py-3 text-gray-700">
                                            {item.review_status ?? "—"}
                                        </td>
                                        <td className="px-4 py-3">
                                            <SyncStateBadge
                                                state={item.sync_state}
                                                label={syncStateLabel(item.sync_state)}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-gray-700">
                                            <div>Imp {item.importance_score}</div>
                                            <div className="text-xs text-gray-500">
                                                Conf {item.confidence_score}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 tabular-nums text-gray-700">
                                            {item.alias_count}
                                        </td>
                                        <td className="px-4 py-3 text-gray-600">
                                            {formatDateTime(item.indexed_at)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col gap-2">
                                                <button
                                                    type="button"
                                                    className={SECONDARY_BTN}
                                                    onClick={() => setInspectItem(item)}
                                                >
                                                    Inspect
                                                </button>
                                            </div>
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
                <SearchDocumentInspectPanel item={inspectItem} onClose={() => setInspectItem(null)} />
            ) : null}
        </main>
    );
}

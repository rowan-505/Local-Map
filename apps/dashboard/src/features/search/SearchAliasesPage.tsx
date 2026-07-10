"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { searchPath } from "@/src/lib/dashboardNavigation";

import {
    createSearchAlias,
    disableSearchAlias,
    listSearchAliases,
    listSearchDocuments,
    updateSearchAlias,
} from "./api";
import SearchAliasFormDialog, { type SearchAliasFormValues } from "./SearchAliasFormDialog";
import SearchDocumentInspectPanel from "./SearchDocumentInspectPanel";
import type { SelectedSearchEntity } from "./SearchEntityPicker";
import {
    SEARCH_ALIAS_ENTITY_TYPES,
    SEARCH_ALIAS_LANGUAGE_OPTIONS,
    SEARCH_ALIAS_SORT_OPTIONS,
    SEARCH_ALIAS_TYPES,
    aliasTypeLabel,
    entityTypeLabel,
    formatDateTime,
} from "./constants";
import { formatMutationSuccess } from "./searchAliasMessages";
import {
    SEARCH_ALIASES_FILTERED_EMPTY_LABEL,
    SEARCH_ALIASES_TRUE_EMPTY_LABEL,
    getSearchAliasesTableState,
    hasSearchAliasListFilters,
    readSearchAliasUrlFilters,
} from "./searchAliasesPageState";
import type { SearchAliasItem, SearchAliasesListFilters, SearchDocumentItem } from "./types";
import { ActiveBadge, CELL_TEXT_CLASS, INPUT_CLASS, PRIMARY_BTN, SECONDARY_BTN, SELECT_CLASS, useClampPageToTotal } from "./ui";

const PAGE_SIZE = 25;

type TriState = "" | "true" | "false";

type Filters = {
    q: string;
    entity_type: string;
    language_code: string;
    alias_type: string;
    is_active: TriState;
    sort: string;
    order: "asc" | "desc";
};

const EMPTY_FILTERS: Filters = {
    q: "",
    entity_type: "",
    language_code: "",
    alias_type: "",
    is_active: "",
    sort: "updated_at",
    order: "desc",
};

type FlashMessage = {
    type: "success" | "error";
    message: string;
};

export default function SearchAliasesPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const initialUrlFilters = readSearchAliasUrlFilters(searchParams);

    const [filters, setFilters] = useState<Filters>(() => ({
        ...EMPTY_FILTERS,
        entity_type: initialUrlFilters.entity_type,
    }));
    const [entityIdFilter, setEntityIdFilter] = useState(initialUrlFilters.entity_id);
    const [searchInput, setSearchInput] = useState("");
    const [page, setPage] = useState(1);

    const [data, setData] = useState<Awaited<ReturnType<typeof listSearchAliases>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [flash, setFlash] = useState<FlashMessage | null>(null);
    const requestSequence = useRef(0);

    const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
    const [editingItem, setEditingItem] = useState<SearchAliasItem | null>(null);
    const [presetEntity, setPresetEntity] = useState<SelectedSearchEntity | null>(null);
    const [formError, setFormError] = useState("");
    const [saving, setSaving] = useState(false);
    const [rowActionId, setRowActionId] = useState<string | null>(null);

    const [inspectDocument, setInspectDocument] = useState<SearchDocumentItem | null>(null);
    const [inspectLoadingId, setInspectLoadingId] = useState<string | null>(null);

    const apiFilters = useMemo<SearchAliasesListFilters>(
        () => ({
            q: filters.q || undefined,
            entity_type: filters.entity_type || undefined,
            language_code: filters.language_code || undefined,
            alias_type: filters.alias_type || undefined,
            is_active:
                filters.is_active === "" ? undefined : filters.is_active === "true",
            entity_id: entityIdFilter || undefined,
            sort: filters.sort,
            order: filters.order,
            page,
            pageSize: PAGE_SIZE,
        }),
        [filters, entityIdFilter, page],
    );

    const load = useCallback(
        async (signal?: AbortSignal) => {
            const requestId = requestSequence.current + 1;
            requestSequence.current = requestId;
            setLoading(true);
            setError("");
            try {
                const res = await listSearchAliases(apiFilters, signal ? { signal } : undefined);
                if (requestSequence.current !== requestId) return;
                setData(res);
            } catch (err) {
                if (isAbortError(err)) return;
                if (requestSequence.current !== requestId) return;
                setError(err instanceof Error ? err.message : "Failed to load search aliases.");
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

    const urlEntityType = searchParams.get("entity_type") ?? "";
    const urlEntityId = searchParams.get("entity_id")?.replace(/\D/g, "") ?? "";

    useEffect(() => {
        setFilters((prev) =>
            prev.entity_type === urlEntityType ? prev : { ...prev, entity_type: urlEntityType },
        );
        setEntityIdFilter((prev) => (prev === urlEntityId ? prev : urlEntityId));
    }, [urlEntityType, urlEntityId]);

    useEffect(() => {
        if (!urlEntityType || !urlEntityId) {
            return;
        }
        const controller = new AbortController();
        void (async () => {
            try {
                const res = await listSearchDocuments(
                    {
                        entity_type: urlEntityType,
                        entity_id: urlEntityId,
                        page: 1,
                        pageSize: 1,
                    },
                    { signal: controller.signal },
                );
                const doc = res.items[0];
                if (doc) {
                    setPresetEntity({
                        entity_type: doc.entity_type,
                        entity_id: doc.entity_id,
                        display_name: doc.display_name ?? "Untitled",
                        public_id: doc.public_id,
                    });
                }
            } catch {
                // Optional preset only.
            }
        })();
        return () => controller.abort();
    }, [urlEntityType, urlEntityId]);

    const patch = useCallback((next: Partial<Filters>) => {
        setFilters((prev) => ({ ...prev, ...next }));
        setPage(1);
    }, []);

    const resetFilters = useCallback(() => {
        setFilters(EMPTY_FILTERS);
        setEntityIdFilter("");
        setSearchInput("");
        setPage(1);
        if (searchParams.get("entity_type") || searchParams.get("entity_id")) {
            router.replace(searchPath("aliases"));
        }
    }, [router, searchParams]);

    const openCreate = useCallback(() => {
        setEditingItem(null);
        setFormError("");
        setDialogMode("create");
    }, []);

    const openEdit = useCallback((item: SearchAliasItem) => {
        setEditingItem(item);
        setFormError("");
        setDialogMode("edit");
    }, []);

    const closeDialog = useCallback(() => {
        if (saving) return;
        setDialogMode(null);
        setEditingItem(null);
        setFormError("");
    }, [saving]);

    const handleSubmit = useCallback(
        async (values: SearchAliasFormValues) => {
            setSaving(true);
            setFormError("");
            try {
                const language =
                    values.language_code.trim() === "" ? null : values.language_code.trim();
                const source = values.source.trim() === "" ? null : values.source.trim();

                if (dialogMode === "create") {
                    if (!values.entity) {
                        setFormError("Select an indexed searchable entity.");
                        return;
                    }
                    const created = await createSearchAlias({
                        entity_type: values.entity.entity_type,
                        entity_id: values.entity.entity_id,
                        alias_text: values.alias_text.trim(),
                        alias_type: values.alias_type,
                        language_code: language,
                        source,
                    });
                    setFlash({
                        type: created.index_sync?.ok === false ? "error" : "success",
                        message: formatMutationSuccess(created, "created"),
                    });
                } else if (dialogMode === "edit" && editingItem) {
                    const updated = await updateSearchAlias(editingItem.id, {
                        alias_text: values.alias_text.trim(),
                        alias_type: values.alias_type,
                        language_code: language,
                        source,
                    });
                    setFlash({
                        type: updated.index_sync?.ok === false ? "error" : "success",
                        message: formatMutationSuccess(updated, "updated"),
                    });
                }

                setDialogMode(null);
                setEditingItem(null);
                await load();
            } catch (err) {
                setFormError(err instanceof Error ? err.message : "Failed to save alias.");
            } finally {
                setSaving(false);
            }
        },
        [dialogMode, editingItem, load],
    );

    const handleToggleActive = useCallback(
        async (item: SearchAliasItem) => {
            setRowActionId(item.id);
            setFlash(null);
            try {
                const result = item.is_active
                    ? await disableSearchAlias(item.id)
                    : await updateSearchAlias(item.id, { is_active: true });
                setFlash({
                    type: result.index_sync?.ok === false ? "error" : "success",
                    message: formatMutationSuccess(
                        result,
                        item.is_active ? "disabled" : "reactivated",
                    ),
                });
                await load();
            } catch (err) {
                setFlash({
                    type: "error",
                    message: err instanceof Error ? err.message : "Failed to update alias status.",
                });
            } finally {
                setRowActionId(null);
            }
        },
        [load],
    );

    const handleInspectDocument = useCallback(async (item: SearchAliasItem) => {
        setInspectLoadingId(item.id);
        setFlash(null);
        try {
            const res = await listSearchDocuments({
                entity_type: item.entity_type,
                entity_id: item.entity_id,
                page: 1,
                pageSize: 1,
            });
            const doc = res.items[0];
            if (!doc) {
                setFlash({
                    type: "error",
                    message: "No search document found for this entity.",
                });
                return;
            }
            setInspectDocument(doc);
        } catch (err) {
            setFlash({
                type: "error",
                message:
                    err instanceof Error ? err.message : "Failed to load search document.",
            });
        } finally {
            setInspectLoadingId(null);
        }
    }, []);

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    useClampPageToTotal(page, setPage, total, PAGE_SIZE);
    const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(page * PAGE_SIZE, total);
    const hasFilters = hasSearchAliasListFilters(filters, entityIdFilter);
    const tableState =
        loading && !data
            ? "loading"
            : getSearchAliasesTableState({ loading: false, error, data, hasFilters });
    const reloading = loading && data !== null;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="flex flex-col gap-4 border-b border-gray-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Search aliases</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Manage search-only alternative names. Canonical official names are
                            never edited here.
                        </p>
                    </div>
                    <button type="button" className={PRIMARY_BTN} onClick={openCreate}>
                        Create alias
                    </button>
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
                            placeholder="Search alias or indexed display name…"
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
                            <span className="text-gray-600">Alias type</span>
                            <select
                                value={filters.alias_type}
                                onChange={(e) => patch({ alias_type: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                {SEARCH_ALIAS_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                        {aliasTypeLabel(type)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Language</span>
                            <select
                                value={filters.language_code}
                                onChange={(e) => patch({ language_code: e.target.value })}
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
                            <span className="text-gray-600">Active</span>
                            <select
                                value={filters.is_active}
                                onChange={(e) =>
                                    patch({ is_active: e.target.value as TriState })
                                }
                                className={SELECT_CLASS}
                            >
                                <option value="">All</option>
                                <option value="true">Active</option>
                                <option value="false">Disabled</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Entity id</span>
                            <input
                                value={entityIdFilter}
                                onChange={(e) => {
                                    setEntityIdFilter(e.target.value.replace(/\D/g, ""));
                                    setPage(1);
                                }}
                                placeholder="Numeric entity id"
                                className={INPUT_CLASS}
                                inputMode="numeric"
                            />
                        </label>

                        <label className="flex flex-col gap-1 text-sm">
                            <span className="text-gray-600">Sort</span>
                            <select
                                value={filters.sort}
                                onChange={(e) => patch({ sort: e.target.value })}
                                className={SELECT_CLASS}
                            >
                                {SEARCH_ALIAS_SORT_OPTIONS.map((option) => (
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

                {reloading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600 shadow-sm">
                        Refreshing search aliases…
                    </div>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className="px-4 py-3">Alias</th>
                                <th className="px-4 py-3">Type</th>
                                <th className="px-4 py-3">Entity</th>
                                <th className="px-4 py-3">Indexed name</th>
                                <th className="px-4 py-3">Lang</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Updated</th>
                                <th className="px-4 py-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {tableState === "loading" ? (
                                Array.from({ length: 5 }, (_, index) => (
                                    <tr key={`search-aliases-loading-${index}`}>
                                        <td colSpan={8} className="px-4 py-3">
                                            <div className="h-5 animate-pulse rounded bg-gray-100" />
                                        </td>
                                    </tr>
                                ))
                            ) : tableState === "error" ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-red-700">
                                        Search aliases could not be loaded.
                                    </td>
                                </tr>
                            ) : tableState === "idle" ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                                        Search aliases have not loaded yet.
                                    </td>
                                </tr>
                            ) : tableState === "true-empty" ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-10 text-center">
                                        <p className="text-sm text-gray-600">
                                            {SEARCH_ALIASES_TRUE_EMPTY_LABEL}
                                        </p>
                                        <button
                                            type="button"
                                            className={`${PRIMARY_BTN} mt-4`}
                                            onClick={openCreate}
                                        >
                                            Create alias
                                        </button>
                                    </td>
                                </tr>
                            ) : tableState === "filtered-empty" ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                                        {SEARCH_ALIASES_FILTERED_EMPTY_LABEL}
                                    </td>
                                </tr>
                            ) : (
                                items.map((item) => (
                                    <tr key={item.id} className="align-top hover:bg-gray-50">
                                        <td className={`px-4 py-3 ${CELL_TEXT_CLASS}`}>
                                            <div className="font-medium text-gray-900">
                                                {item.alias_text}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                {item.normalized_alias}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-gray-700">
                                            {aliasTypeLabel(item.alias_type)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="text-gray-900">
                                                {entityTypeLabel(item.entity_type)}
                                            </div>
                                            <div className="text-xs text-gray-500">
                                                id {item.entity_id}
                                            </div>
                                        </td>
                                        <td className={`px-4 py-3 ${CELL_TEXT_CLASS} text-gray-700`}>
                                            {item.indexed_entity?.display_name ?? (
                                                <span className="text-amber-700">Not indexed</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-gray-700">
                                            {item.language_code ?? "—"}
                                        </td>
                                        <td className="px-4 py-3">
                                            <ActiveBadge active={item.is_active} />
                                        </td>
                                        <td className="px-4 py-3 text-gray-600">
                                            {formatDateTime(item.updated_at)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex flex-col gap-1.5">
                                                <button
                                                    type="button"
                                                    className={SECONDARY_BTN}
                                                    onClick={() => openEdit(item)}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    className={SECONDARY_BTN}
                                                    disabled={rowActionId === item.id}
                                                    onClick={() => void handleToggleActive(item)}
                                                >
                                                    {rowActionId === item.id
                                                        ? "Saving…"
                                                        : item.is_active
                                                          ? "Disable"
                                                          : "Reactivate"}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={SECONDARY_BTN}
                                                    disabled={inspectLoadingId === item.id}
                                                    onClick={() => void handleInspectDocument(item)}
                                                >
                                                    {inspectLoadingId === item.id
                                                        ? "Loading…"
                                                        : "Inspect document"}
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

            {dialogMode ? (
                <SearchAliasFormDialog
                    mode={dialogMode}
                    initialItem={editingItem}
                    presetEntity={presetEntity}
                    saving={saving}
                    error={formError}
                    onClose={closeDialog}
                    onSubmit={handleSubmit}
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

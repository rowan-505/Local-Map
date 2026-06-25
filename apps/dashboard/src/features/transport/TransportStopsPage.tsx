"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { transportPath } from "@/src/lib/dashboardNavigation";
import { getTransportStops } from "./api";
import { transportListRootKey, useTransportListQuery } from "./transportListQuery";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    TRANSPORT_STOP_TYPE_OPTIONS,
    transportModeLabel,
    transportReviewStatusLabel,
} from "./constants";
import TransportDetailDrawer from "./TransportDetailDrawer";
import TransportStopDetailContent from "./TransportStopDetailContent";
import type { TransportStopListItem } from "./types";

const PAGE_SIZE = 50;

type TriState = "" | "true" | "false";

type Filters = {
    search: string;
    mode: string;
    stopType: string;
    reviewStatus: string;
    generatedName: TriState;
    hasRoutes: TriState;
    hasTerminal: TriState;
    adminAreaId: string;
    isActive: TriState;
    page: number;
};

function readFilters(sp: URLSearchParams): Filters {
    const tri = (key: string): TriState => {
        const v = sp.get(key);
        return v === "true" || v === "false" ? v : "";
    };
    const pageRaw = Number(sp.get("page") ?? "1");
    return {
        search: sp.get("search") ?? "",
        mode: sp.get("mode") ?? "",
        stopType: sp.get("stopType") ?? "",
        reviewStatus: sp.get("reviewStatus") ?? "",
        generatedName: tri("generatedName"),
        hasRoutes: tri("hasRoutes"),
        hasTerminal: tri("hasTerminal"),
        adminAreaId: sp.get("adminAreaId") ?? "",
        isActive: tri("isActive"),
        page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    };
}

function filtersToSearchParams(filters: Filters): string {
    const sp = new URLSearchParams();
    if (filters.search) sp.set("search", filters.search);
    if (filters.mode) sp.set("mode", filters.mode);
    if (filters.stopType) sp.set("stopType", filters.stopType);
    if (filters.reviewStatus) sp.set("reviewStatus", filters.reviewStatus);
    if (filters.generatedName) sp.set("generatedName", filters.generatedName);
    if (filters.hasRoutes) sp.set("hasRoutes", filters.hasRoutes);
    if (filters.hasTerminal) sp.set("hasTerminal", filters.hasTerminal);
    if (filters.adminAreaId.trim()) sp.set("adminAreaId", filters.adminAreaId.trim());
    if (filters.isActive) sp.set("isActive", filters.isActive);
    if (filters.page > 1) sp.set("page", String(filters.page));
    return sp.toString();
}

const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

function TriSelect({
    label,
    value,
    onChange,
    yesLabel = "Yes",
    noLabel = "No",
}: {
    readonly label: string;
    readonly value: TriState;
    readonly onChange: (value: TriState) => void;
    readonly yesLabel?: string;
    readonly noLabel?: string;
}) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
            <select
                className={SELECT_CLASS}
                value={value}
                onChange={(e) => onChange(e.target.value as TriState)}
            >
                <option value="">Any</option>
                <option value="true">{yesLabel}</option>
                <option value="false">{noLabel}</option>
            </select>
        </label>
    );
}

export default function TransportStopsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Drawer state lives in the `stop` query param. It is kept out of the
    // filter key so opening/closing the drawer never re-runs the list query.
    const filtersKey = useMemo(() => {
        const sp = new URLSearchParams(searchParams.toString());
        sp.delete("stop");
        return sp.toString();
    }, [searchParams]);
    const filters = useMemo(() => readFilters(new URLSearchParams(filtersKey)), [filtersKey]);
    const stopPublicId = searchParams.get("stop");

    const queryClient = useQueryClient();
    const [searchInput, setSearchInput] = useState(filters.search);
    const [adminAreaInput, setAdminAreaInput] = useState(filters.adminAreaId);

    // Map URL filters -> API params. This object is BOTH the request payload and
    // the cache key, so equivalent filters/pages reuse the same cached response.
    const apiQuery = useMemo(() => {
        const adminAreaId = Number(filters.adminAreaId);
        return {
            search: filters.search || undefined,
            mode: filters.mode || undefined,
            stopType: filters.stopType || undefined,
            reviewStatus: filters.reviewStatus || undefined,
            generatedName:
                filters.generatedName === "" ? undefined : filters.generatedName === "true",
            hasRoutes: filters.hasRoutes === "" ? undefined : filters.hasRoutes === "true",
            hasTerminal: filters.hasTerminal === "" ? undefined : filters.hasTerminal === "true",
            adminAreaId:
                filters.adminAreaId.trim() && Number.isFinite(adminAreaId) && adminAreaId >= 1
                    ? Math.floor(adminAreaId)
                    : undefined,
            isActive: filters.isActive === "" ? undefined : filters.isActive === "true",
            limit: PAGE_SIZE,
            page: filters.page,
        };
    }, [filters]);

    const { data, isPending, isFetching, isError, error: queryError } =
        useTransportListQuery<TransportStopListItem>({
            resource: "stops",
            params: apiQuery,
            queryFn: (signal) => getTransportStops(apiQuery, { signal }),
        });

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    // Skeleton only on the very first load; keepPreviousData keeps rows during refetch.
    const loading = isPending;
    const error = isError
        ? queryError instanceof Error
            ? queryError.message
            : "Failed to load stops."
        : "";

    useEffect(() => {
        setSearchInput(filters.search);
    }, [filters.search]);

    useEffect(() => {
        setAdminAreaInput(filters.adminAreaId);
    }, [filters.adminAreaId]);

    const applyFilters = useCallback(
        (patch: Partial<Filters>, resetPage = true) => {
            const next: Filters = {
                ...filters,
                ...patch,
                page: resetPage ? 1 : (patch.page ?? filters.page),
            };
            const qs = filtersToSearchParams(next);
            router.replace(qs ? `${transportPath("stops")}?${qs}` : transportPath("stops"));
        },
        [filters, router]
    );

    // True when any search/filter narrows the list (page alone does not count).
    const hasActiveFilters = useMemo(
        () =>
            Boolean(
                filters.search ||
                    filters.mode ||
                    filters.stopType ||
                    filters.reviewStatus ||
                    filters.generatedName ||
                    filters.hasRoutes ||
                    filters.hasTerminal ||
                    filters.adminAreaId.trim() ||
                    filters.isActive
            ),
        [filters]
    );

    const clearFilters = useCallback(() => {
        setSearchInput("");
        setAdminAreaInput("");
        router.replace(transportPath("stops"));
    }, [router]);

    // QA helper: one-click preset that surfaces likely accidental test stops
    // (search "test", no routes, active) so each can be archived individually
    // from Stop Detail. This is intentionally just a filter shortcut — there is
    // no bulk delete/archive (see cleanup notes).
    const applyTestStopPreset = useCallback(() => {
        setSearchInput("test");
        setAdminAreaInput("");
        applyFilters({
            search: "test",
            hasRoutes: "false",
            isActive: "true",
            mode: "",
            stopType: "",
            reviewStatus: "",
            generatedName: "",
            hasTerminal: "",
            adminAreaId: "",
        });
    }, [applyFilters]);

    // After a save in the drawer, refetch the current stops query in the
    // background. keepPreviousData keeps rows visible and the URL is unchanged,
    // so filters/page/scroll are preserved.
    const reloadCurrentPage = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: transportListRootKey("stops") });
    }, [queryClient]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rangeStart = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(filters.page * PAGE_SIZE, total);

    // Open the drawer by pushing `?stop=<publicId>` (filters preserved). Using
    // push (not navigation to the detail route) keeps the list mounted and lets
    // the browser Back button close the drawer.
    const openStop = useCallback(
        (publicId: string) => {
            const sp = new URLSearchParams(searchParams.toString());
            sp.set("stop", publicId);
            // scroll: false keeps the list scroll position when the drawer opens.
            router.push(`${transportPath("stops")}?${sp.toString()}`, { scroll: false });
        },
        [router, searchParams]
    );

    // Close the drawer by removing only the `stop` param (filters preserved).
    const closeStop = useCallback(() => {
        const sp = new URLSearchParams(searchParams.toString());
        sp.delete("stop");
        const qs = sp.toString();
        router.replace(qs ? `${transportPath("stops")}?${qs}` : transportPath("stops"), {
            scroll: false,
        });
    }, [router, searchParams]);

    const selectedRow = useMemo(
        () => items.find((r) => r.public_id === stopPublicId) ?? null,
        [items, stopPublicId]
    );

    const drawerTitle = selectedRow?.display_name || "Stop detail";

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Stops</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Transport stops with mode, stop type, route coverage, and review status.
                    </p>
                </header>

                <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <form
                        className="flex flex-col gap-2 sm:flex-row"
                        onSubmit={(e) => {
                            e.preventDefault();
                            applyFilters({ search: searchInput.trim() });
                        }}
                    >
                        <input
                            type="search"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search name, Myanmar/English name, stop code…"
                            autoComplete="off"
                            className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                        />
                        <div className="flex gap-2">
                            <button
                                type="submit"
                                className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                            >
                                Search
                            </button>
                            <button
                                type="button"
                                onClick={applyTestStopPreset}
                                title={'Filter to active, unused stops named "test" so each can be archived individually from Stop Detail.'}
                                className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
                            >
                                Find test stops
                            </button>
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Reset
                            </button>
                        </div>
                    </form>

                    <div className="flex flex-wrap gap-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Mode
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.mode}
                                onChange={(e) => applyFilters({ mode: e.target.value })}
                            >
                                <option value="">All</option>
                                {TRANSPORT_MODE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Stop type
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.stopType}
                                onChange={(e) => applyFilters({ stopType: e.target.value })}
                            >
                                <option value="">All</option>
                                {TRANSPORT_STOP_TYPE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Review status
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.reviewStatus}
                                onChange={(e) => applyFilters({ reviewStatus: e.target.value })}
                            >
                                <option value="">All</option>
                                {TRANSPORT_REVIEW_STATUS_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <TriSelect
                            label="Has routes"
                            value={filters.hasRoutes}
                            onChange={(v) => applyFilters({ hasRoutes: v })}
                        />
                        <TriSelect
                            label="Has terminal"
                            value={filters.hasTerminal}
                            onChange={(v) => applyFilters({ hasTerminal: v })}
                        />
                        <TriSelect
                            label="Generated name"
                            value={filters.generatedName}
                            onChange={(v) => applyFilters({ generatedName: v })}
                            yesLabel="Generated"
                            noLabel="Human"
                        />
                        <TriSelect
                            label="Active"
                            value={filters.isActive}
                            onChange={(v) => applyFilters({ isActive: v })}
                        />

                        <form
                            className="flex flex-col gap-1"
                            onSubmit={(e) => {
                                e.preventDefault();
                                applyFilters({ adminAreaId: adminAreaInput.trim() });
                            }}
                        >
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Admin area ID
                            </span>
                            <input
                                type="number"
                                min={1}
                                value={adminAreaInput}
                                onChange={(e) => setAdminAreaInput(e.target.value)}
                                onBlur={() => applyFilters({ adminAreaId: adminAreaInput.trim() })}
                                placeholder="Any"
                                className={`w-32 ${SELECT_CLASS}`}
                            />
                        </form>
                    </div>
                </div>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                    <table className="min-w-full text-left text-sm">
                        <thead className="border-b text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-3 py-2">Name</th>
                                <th className="px-3 py-2">Mode</th>
                                <th className="px-3 py-2">Stop type</th>
                                <th className="px-3 py-2">Terminal</th>
                                <th className="px-3 py-2 text-right">Routes</th>
                                <th className="px-3 py-2">Admin area</th>
                                <th className="px-3 py-2">Review</th>
                                <th className="px-3 py-2 text-right">Confidence</th>
                                <th className="px-3 py-2">Active</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                                        Loading stops…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-3 py-12">
                                        <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-center">
                                            <p className="text-sm font-medium text-gray-900">
                                                {hasActiveFilters
                                                    ? "No stops match these filters"
                                                    : "No stops yet"}
                                            </p>
                                            <p className="text-sm text-gray-500">
                                                {hasActiveFilters
                                                    ? "Try adjusting or clearing the search and filters above."
                                                    : "Stops will appear here once transport data has been imported."}
                                            </p>
                                            {hasActiveFilters ? (
                                                <button
                                                    type="button"
                                                    onClick={clearFilters}
                                                    className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                                                >
                                                    Clear filters
                                                </button>
                                            ) : null}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                items.map((row) => {
                                    const secondary =
                                        row.name_en && row.name_en !== row.display_name
                                            ? row.name_en
                                            : row.name_mm && row.name_mm !== row.display_name
                                              ? row.name_mm
                                              : row.stop_code
                                                ? `#${row.stop_code}`
                                                : null;
                                    return (
                                        <tr
                                            key={row.public_id}
                                            onClick={() => openStop(row.public_id)}
                                            className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                                        >
                                            <td className="px-3 py-2">
                                                <div className="font-medium text-gray-900">
                                                    {row.display_name}
                                                </div>
                                                {secondary ? (
                                                    <div className="text-xs text-gray-500">{secondary}</div>
                                                ) : null}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {transportModeLabel(row.mode)}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">{row.stop_type}</td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {row.has_terminal ? (
                                                    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-800 ring-1 ring-indigo-100">
                                                        {row.terminal_role ?? "terminal"}
                                                        {row.terminal_code ? ` · ${row.terminal_code}` : ""}
                                                    </span>
                                                ) : (
                                                    <span className="text-xs text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                                {row.route_count}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {row.admin_area_name ?? "—"}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {transportReviewStatusLabel(row.review_status)}
                                            </td>
                                            <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                                {row.confidence_score === null
                                                    ? "—"
                                                    : Math.round(row.confidence_score)}
                                            </td>
                                            <td className="px-3 py-2">
                                                {row.is_active ? (
                                                    <span className="text-emerald-700">Active</span>
                                                ) : (
                                                    <span className="text-gray-400">Inactive</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
                    <span aria-live="polite">
                        {total === 0
                            ? "0 results"
                            : `${rangeStart}–${rangeEnd} of ${total.toLocaleString()}`}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={isFetching || filters.page <= 1}
                            onClick={() => applyFilters({ page: filters.page - 1 }, false)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Previous
                        </button>
                        <span className="tabular-nums">
                            Page {filters.page} of {totalPages}
                        </span>
                        <button
                            type="button"
                            disabled={isFetching || filters.page >= totalPages}
                            onClick={() => applyFilters({ page: filters.page + 1 }, false)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>

            <TransportDetailDrawer
                open={Boolean(stopPublicId)}
                title={drawerTitle}
                meta={
                    selectedRow ? (
                        <>
                            <span>
                                {transportModeLabel(selectedRow.mode)} · {selectedRow.stop_type}
                                {selectedRow.stop_code ? ` · #${selectedRow.stop_code}` : ""}
                            </span>
                            <span>{transportReviewStatusLabel(selectedRow.review_status)}</span>
                            {selectedRow.is_active ? (
                                <span className="text-emerald-700">Active</span>
                            ) : (
                                <span className="text-gray-400">Inactive</span>
                            )}
                        </>
                    ) : undefined
                }
                onClose={closeStop}
            >
                {stopPublicId ? (
                    <div className="p-5">
                        <div className="space-y-4">
                            <TransportStopDetailContent
                                key={stopPublicId}
                                publicId={stopPublicId}
                                hideHeader
                                afterSave={reloadCurrentPage}
                            />
                        </div>
                    </div>
                ) : null}
            </TransportDetailDrawer>
        </main>
    );
}

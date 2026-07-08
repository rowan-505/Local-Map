"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { transportPath } from "@/src/lib/dashboardNavigation";
import { getTransportRoutes } from "./api";
import { useTransportListQuery } from "./transportListQuery";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_PUBLIC_VISIBILITY_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    TRANSPORT_ROUTE_GEOMETRY_STATUS_OPTIONS,
    transportModeLabel,
    transportReviewStatusLabel,
} from "./constants";
import TransportDetailDrawer from "./TransportDetailDrawer";
import TransportRouteDetailContent from "./TransportRouteDetailContent";
import TransportStopDetailContent from "./TransportStopDetailContent";
import NewTransportRouteDialog from "./NewTransportRouteDialog";
import {
    formatRouteListPublicName,
    TransportRouteListVisibility,
    TransportRouteListWorkStatus,
} from "./transportReviewUi";
import type { TransportRouteListItem } from "./types";

const PAGE_SIZE = 50;

type TriState = "" | "true" | "false";

type Filters = {
    search: string;
    mode: string;
    reviewStatus: string;
    hasStops: TriState;
    hasPath: TriState;
    hasSourceLink: TriState;
    geometryStatus: string;
    publicVisibility: string;
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
        reviewStatus: sp.get("reviewStatus") ?? "",
        hasStops: tri("hasStops"),
        hasPath: tri("hasPath"),
        hasSourceLink: tri("hasSourceLink"),
        geometryStatus: sp.get("geometryStatus") ?? "",
        publicVisibility: sp.get("publicVisibility") ?? "",
        isActive: tri("isActive"),
        page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    };
}

function filtersToSearchParams(filters: Filters): string {
    const sp = new URLSearchParams();
    if (filters.search) sp.set("search", filters.search);
    if (filters.mode) sp.set("mode", filters.mode);
    if (filters.reviewStatus) sp.set("reviewStatus", filters.reviewStatus);
    if (filters.hasStops) sp.set("hasStops", filters.hasStops);
    if (filters.hasPath) sp.set("hasPath", filters.hasPath);
    if (filters.hasSourceLink) sp.set("hasSourceLink", filters.hasSourceLink);
    if (filters.geometryStatus) sp.set("geometryStatus", filters.geometryStatus);
    if (filters.publicVisibility) sp.set("publicVisibility", filters.publicVisibility);
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

export default function TransportRoutesPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Drawer state lives in the `route` query param. It is kept out of the
    // filter key so opening/closing the drawer never re-runs the list query.
    const filtersKey = useMemo(() => {
        const sp = new URLSearchParams(searchParams.toString());
        sp.delete("route");
        sp.delete("stop");
        return sp.toString();
    }, [searchParams]);
    const filters = useMemo(() => readFilters(new URLSearchParams(filtersKey)), [filtersKey]);
    const routePublicId = searchParams.get("route");
    const stopPublicId = searchParams.get("stop");

    const queryClient = useQueryClient();
    const [searchInput, setSearchInput] = useState(filters.search);
    const [createOpen, setCreateOpen] = useState(false);
    const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(
        () =>
            Boolean(filters.mode) ||
            filters.hasStops !== "" ||
            filters.hasPath !== "" ||
            filters.hasSourceLink !== ""
    );

    // Map URL filters -> API params. This object is BOTH the request payload and
    // the cache key, so equivalent filters/pages reuse the same cached response.
    const apiQuery = useMemo(
        () => ({
            search: filters.search || undefined,
            mode: filters.mode || undefined,
            reviewStatus: filters.reviewStatus || undefined,
            hasStops: filters.hasStops === "" ? undefined : filters.hasStops === "true",
            hasPath: filters.hasPath === "" ? undefined : filters.hasPath === "true",
            hasSourceLink:
                filters.hasSourceLink === "" ? undefined : filters.hasSourceLink === "true",
            geometryStatus: filters.geometryStatus || undefined,
            publicVisibility: filters.publicVisibility || undefined,
            isActive: filters.isActive === "" ? undefined : filters.isActive === "true",
            limit: PAGE_SIZE,
            page: filters.page,
        }),
        [filters]
    );

    const { data, isPending, isFetching, isError, isPlaceholderData, error: queryError, refetch } =
        useTransportListQuery<TransportRouteListItem>({
            resource: "routes",
            params: apiQuery,
            queryFn: (signal) => getTransportRoutes(apiQuery, { signal }),
        });

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const loading = isPending || (isFetching && (isPlaceholderData || !data));
    const error = isError
        ? queryError instanceof Error
            ? queryError.message
            : "Failed to load routes."
        : "";

    useEffect(() => {
        setSearchInput(filters.search);
    }, [filters.search]);

    const applyFilters = useCallback(
        (patch: Partial<Filters>, resetPage = true) => {
            const next: Filters = {
                ...filters,
                ...patch,
                page: resetPage ? 1 : (patch.page ?? filters.page),
            };
            const qs = filtersToSearchParams(next);
            router.replace(qs ? `${transportPath("routes")}?${qs}` : transportPath("routes"));
        },
        [filters, router]
    );

    // After a save that affects list columns, refetch only the current page query.
    // Stop moves and path edits patch drawer state locally and do not call this.
    const reloadCurrentPage = useCallback(() => {
        void queryClient.invalidateQueries({ queryKey: ["transport", "routes", apiQuery] });
    }, [queryClient, apiQuery]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rangeStart = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(filters.page * PAGE_SIZE, total);

    const showModeSubtitle = useMemo(() => {
        if (items.length === 0) {
            return false;
        }
        return items.every((row) => row.mode === "bus" && row.route_kind === "urban");
    }, [items]);

    const tableColSpan = advancedFiltersOpen ? 8 : 7;

    // Open the drawer by pushing `?route=<publicId>` (filters preserved). Using
    // push (not navigation to the detail route) keeps the list mounted and lets
    // the browser Back button close the drawer.
    const openRoute = useCallback(
        (publicId: string) => {
            const sp = new URLSearchParams(searchParams.toString());
            sp.set("route", publicId);
            // scroll: false keeps the list scroll position when the drawer opens.
            router.push(`${transportPath("routes")}?${sp.toString()}`, { scroll: false });
        },
        [router, searchParams]
    );

    // Close the drawer by removing only the `route` param (filters preserved).
    const closeRoute = useCallback(() => {
        const sp = new URLSearchParams(searchParams.toString());
        sp.delete("route");
        sp.delete("stop");
        const qs = sp.toString();
        router.replace(qs ? `${transportPath("routes")}?${qs}` : transportPath("routes"), {
            scroll: false,
        });
    }, [router, searchParams]);

    const openStopOverlay = useCallback(
        (publicId: string) => {
            const sp = new URLSearchParams(searchParams.toString());
            sp.set("stop", publicId);
            router.push(`${transportPath("routes")}?${sp.toString()}`, { scroll: false });
        },
        [router, searchParams],
    );

    const closeStopOverlay = useCallback(() => {
        const sp = new URLSearchParams(searchParams.toString());
        sp.delete("stop");
        const qs = sp.toString();
        router.replace(qs ? `${transportPath("routes")}?${qs}` : transportPath("routes"), {
            scroll: false,
        });
    }, [router, searchParams]);

    // After creating a route: close the dialog, refresh the list (the new route
    // appears when it matches the current filters), and open its detail drawer.
    const handleCreated = useCallback(
        (publicId: string) => {
            setCreateOpen(false);
            reloadCurrentPage();
            openRoute(publicId);
        },
        [reloadCurrentPage, openRoute]
    );

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Routes</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Transport routes with variant, stop, and path coverage.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setCreateOpen(true)}
                        className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    >
                        + New route
                    </button>
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
                            placeholder="Search code, name, origin, destination…"
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
                                onClick={() => {
                                    setSearchInput("");
                                    router.replace(transportPath("routes"));
                                }}
                                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                                Reset
                            </button>
                        </div>
                    </form>

                    <div className="flex flex-wrap items-end gap-3">
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

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Public visibility
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.publicVisibility}
                                onChange={(e) => applyFilters({ publicVisibility: e.target.value })}
                            >
                                <option value="">All</option>
                                {TRANSPORT_PUBLIC_VISIBILITY_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Geometry status
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.geometryStatus}
                                onChange={(e) => applyFilters({ geometryStatus: e.target.value })}
                            >
                                <option value="">All</option>
                                {TRANSPORT_ROUTE_GEOMETRY_STATUS_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <TriSelect
                            label="Active"
                            value={filters.isActive}
                            onChange={(v) => applyFilters({ isActive: v })}
                        />

                        <button
                            type="button"
                            onClick={() => setAdvancedFiltersOpen((open) => !open)}
                            className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            aria-expanded={advancedFiltersOpen}
                        >
                            {advancedFiltersOpen ? "Hide advanced" : "Advanced filters"}
                        </button>
                    </div>

                    {advancedFiltersOpen ? (
                        <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-3">
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

                            <TriSelect
                                label="Has stops"
                                value={filters.hasStops}
                                onChange={(v) => applyFilters({ hasStops: v })}
                            />
                            <TriSelect
                                label="Has path"
                                value={filters.hasPath}
                                onChange={(v) => applyFilters({ hasPath: v })}
                            />
                            <TriSelect
                                label="Has source link"
                                value={filters.hasSourceLink}
                                onChange={(v) => applyFilters({ hasSourceLink: v })}
                            />
                        </div>
                    ) : null}
                </div>

                {error ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        <span>{error}</span>
                        <button
                            type="button"
                            onClick={() => {
                                void refetch();
                            }}
                            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-900 hover:bg-red-50"
                        >
                            Retry
                        </button>
                    </div>
                ) : null}

                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                    <table className="w-full table-fixed text-left text-sm">
                        <colgroup>
                            <col className="w-[6.5rem]" />
                            <col />
                            <col className="w-[4.5rem]" />
                            <col className="w-[4rem]" />
                            <col className="w-[8.5rem]" />
                            <col className="w-[7.5rem]" />
                            <col className="w-[6.5rem]" />
                            {advancedFiltersOpen ? <col className="w-[5.5rem]" /> : null}
                        </colgroup>
                        <thead className="border-b text-xs uppercase text-gray-500">
                            <tr>
                                <th className="px-3 py-2">Route code</th>
                                <th className="px-3 py-2">Public name</th>
                                <th className="px-3 py-2 text-right">Variants</th>
                                <th className="px-3 py-2 text-right">Stops</th>
                                <th className="px-3 py-2">Work status</th>
                                <th className="px-3 py-2">Review status</th>
                                <th className="px-3 py-2">Visibility</th>
                                {advancedFiltersOpen ? (
                                    <th className="px-3 py-2 text-right">Confidence</th>
                                ) : null}
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td
                                        colSpan={tableColSpan}
                                        className="px-3 py-8 text-center text-gray-500"
                                    >
                                        Loading routes…
                                    </td>
                                </tr>
                            ) : !error && items.length === 0 ? (
                                <tr>
                                    <td
                                        colSpan={tableColSpan}
                                        className="px-3 py-8 text-center text-gray-500"
                                    >
                                        No routes match the current filters.
                                    </td>
                                </tr>
                            ) : (
                                items.map((row) => {
                                    const publicName = formatRouteListPublicName(row);
                                    return (
                                        <tr
                                            key={row.public_id}
                                            onClick={() => openRoute(row.public_id)}
                                            className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                                        >
                                            <td className="px-3 py-1.5">
                                                <div className="font-medium text-gray-900">
                                                    {row.route_code}
                                                </div>
                                                {showModeSubtitle ? null : row.mode !== "bus" ||
                                                  row.route_kind !== "urban" ? (
                                                    <div className="text-[11px] text-gray-500">
                                                        {transportModeLabel(row.mode)} ·{" "}
                                                        {row.route_kind}
                                                    </div>
                                                ) : null}
                                            </td>
                                            <td className="min-w-0 px-3 py-1.5">
                                                <div
                                                    className="line-clamp-2 font-medium leading-snug text-gray-900"
                                                    title={publicName.primary}
                                                >
                                                    {publicName.primary}
                                                </div>
                                                {publicName.secondary ? (
                                                    <div
                                                        className="mt-0.5 line-clamp-2 text-xs leading-snug text-gray-500"
                                                        title={publicName.secondary}
                                                    >
                                                        {publicName.secondary}
                                                    </div>
                                                ) : null}
                                            </td>
                                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                                                {row.variant_count}
                                            </td>
                                            <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                                                {row.stop_count}
                                            </td>
                                            <td className="px-3 py-1.5">
                                                <TransportRouteListWorkStatus
                                                    reviewStatus={row.review_status}
                                                    variantCount={row.variant_count}
                                                    stopCount={row.stop_count}
                                                    pathCount={row.path_count}
                                                    geometryStatus={row.geometry_status}
                                                />
                                            </td>
                                            <td className="px-3 py-1.5 text-gray-700">
                                                {transportReviewStatusLabel(row.review_status)}
                                            </td>
                                            <td className="px-3 py-1.5">
                                                <TransportRouteListVisibility
                                                    isActive={row.is_active}
                                                    publicVisibility={row.public_visibility}
                                                />
                                            </td>
                                            {advancedFiltersOpen ? (
                                                <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                                                    {row.confidence_score === null
                                                        ? "—"
                                                        : Math.round(row.confidence_score)}
                                                </td>
                                            ) : null}
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
                    <span aria-live="polite">
                        {loading
                            ? "Loading…"
                            : error
                              ? "—"
                              : total === 0
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
                open={Boolean(routePublicId)}
                title="Route detail"
                hideHeaderChrome
                onClose={closeRoute}
            >
                {routePublicId ? (
                    <div className="p-4">
                        <TransportRouteDetailContent
                            publicId={routePublicId}
                            onClose={closeRoute}
                            afterSave={reloadCurrentPage}
                            onOpenStopDetail={openStopOverlay}
                        />
                    </div>
                ) : null}
            </TransportDetailDrawer>

            <TransportDetailDrawer
                open={Boolean(stopPublicId)}
                title="Stop detail"
                hideHeaderChrome
                overlayClassName="z-[60]"
                onClose={closeStopOverlay}
            >
                {stopPublicId ? (
                    <div className="p-4">
                        <TransportStopDetailContent
                            key={stopPublicId}
                            publicId={stopPublicId}
                            onClose={closeStopOverlay}
                        />
                    </div>
                ) : null}
            </TransportDetailDrawer>

            {createOpen ? (
                <NewTransportRouteDialog
                    onClose={() => setCreateOpen(false)}
                    onCreated={handleCreated}
                />
            ) : null}
        </main>
    );
}

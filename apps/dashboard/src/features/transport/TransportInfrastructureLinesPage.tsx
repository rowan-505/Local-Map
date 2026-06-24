"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { transportPath } from "@/src/lib/dashboardNavigation";
import { getTransportInfrastructureLines } from "./api";
import { transportListRootKey, useTransportListQuery } from "./transportListQuery";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    transportInfrastructureLineDisplayName,
    transportModeLabel,
    transportReviewStatusLabel,
} from "./constants";
import TransportDetailDrawer from "./TransportDetailDrawer";
import TransportInfrastructureDetailContent from "./TransportInfrastructureDetailContent";
import type { TransportInfrastructureLineListItem, TransportRawNameStatus } from "./types";

const PAGE_SIZE = 50;

type TriState = "" | "true" | "false";

type Filters = {
    search: string;
    mode: string;
    lineType: string;
    reviewStatus: string;
    generatedName: TriState;
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
        lineType: sp.get("lineType") ?? "",
        reviewStatus: sp.get("reviewStatus") ?? "",
        generatedName: tri("generatedName"),
        adminAreaId: sp.get("adminAreaId") ?? "",
        isActive: tri("isActive"),
        page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    };
}

function filtersToSearchParams(filters: Filters): string {
    const sp = new URLSearchParams();
    if (filters.search) sp.set("search", filters.search);
    if (filters.mode) sp.set("mode", filters.mode);
    if (filters.lineType.trim()) sp.set("lineType", filters.lineType.trim());
    if (filters.reviewStatus) sp.set("reviewStatus", filters.reviewStatus);
    if (filters.generatedName) sp.set("generatedName", filters.generatedName);
    if (filters.adminAreaId.trim()) sp.set("adminAreaId", filters.adminAreaId.trim());
    if (filters.isActive) sp.set("isActive", filters.isActive);
    if (filters.page > 1) sp.set("page", String(filters.page));
    return sp.toString();
}

const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

function rawNameBadgeClass(status: TransportRawNameStatus): string {
    switch (status) {
        case "real":
            return "bg-emerald-50 text-emerald-800 ring-emerald-100";
        case "generated":
            return "bg-amber-50 text-amber-900 ring-amber-100";
        default:
            return "bg-red-50 text-red-800 ring-red-100";
    }
}

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
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {label}
            </span>
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

export default function TransportInfrastructureLinesPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // Drawer state lives in the `line` query param. It is kept out of the
    // filter key so opening/closing the drawer never re-runs the list query.
    const filtersKey = useMemo(() => {
        const sp = new URLSearchParams(searchParams.toString());
        sp.delete("line");
        return sp.toString();
    }, [searchParams]);
    const filters = useMemo(() => readFilters(new URLSearchParams(filtersKey)), [filtersKey]);
    const linePublicId = searchParams.get("line");

    const queryClient = useQueryClient();
    const [searchInput, setSearchInput] = useState(filters.search);
    const [lineTypeInput, setLineTypeInput] = useState(filters.lineType);
    const [adminAreaInput, setAdminAreaInput] = useState(filters.adminAreaId);

    // Map URL filters -> API params. This object is BOTH the request payload and
    // the cache key, so equivalent filters/pages reuse the same cached response.
    const apiQuery = useMemo(() => {
        const adminAreaId = Number(filters.adminAreaId);
        return {
            search: filters.search || undefined,
            mode: filters.mode || undefined,
            lineType: filters.lineType || undefined,
            reviewStatus: filters.reviewStatus || undefined,
            generatedName:
                filters.generatedName === "" ? undefined : filters.generatedName === "true",
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
        useTransportListQuery<TransportInfrastructureLineListItem>({
            resource: "infrastructure-lines",
            params: apiQuery,
            queryFn: (signal) => getTransportInfrastructureLines(apiQuery, { signal }),
        });

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    // Skeleton only on the very first load; keepPreviousData keeps rows during refetch.
    const loading = isPending;
    const error = isError
        ? queryError instanceof Error
            ? queryError.message
            : "Failed to load infrastructure lines."
        : "";

    useEffect(() => setSearchInput(filters.search), [filters.search]);
    useEffect(() => setLineTypeInput(filters.lineType), [filters.lineType]);
    useEffect(() => setAdminAreaInput(filters.adminAreaId), [filters.adminAreaId]);

    const applyFilters = useCallback(
        (patch: Partial<Filters>, resetPage = true) => {
            const next: Filters = {
                ...filters,
                ...patch,
                page: resetPage ? 1 : (patch.page ?? filters.page),
            };
            const qs = filtersToSearchParams(next);
            const base = transportPath("infrastructure");
            router.replace(qs ? `${base}?${qs}` : base);
        },
        [filters, router]
    );

    // After a save in the drawer, refetch the current infrastructure-lines query
    // in the background. keepPreviousData keeps rows visible and the URL is
    // unchanged, so filters/page/scroll are preserved.
    const reloadCurrentPage = useCallback(() => {
        void queryClient.invalidateQueries({
            queryKey: transportListRootKey("infrastructure-lines"),
        });
    }, [queryClient]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rangeStart = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(filters.page * PAGE_SIZE, total);

    // Open the drawer by pushing `?line=<publicId>` (filters preserved). Using
    // push (not navigation to the detail route) keeps the list mounted and lets
    // the browser Back button close the drawer.
    const openLine = useCallback(
        (publicId: string) => {
            const sp = new URLSearchParams(searchParams.toString());
            sp.set("line", publicId);
            // scroll: false keeps the list scroll position when the drawer opens.
            router.push(`${transportPath("infrastructure")}?${sp.toString()}`, { scroll: false });
        },
        [router, searchParams]
    );

    // Close the drawer by removing only the `line` param (filters preserved).
    const closeLine = useCallback(() => {
        const sp = new URLSearchParams(searchParams.toString());
        sp.delete("line");
        const qs = sp.toString();
        router.replace(
            qs ? `${transportPath("infrastructure")}?${qs}` : transportPath("infrastructure"),
            { scroll: false }
        );
    }, [router, searchParams]);

    const selectedRow = useMemo(
        () => items.find((r) => r.public_id === linePublicId) ?? null,
        [items, linePublicId]
    );

    const drawerTitle = selectedRow
        ? transportInfrastructureLineDisplayName(selectedRow)
        : "Infrastructure line";

    const resetAll = () => {
        setSearchInput("");
        setLineTypeInput("");
        setAdminAreaInput("");
        router.replace(transportPath("infrastructure"));
    };

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Infrastructure lines</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Rail and ferry infrastructure lines with raw-name status, line type, and
                        review status.
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
                            placeholder="Search name, Myanmar/English name…"
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
                                onClick={resetAll}
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

                        <form
                            className="flex flex-col gap-1"
                            onSubmit={(e) => {
                                e.preventDefault();
                                applyFilters({ lineType: lineTypeInput.trim() });
                            }}
                        >
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Line type
                            </span>
                            <input
                                value={lineTypeInput}
                                onChange={(e) => setLineTypeInput(e.target.value)}
                                onBlur={() => applyFilters({ lineType: lineTypeInput.trim() })}
                                placeholder="Any"
                                className={`w-36 ${SELECT_CLASS}`}
                            />
                        </form>

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
                                className={`w-28 ${SELECT_CLASS}`}
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
                                <th className="px-3 py-2">Line type</th>
                                <th className="px-3 py-2">Admin area</th>
                                <th className="px-3 py-2">Review</th>
                                <th className="px-3 py-2 text-right">Confidence</th>
                                <th className="px-3 py-2">Active</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                                        Loading infrastructure lines…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                                        No infrastructure lines match the current filters.
                                    </td>
                                </tr>
                            ) : (
                                items.map((row) => {
                                    const displayName = transportInfrastructureLineDisplayName(row);
                                    const isCandidate = row.raw_name_status !== "real";
                                    return (
                                        <tr
                                            key={row.public_id}
                                            onClick={() => openLine(row.public_id)}
                                            className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                                        >
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <span
                                                        className={`font-medium ${isCandidate ? "italic text-gray-600" : "text-gray-900"}`}
                                                    >
                                                        {displayName}
                                                    </span>
                                                    {isCandidate ? (
                                                        <span
                                                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${rawNameBadgeClass(row.raw_name_status)}`}
                                                        >
                                                            {row.raw_name_status}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {transportModeLabel(row.mode)}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {row.line_type}
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
                open={Boolean(linePublicId)}
                title={drawerTitle}
                meta={
                    selectedRow ? (
                        <>
                            <span>
                                {transportModeLabel(selectedRow.mode)} · {selectedRow.line_type}
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
                onClose={closeLine}
            >
                {linePublicId ? (
                    <div className="p-5">
                        <div className="space-y-4">
                            <TransportInfrastructureDetailContent
                                key={linePublicId}
                                publicId={linePublicId}
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

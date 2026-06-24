"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import { getTransportRoutes } from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    transportModeLabel,
    transportReviewStatusLabel,
} from "./constants";
import type { TransportRouteListItem } from "./types";

const PAGE_SIZE = 50;

type TriState = "" | "true" | "false";

type Filters = {
    search: string;
    mode: string;
    reviewStatus: string;
    hasStops: TriState;
    hasPath: TriState;
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
    const filters = useMemo(
        () => readFilters(new URLSearchParams(searchParams.toString())),
        [searchParams]
    );

    const [searchInput, setSearchInput] = useState(filters.search);
    const [items, setItems] = useState<readonly TransportRouteListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

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

    const load = useCallback(
        async (signal: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const result = await getTransportRoutes(
                    {
                        search: filters.search || undefined,
                        mode: filters.mode || undefined,
                        reviewStatus: filters.reviewStatus || undefined,
                        hasStops: filters.hasStops === "" ? undefined : filters.hasStops === "true",
                        hasPath: filters.hasPath === "" ? undefined : filters.hasPath === "true",
                        isActive: filters.isActive === "" ? undefined : filters.isActive === "true",
                        limit: PAGE_SIZE,
                        page: filters.page,
                    },
                    { signal }
                );
                setItems(result.items);
                setTotal(result.total);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load routes.");
            } finally {
                setLoading(false);
            }
        },
        [filters]
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rangeStart = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(filters.page * PAGE_SIZE, total);

    const openRoute = (publicId: string) => {
        router.push(transportPath(`routes/${publicId}`));
    };

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Routes</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Transport routes with variant, stop, and path coverage.
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
                            label="Active"
                            value={filters.isActive}
                            onChange={(v) => applyFilters({ isActive: v })}
                        />
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
                                <th className="px-3 py-2">Route code</th>
                                <th className="px-3 py-2">Public name</th>
                                <th className="px-3 py-2">Mode</th>
                                <th className="px-3 py-2">Route kind</th>
                                <th className="px-3 py-2">Origin</th>
                                <th className="px-3 py-2">Destination</th>
                                <th className="px-3 py-2 text-right">Variants</th>
                                <th className="px-3 py-2 text-right">Stops</th>
                                <th className="px-3 py-2">Path</th>
                                <th className="px-3 py-2">Review status</th>
                                <th className="px-3 py-2 text-right">Confidence</th>
                                <th className="px-3 py-2">Active</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={12} className="px-3 py-8 text-center text-gray-500">
                                        Loading routes…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={12} className="px-3 py-8 text-center text-gray-500">
                                        No routes match the current filters.
                                    </td>
                                </tr>
                            ) : (
                                items.map((row) => (
                                    <tr
                                        key={row.public_id}
                                        onClick={() => openRoute(row.public_id)}
                                        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                                    >
                                        <td className="px-3 py-2 font-medium text-gray-900">
                                            {row.route_code}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{row.public_name}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {transportModeLabel(row.mode)}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{row.route_kind}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.origin_name ?? "—"}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.destination_name ?? "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                            {row.variant_count}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                            {row.stop_count}
                                        </td>
                                        <td className="px-3 py-2">
                                            {row.path_count > 0 ? (
                                                <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">
                                                    Has path
                                                </span>
                                            ) : (
                                                <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-100">
                                                    None
                                                </span>
                                            )}
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
                                ))
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
                            disabled={loading || filters.page <= 1}
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
                            disabled={loading || filters.page >= totalPages}
                            onClick={() => applyFilters({ page: filters.page + 1 }, false)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}

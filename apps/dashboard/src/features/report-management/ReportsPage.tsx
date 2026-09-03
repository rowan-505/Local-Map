"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { reportsPath } from "@/src/lib/dashboardPaths";

import { listReports } from "./api";
import {
    FIELD_VARIANT_OPTIONS,
    REPORT_SOURCE_OPTIONS,
    REPORT_STATUS_OPTIONS,
    REPORT_TYPE_OPTIONS,
    TARGET_ENTITY_TYPE_OPTIONS,
    formatDateTime,
    reportTypeLabel,
    statusBadgeClass,
    statusLabel,
    targetTypeLabel,
} from "./constants";
import type {
    AdminReport,
    AdminReportList,
    ReportsListFilters,
    ReportSourceCode,
    ReportStatusCode,
    ReportTargetEntityType,
    ReportTypeCode,
} from "./types";

const PAGE_SIZE = 25;

const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";

type TriState = "" | "true" | "false";

type Filters = {
    source: ReportSourceCode | "";
    status: ReportStatusCode | "";
    type: ReportTypeCode | "";
    targetEntityType: ReportTargetEntityType | "";
    routeCode: string;
    variantCode: "D0" | "D1" | "";
    anonymous: TriState;
    adminAreaId: string;
    createdFrom: string;
    createdTo: string;
};

const EMPTY_FILTERS: Filters = {
    source: "",
    status: "",
    type: "",
    targetEntityType: "",
    routeCode: "",
    variantCode: "",
    anonymous: "",
    adminAreaId: "",
    createdFrom: "",
    createdTo: "",
};

function ReporterCell({ report }: { report: AdminReport }) {
    if (report.is_anonymous) {
        return (
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                Anonymous
            </span>
        );
    }
    return (
        <span className="text-gray-700">{report.author?.display_name ?? report.author?.email ?? "User"}</span>
    );
}

function formatAccuracy(meters: number | null | undefined): string {
    if (meters === null || meters === undefined || !Number.isFinite(meters)) {
        return "—";
    }
    return `${Math.round(meters)} m`;
}

function sourceLabel(code: string | undefined): string {
    if (code === "field_survey") return "Field";
    return "Public";
}

function fieldStopLabel(report: AdminReport): string {
    return report.field?.stop_name ?? report.field?.stop_public_id ?? "—";
}

function targetLabel(report: AdminReport): string {
    const type = targetTypeLabel(report.target_entity_type);
    if (report.target_entity_type === "map_point" || !report.target_entity_id) {
        return type;
    }
    return `${type} #${report.target_entity_id}`;
}

export default function ReportsPage() {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [page, setPage] = useState(1);
    const [data, setData] = useState<AdminReportList | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const apiFilters = useMemo<ReportsListFilters>(
        () => ({
            source: filters.source || undefined,
            status: filters.status || undefined,
            type: filters.type || undefined,
            targetEntityType: filters.targetEntityType || undefined,
            routeCode: filters.routeCode.trim() || undefined,
            variantCode: filters.variantCode || undefined,
            anonymous: filters.anonymous === "" ? undefined : filters.anonymous === "true",
            adminAreaId: filters.adminAreaId ? Number(filters.adminAreaId) : undefined,
            createdFrom: filters.createdFrom || undefined,
            createdTo: filters.createdTo || undefined,
            page,
            pageSize: PAGE_SIZE,
        }),
        [filters, page]
    );

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const res = await listReports(apiFilters, signal ? { signal } : undefined);
                setData(res);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load reports.");
                setData(null);
            } finally {
                setLoading(false);
            }
        },
        [apiFilters]
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
        setPage(1);
    }, []);

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(page * PAGE_SIZE, total);
    const fieldTable = filters.source === "field_survey";
    const colSpan = fieldTable ? 9 : 10;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Public map reports and CoreMap Field survey reports share this list.
                            Field reports are reviewed here, then edited in the existing transport
                            editors.
                        </p>
                    </div>
                    <Link
                        href={reportsPath("analytics")}
                        prefetch={false}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Analytics
                    </Link>
                </header>

                <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap gap-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Source
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.source}
                                onChange={(e) =>
                                    patch({ source: e.target.value as ReportSourceCode | "" })
                                }
                            >
                                <option value="">All</option>
                                {REPORT_SOURCE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Status
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.status}
                                onChange={(e) => patch({ status: e.target.value as ReportStatusCode | "" })}
                            >
                                <option value="">All</option>
                                {REPORT_STATUS_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Type
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.type}
                                onChange={(e) => patch({ type: e.target.value as ReportTypeCode | "" })}
                            >
                                <option value="">All</option>
                                {REPORT_TYPE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Target
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.targetEntityType}
                                onChange={(e) =>
                                    patch({
                                        targetEntityType: e.target.value as ReportTargetEntityType | "",
                                    })
                                }
                            >
                                <option value="">All</option>
                                {TARGET_ENTITY_TYPE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Route
                            </span>
                            <input
                                type="text"
                                value={filters.routeCode}
                                onChange={(e) => patch({ routeCode: e.target.value })}
                                placeholder="YBS-13"
                                className={`w-32 ${SELECT_CLASS}`}
                            />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                D0 / D1
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.variantCode}
                                onChange={(e) =>
                                    patch({ variantCode: e.target.value as "D0" | "D1" | "" })
                                }
                            >
                                <option value="">All</option>
                                {FIELD_VARIANT_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Reporter
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.anonymous}
                                onChange={(e) => patch({ anonymous: e.target.value as TriState })}
                            >
                                <option value="">Any</option>
                                <option value="false">Logged-in</option>
                                <option value="true">Anonymous</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Region ID
                            </span>
                            <input
                                type="number"
                                min={1}
                                value={filters.adminAreaId}
                                onChange={(e) => patch({ adminAreaId: e.target.value })}
                                placeholder="Any"
                                className={`w-28 ${SELECT_CLASS}`}
                            />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                From
                            </span>
                            <input
                                type="date"
                                value={filters.createdFrom}
                                onChange={(e) => patch({ createdFrom: e.target.value })}
                                className={SELECT_CLASS}
                            />
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                To
                            </span>
                            <input
                                type="date"
                                value={filters.createdTo}
                                onChange={(e) => patch({ createdTo: e.target.value })}
                                className={SELECT_CLASS}
                            />
                        </label>

                        <div className="flex items-end">
                            <button type="button" onClick={resetFilters} className={SECONDARY_BTN}>
                                Reset
                            </button>
                        </div>
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
                            {fieldTable ? (
                                <tr>
                                    <th className="px-3 py-2">Route</th>
                                    <th className="px-3 py-2">Variant</th>
                                    <th className="px-3 py-2">Target stop</th>
                                    <th className="px-3 py-2">Issue</th>
                                    <th className="px-3 py-2">GPS accuracy</th>
                                    <th className="px-3 py-2">Observed time</th>
                                    <th className="px-3 py-2">Media</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            ) : (
                                <tr>
                                    <th className="px-3 py-2">Source</th>
                                    <th className="px-3 py-2">Status</th>
                                    <th className="px-3 py-2">Type</th>
                                    <th className="px-3 py-2">Target</th>
                                    <th className="px-3 py-2">Region</th>
                                    <th className="px-3 py-2">Reporter</th>
                                    <th className="px-3 py-2">Priority</th>
                                    <th className="px-3 py-2">Created</th>
                                    <th className="px-3 py-2">Media</th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            )}
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={colSpan} className="px-3 py-8 text-center text-gray-500">
                                        Loading reports…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={colSpan} className="px-3 py-8 text-center text-gray-500">
                                        No reports match the current filters.
                                    </td>
                                </tr>
                            ) : fieldTable ? (
                                items.map((row) => (
                                    <tr
                                        key={row.public_id}
                                        className="border-b border-gray-100 hover:bg-gray-50"
                                    >
                                        <td className="px-3 py-2 font-medium text-gray-900">
                                            {row.field?.route_code ?? "—"}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.field?.variant_code ?? "—"}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{fieldStopLabel(row)}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {reportTypeLabel(row.report_type.code)}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {formatAccuracy(row.location_accuracy_m)}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {formatDateTime(row.observed_at)}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{row.media_count ?? 0}</td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusBadgeClass(
                                                    row.status.code
                                                )}`}
                                            >
                                                {statusLabel(row.status.code)}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <Link
                                                prefetch={false}
                                                href={reportsPath(row.public_id)}
                                                className="font-medium text-gray-900 underline-offset-2 hover:underline"
                                            >
                                                Review
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                items.map((row) => (
                                    <tr
                                        key={row.public_id}
                                        className="border-b border-gray-100 hover:bg-gray-50"
                                    >
                                        <td className="px-3 py-2 text-gray-700">
                                            {sourceLabel(row.source_code)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${statusBadgeClass(
                                                    row.status.code
                                                )}`}
                                            >
                                                {statusLabel(row.status.code)}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {reportTypeLabel(row.report_type.code)}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{targetLabel(row)}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.admin_area_id ?? "—"}
                                        </td>
                                        <td className="px-3 py-2">
                                            <ReporterCell report={row} />
                                        </td>
                                        <td className="px-3 py-2 capitalize text-gray-700">
                                            {row.priority}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {formatDateTime(row.created_at)}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{row.media_count ?? 0}</td>
                                        <td className="px-3 py-2 text-right">
                                            <Link
                                                prefetch={false}
                                                href={reportsPath(row.public_id)}
                                                className="font-medium text-gray-900 underline-offset-2 hover:underline"
                                            >
                                                Review
                                            </Link>
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
                            disabled={loading || page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            className={SECONDARY_BTN}
                        >
                            Previous
                        </button>
                        <span className="tabular-nums">
                            Page {page} of {totalPages}
                        </span>
                        <button
                            type="button"
                            disabled={loading || page >= totalPages}
                            onClick={() => setPage((p) => p + 1)}
                            className={SECONDARY_BTN}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </main>
    );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { isAbortError } from "@/src/lib/api";
import { searchPath } from "@/src/lib/dashboardNavigation";

import { getSearchAnalyticsDashboard } from "./api";
import {
    entityTypeLabel,
    formatBucketLabel,
    formatPercent,
    searchCategoryLabel,
    searchLanguageLabel,
} from "./constants";
import {
    SEARCH_ANALYTICS_EMPTY_LABEL,
    clickedEntityRowLabel,
    formatNullableLatencyMs,
    hasAnalyticsLatencyPoints,
} from "./searchAnalyticsDisplay";
import type { SearchAnalyticsDashboard, SearchAnalyticsPeriod } from "./types";
import { INPUT_CLASS, PRIMARY_BTN, SECONDARY_BTN, SELECT_CLASS, CELL_TEXT_CLASS } from "./ui";

const BAR_COLOR = "#4f46e5";
const LINE_ZERO = "#d97706";
const LINE_P50 = "#0891b2";
const LINE_P95 = "#7c3aed";

function ChartCard({
    title,
    children,
    action,
}: {
    title: string;
    children: React.ReactNode;
    action?: React.ReactNode;
}) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                {action}
            </div>
            <div style={{ width: "100%", height: 280 }}>{children}</div>
        </section>
    );
}

function EmptyChart({ label }: { label: string }) {
    return (
        <div className="flex h-full items-center justify-center text-sm text-gray-500">{label}</div>
    );
}

function DataTable({
    title,
    headers,
    rows,
}: {
    title: string;
    headers: string[];
    rows: Array<Array<string | number>>;
}) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-gray-900">{title}</h2>
            {rows.length === 0 ? (
                <p className="text-sm text-gray-500">{SEARCH_ANALYTICS_EMPTY_LABEL}</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                                {headers.map((header) => (
                                    <th key={header} className="px-2 py-2 font-medium">
                                        {header}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, index) => (
                                <tr key={index} className="border-b border-gray-100 last:border-0">
                                    {row.map((cell, cellIndex) => (
                                        <td key={cellIndex} className={`px-2 py-2 text-gray-800 ${cellIndex === 0 ? CELL_TEXT_CLASS : ""}`}>
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

function toIsoStart(value: string): string | undefined {
    if (!value) return undefined;
    return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function toIsoEnd(value: string): string | undefined {
    if (!value) return undefined;
    return new Date(`${value}T23:59:59.999Z`).toISOString();
}

export default function SearchAnalyticsPage() {
    const [period, setPeriod] = useState<SearchAnalyticsPeriod>("7d");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [data, setData] = useState<SearchAnalyticsDashboard | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const requestSequence = useRef(0);

    const load = useCallback(async (signal?: AbortSignal) => {
        const requestId = requestSequence.current + 1;
        requestSequence.current = requestId;
        setLoading(true);
        setError("");
        try {
            const filters =
                period === "custom"
                    ? {
                          period,
                          from: toIsoStart(customFrom),
                          to: toIsoEnd(customTo),
                      }
                    : { period };
            if (period === "custom" && (!filters.from || !filters.to)) {
                if (requestSequence.current !== requestId) return;
                setData(null);
                setLoading(false);
                return;
            }
            const res = await getSearchAnalyticsDashboard(filters, signal ? { signal } : undefined);
            if (requestSequence.current !== requestId) return;
            setData(res);
        } catch (err) {
            if (isAbortError(err)) return;
            if (requestSequence.current !== requestId) return;
            setError(err instanceof Error ? err.message : "Failed to load search analytics.");
            setData(null);
        } finally {
            if (requestSequence.current === requestId) {
                setLoading(false);
            }
        }
    }, [period, customFrom, customTo]);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const timeseriesData = useMemo(() => {
        if (!data) return [];
        return data.timeseries.map((row) => ({
            label: formatBucketLabel(row.bucket, data.range.timeseries_bucket),
            searches: row.searches,
            zero_result_rate: row.zero_result_rate,
            latency_p50_ms: row.latency_p50_ms,
            latency_p95_ms: row.latency_p95_ms,
        }));
    }, [data]);

    const hasLatencyData = useMemo(
        () => hasAnalyticsLatencyPoints(data?.timeseries ?? []),
        [data?.timeseries],
    );

    const languageData = useMemo(
        () =>
            (data?.by_language ?? []).map((row) => ({
                name: searchLanguageLabel(row.key),
                count: row.count,
            })),
        [data?.by_language],
    );

    const categoryData = useMemo(
        () =>
            (data?.by_category ?? []).map((row) => ({
                name: searchCategoryLabel(row.key),
                count: row.count,
            })),
        [data?.by_category],
    );

    const summary = data?.summary;
    const missingCustomRange = period === "custom" && (!customFrom || !customTo);
    const initialLoading = loading && !data;
    const reloading = loading && data !== null;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Search analytics</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Aggregated public search behavior from request and click telemetry.
                            No raw event export.
                        </p>
                    </div>
                    <Link href={searchPath("failed-searches")} className={SECONDARY_BTN}>
                        Failed searches
                    </Link>
                </header>

                <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end">
                    <label className="flex flex-col gap-1 text-sm">
                        <span className="text-gray-600">Time range</span>
                        <select
                            value={period}
                            onChange={(e) => setPeriod(e.target.value as SearchAnalyticsPeriod)}
                            className={SELECT_CLASS}
                        >
                            <option value="today">Today</option>
                            <option value="7d">Last 7 days</option>
                            <option value="30d">Last 30 days</option>
                            <option value="custom">Custom range</option>
                        </select>
                    </label>
                    {period === "custom" ? (
                        <>
                            <label className="flex flex-col gap-1 text-sm">
                                <span className="text-gray-600">From</span>
                                <input
                                    type="date"
                                    value={customFrom}
                                    onChange={(e) => setCustomFrom(e.target.value)}
                                    className={INPUT_CLASS}
                                />
                            </label>
                            <label className="flex flex-col gap-1 text-sm">
                                <span className="text-gray-600">To</span>
                                <input
                                    type="date"
                                    value={customTo}
                                    onChange={(e) => setCustomTo(e.target.value)}
                                    className={INPUT_CLASS}
                                />
                            </label>
                        </>
                    ) : null}
                    <button
                        type="button"
                        className={PRIMARY_BTN}
                        disabled={loading}
                        onClick={() => void load()}
                    >
                        {loading ? "Refreshing…" : "Refresh"}
                    </button>
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

                {initialLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
                        Loading search analytics…
                    </div>
                ) : null}

                {reloading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-600 shadow-sm">
                        Refreshing search analytics…
                    </div>
                ) : null}

                {!loading && missingCustomRange ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        Choose a custom from/to date range.
                    </div>
                ) : null}

                {!loading && !error && summary && !missingCustomRange ? (
                    <>
                        {data?.summary.total_searches === 0 ? (
                            <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600 shadow-sm">
                                {SEARCH_ANALYTICS_EMPTY_LABEL}
                            </div>
                        ) : null}
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                            <StatsCard title="Total searches" value={summary.total_searches} />
                            <StatsCard
                                title="Zero-result rate"
                                value={formatPercent(summary.zero_result_rate)}
                                statusColor={summary.zero_result_rate >= 20 ? "warning" : "default"}
                            />
                            <StatsCard
                                title="Click-through rate"
                                value={formatPercent(summary.click_through_rate)}
                                statusColor="success"
                            />
                            <StatsCard
                                title="No-click rate"
                                value={formatPercent(summary.no_click_rate)}
                            />
                            <StatsCard
                                title="P50 latency"
                                value={
                                    summary.latency_p50_ms !== null
                                        ? `${summary.latency_p50_ms} ms`
                                        : "—"
                                }
                            />
                            <StatsCard
                                title="P95 latency"
                                value={
                                    summary.latency_p95_ms !== null
                                        ? `${summary.latency_p95_ms} ms`
                                        : "—"
                                }
                                statusColor={
                                    summary.latency_p95_ms !== null && summary.latency_p95_ms >= 500
                                        ? "warning"
                                        : "default"
                                }
                            />
                        </div>

                        <div className="grid gap-6 lg:grid-cols-2">
                            <ChartCard title="Searches over time">
                                {timeseriesData.length === 0 ? (
                                    <EmptyChart label={SEARCH_ANALYTICS_EMPTY_LABEL} />
                                ) : (
                                    <ResponsiveContainer>
                                        <BarChart
                                            data={timeseriesData}
                                            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                            <Tooltip />
                                            <Bar
                                                dataKey="searches"
                                                name="Searches"
                                                fill={BAR_COLOR}
                                                radius={[4, 4, 0, 0]}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </ChartCard>

                            <ChartCard title="Zero-result rate over time">
                                {timeseriesData.length === 0 ? (
                                    <EmptyChart label={SEARCH_ANALYTICS_EMPTY_LABEL} />
                                ) : (
                                    <ResponsiveContainer>
                                        <LineChart
                                            data={timeseriesData}
                                            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                            <YAxis tick={{ fontSize: 11 }} width={40} unit="%" />
                                            <Tooltip formatter={(v) => `${v}%`} />
                                            <Line
                                                type="monotone"
                                                dataKey="zero_result_rate"
                                                name="Zero-result %"
                                                stroke={LINE_ZERO}
                                                strokeWidth={2}
                                                dot={false}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}
                            </ChartCard>

                            <ChartCard title="Latency over time (P50 / P95)">
                                {timeseriesData.length === 0 || !hasLatencyData ? (
                                    <EmptyChart label={SEARCH_ANALYTICS_EMPTY_LABEL} />
                                ) : (
                                    <ResponsiveContainer>
                                        <LineChart
                                            data={timeseriesData}
                                            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                            <YAxis tick={{ fontSize: 11 }} width={44} unit="ms" />
                                            <Tooltip
                                                formatter={(value, name) => [
                                                    formatNullableLatencyMs(
                                                        typeof value === "number" ? value : null,
                                                    ),
                                                    name,
                                                ]}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="latency_p50_ms"
                                                name="P50 ms"
                                                stroke={LINE_P50}
                                                strokeWidth={2}
                                                dot={false}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="latency_p95_ms"
                                                name="P95 ms"
                                                stroke={LINE_P95}
                                                strokeWidth={2}
                                                dot={false}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}
                            </ChartCard>

                            <ChartCard title="Searches by language">
                                {languageData.length === 0 ? (
                                    <EmptyChart label={SEARCH_ANALYTICS_EMPTY_LABEL} />
                                ) : (
                                    <ResponsiveContainer>
                                        <BarChart
                                            data={languageData}
                                            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                            <Tooltip />
                                            <Bar
                                                dataKey="count"
                                                name="Searches"
                                                fill="#0891b2"
                                                radius={[4, 4, 0, 0]}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </ChartCard>

                            <ChartCard title="Searches by category">
                                {categoryData.length === 0 ? (
                                    <EmptyChart label={SEARCH_ANALYTICS_EMPTY_LABEL} />
                                ) : (
                                    <ResponsiveContainer>
                                        <BarChart
                                            data={categoryData}
                                            margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                            <XAxis
                                                dataKey="name"
                                                tick={{ fontSize: 11 }}
                                                interval={0}
                                                angle={-15}
                                                textAnchor="end"
                                                height={60}
                                            />
                                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                            <Tooltip />
                                            <Bar
                                                dataKey="count"
                                                name="Searches"
                                                fill="#16a34a"
                                                radius={[4, 4, 0, 0]}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </ChartCard>
                        </div>

                        <div className="grid gap-6 lg:grid-cols-2">
                            <DataTable
                                title="Top searches"
                                headers={["Query", "Searches", "Zero %", "Clicks"]}
                                rows={(data?.top_searches ?? []).map((row) => [
                                    row.normalized_query,
                                    row.search_count,
                                    formatPercent(row.zero_result_rate),
                                    row.click_count,
                                ])}
                            />
                            <DataTable
                                title="Top failed searches"
                                headers={["Query", "Zero-result searches"]}
                                rows={(data?.top_failed_searches ?? []).map((row) => [
                                    row.normalized_query,
                                    row.search_count,
                                ])}
                            />
                            <DataTable
                                title="Trending queries"
                                headers={["Query", "Current", "Previous", "Growth"]}
                                rows={(data?.trending_queries ?? []).map((row) => [
                                    row.normalized_query,
                                    row.current_count,
                                    row.previous_count,
                                    row.growth > 0 ? `+${row.growth}` : row.growth,
                                ])}
                            />
                            <DataTable
                                title="Most clicked entities"
                                headers={["Entity", "Type", "Clicks"]}
                                rows={(data?.top_clicked_entities ?? []).map((row) => [
                                    clickedEntityRowLabel(row),
                                    entityTypeLabel(row.entity_type),
                                    row.click_count,
                                ])}
                            />
                        </div>
                    </>
                ) : null}
            </div>
        </main>
    );
}

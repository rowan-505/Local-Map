"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { isAbortError } from "@/src/lib/api";
import { reportsPath } from "@/src/lib/dashboardPaths";

import {
    getReportAnalyticsAnonymous,
    getReportAnalyticsByRegion,
    getReportAnalyticsByStatus,
    getReportAnalyticsByType,
    getReportAnalyticsSummary,
} from "./api";
import { reportTypeLabel, statusLabel } from "./constants";
import type {
    ReportAnalyticsSummary,
    ReportAnonymousCount,
    ReportCodeCount,
    ReportRegionCount,
} from "./types";

const BAR_COLOR = "#4f46e5";
const REGION_COLORS = ["#4f46e5", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0d9488"];

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-gray-900">{title}</h2>
            <div style={{ width: "100%", height: 280 }}>{children}</div>
        </section>
    );
}

function EmptyChart({ label }: { label: string }) {
    return (
        <div className="flex h-full items-center justify-center text-sm text-gray-500">{label}</div>
    );
}

export default function ReportAnalyticsPage() {
    const [summary, setSummary] = useState<ReportAnalyticsSummary | null>(null);
    const [byType, setByType] = useState<ReportCodeCount[]>([]);
    const [byStatus, setByStatus] = useState<ReportCodeCount[]>([]);
    const [byRegion, setByRegion] = useState<ReportRegionCount[]>([]);
    const [anon, setAnon] = useState<ReportAnonymousCount | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async (signal?: AbortSignal) => {
        const init = signal ? { signal } : undefined;
        setLoading(true);
        setError("");
        try {
            const [s, t, st, rg, a] = await Promise.all([
                getReportAnalyticsSummary(init),
                getReportAnalyticsByType(init),
                getReportAnalyticsByStatus(init),
                getReportAnalyticsByRegion(init),
                getReportAnalyticsAnonymous(init),
            ]);
            setSummary(s);
            setByType(t);
            setByStatus(st);
            setByRegion(rg);
            setAnon(a);
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load report analytics.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const typeData = useMemo(
        () => byType.map((r) => ({ name: reportTypeLabel(r.code), count: r.count })),
        [byType]
    );
    const statusData = useMemo(
        () => byStatus.map((r) => ({ name: statusLabel(r.code), count: r.count })),
        [byStatus]
    );
    const regionData = useMemo(
        () =>
            byRegion
                .slice(0, 12)
                .map((r) => ({ name: r.region_name ?? "Unassigned", count: r.count })),
        [byRegion]
    );
    const anonData = useMemo(
        () =>
            anon
                ? [
                      { name: "Logged-in", count: anon.logged_in },
                      { name: "Anonymous", count: anon.anonymous },
                  ]
                : [],
        [anon]
    );

    if (loading) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
                    Loading report analytics…
                </div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Report Analytics</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Report volume by status, type, region, and reporter. Figures reflect the
                            database at fetch time.
                        </p>
                    </div>
                    <Link
                        href={reportsPath()}
                        prefetch={false}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Reports queue
                    </Link>
                </header>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                {summary ? (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                        <StatsCard title="Total reports" value={summary.total} />
                        <StatsCard title="Submitted" value={summary.submitted} />
                        <StatsCard title="In review" value={summary.in_review} />
                        <StatsCard
                            title="Needs more info"
                            value={summary.needs_more_info}
                            statusColor="warning"
                        />
                        <StatsCard title="Accepted" value={summary.accepted} statusColor="success" />
                        <StatsCard title="Rejected" value={summary.rejected} statusColor="danger" />
                        <StatsCard title="Duplicate" value={summary.duplicate} />
                        <StatsCard title="Anonymous" value={summary.anonymous} />
                        <StatsCard title="Logged-in" value={summary.logged_in} />
                        <StatsCard title="This week" value={summary.this_week} />
                        <StatsCard title="This month" value={summary.this_month} />
                    </div>
                ) : null}

                <div className="grid gap-6 lg:grid-cols-2">
                    <ChartCard title="Reports by type">
                        {typeData.length === 0 ? (
                            <EmptyChart label="No reports yet." />
                        ) : (
                            <ResponsiveContainer>
                                <BarChart data={typeData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                    <Tooltip />
                                    <Bar dataKey="count" name="Reports" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>

                    <ChartCard title="Reports by status">
                        {statusData.length === 0 ? (
                            <EmptyChart label="No reports yet." />
                        ) : (
                            <ResponsiveContainer>
                                <BarChart data={statusData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                    <Tooltip />
                                    <Bar dataKey="count" name="Reports" fill="#0891b2" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>

                    <ChartCard title="Reports by region">
                        {regionData.length === 0 ? (
                            <EmptyChart label="No reports with a region yet." />
                        ) : (
                            <ResponsiveContainer>
                                <BarChart data={regionData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                    <Tooltip />
                                    <Bar dataKey="count" name="Reports" radius={[4, 4, 0, 0]}>
                                        {regionData.map((_, index) => (
                                            <Cell key={index} fill={REGION_COLORS[index % REGION_COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>

                    <ChartCard title="Anonymous vs logged-in">
                        {anonData.length === 0 ? (
                            <EmptyChart label="No reports yet." />
                        ) : (
                            <ResponsiveContainer>
                                <BarChart data={anonData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                    <Tooltip />
                                    <Bar dataKey="count" name="Reports" radius={[4, 4, 0, 0]}>
                                        <Cell fill="#16a34a" />
                                        <Cell fill="#64748b" />
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </ChartCard>
                </div>
            </div>
        </main>
    );
}

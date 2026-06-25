"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { isAbortError } from "@/src/lib/api";

import {
    getAnalyticsByRegion,
    getAnalyticsByRole,
    getAnalyticsGrowth,
    getAnalyticsPointsByReason,
    getAnalyticsSavedPlaces,
    getAnalyticsSummary,
} from "./api";
import { reasonLabel, roleLabel } from "./constants";
import { SELECT_CLASS } from "./ui";
import type {
    AnalyticsBucket,
    AnalyticsSummary,
    GrowthBucket,
    PointsByReason,
    RegionCount,
    RoleCount,
    SavedPlacesAnalytics,
} from "./types";

const BAR_COLOR = "#4f46e5";
const REGION_COLORS = ["#4f46e5", "#0891b2", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0d9488"];

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

export default function UserAnalyticsPage() {
    const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
    const [saved, setSaved] = useState<SavedPlacesAnalytics | null>(null);
    const [byRole, setByRole] = useState<RoleCount[]>([]);
    const [byRegion, setByRegion] = useState<RegionCount[]>([]);
    const [byReason, setByReason] = useState<PointsByReason[]>([]);
    const [growth, setGrowth] = useState<GrowthBucket[]>([]);
    const [bucket, setBucket] = useState<AnalyticsBucket>("day");
    const [days, setDays] = useState(30);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const load = useCallback(async (signal?: AbortSignal) => {
        const init = signal ? { signal } : undefined;
        setLoading(true);
        setError("");
        try {
            const [s, sp, role, region, reason] = await Promise.all([
                getAnalyticsSummary(init),
                getAnalyticsSavedPlaces(init),
                getAnalyticsByRole(init),
                getAnalyticsByRegion(init),
                getAnalyticsPointsByReason(init),
            ]);
            setSummary(s);
            setSaved(sp);
            setByRole(role);
            setByRegion(region);
            setByReason(reason);
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load analytics.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    useEffect(() => {
        const controller = new AbortController();
        getAnalyticsGrowth(bucket, days, { signal: controller.signal })
            .then(setGrowth)
            .catch((err) => {
                if (!isAbortError(err)) {
                    // growth is non-critical; surface only if nothing else failed
                }
            });
        return () => controller.abort();
    }, [bucket, days]);

    const roleData = useMemo(
        () => byRole.map((r) => ({ name: roleLabel(r.role), count: r.count })),
        [byRole]
    );
    const regionData = useMemo(
        () =>
            byRegion
                .slice(0, 12)
                .map((r) => ({ name: r.region_name ?? "Unassigned", count: r.count })),
        [byRegion]
    );
    const reasonData = useMemo(
        () =>
            byReason.map((r) => ({
                name: reasonLabel(r.reason_code),
                awarded: r.total_awarded,
                removed: r.total_removed,
            })),
        [byReason]
    );

    if (loading) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
                    Loading analytics…
                </div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">User Analytics</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Registered-user metrics. Figures reflect the database at fetch time.
                    </p>
                </header>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                {summary ? (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                        <StatsCard title="Total users" value={summary.total_users} />
                        <StatsCard title="Verified" value={summary.verified_users} statusColor="success" />
                        <StatsCard title="Unverified" value={summary.unverified_users} statusColor="warning" />
                        <StatsCard title="Disabled" value={summary.disabled_users} statusColor="danger" />
                        <StatsCard title="New today" value={summary.new_today} />
                        <StatsCard title="New this week" value={summary.new_this_week} />
                        <StatsCard title="New this month" value={summary.new_this_month} />
                        <StatsCard title="Active this week" value={summary.active_this_week} statusColor="success" />
                        <StatsCard title="Admins" value={summary.admin_count} />
                        <StatsCard title="Super admins" value={summary.super_admin_count} />
                        <StatsCard
                            title="Saved places"
                            value={saved?.total_saved_places ?? summary.total_saved_places}
                        />
                        <StatsCard title="Total points" value={summary.total_points_awarded} />
                    </div>
                ) : null}

                <ChartCard
                    title="New users"
                    action={
                        <div className="flex items-center gap-2">
                            <select
                                className={SELECT_CLASS}
                                value={bucket}
                                onChange={(e) => setBucket(e.target.value as AnalyticsBucket)}
                            >
                                <option value="day">By day</option>
                                <option value="week">By week</option>
                                <option value="month">By month</option>
                            </select>
                            <select
                                className={SELECT_CLASS}
                                value={days}
                                onChange={(e) => setDays(Number(e.target.value))}
                            >
                                <option value={30}>30 days</option>
                                <option value={90}>90 days</option>
                                <option value={180}>180 days</option>
                                <option value={365}>365 days</option>
                            </select>
                        </div>
                    }
                >
                    <ResponsiveContainer>
                        <LineChart data={growth} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} minTickGap={24} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                            <Tooltip />
                            <Line
                                type="monotone"
                                dataKey="count"
                                name="New users"
                                stroke={BAR_COLOR}
                                strokeWidth={2}
                                dot={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </ChartCard>

                <div className="grid gap-6 lg:grid-cols-2">
                    <ChartCard title="Users by role">
                        <ResponsiveContainer>
                            <BarChart data={roleData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                <Tooltip />
                                <Bar dataKey="count" name="Users" fill={BAR_COLOR} radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartCard>

                    <ChartCard title="Users by region">
                        <ResponsiveContainer>
                            <BarChart data={regionData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                <Tooltip />
                                <Bar dataKey="count" name="Users" radius={[4, 4, 0, 0]}>
                                    {regionData.map((_, index) => (
                                        <Cell key={index} fill={REGION_COLORS[index % REGION_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </ChartCard>
                </div>

                <ChartCard title="Points by reason">
                    {reasonData.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-gray-500">
                            No point activity yet.
                        </div>
                    ) : (
                        <ResponsiveContainer>
                            <BarChart data={reasonData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                                <Tooltip />
                                <Bar dataKey="awarded" name="Awarded" fill="#16a34a" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="removed" name="Removed" fill="#dc2626" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </ChartCard>
            </div>
        </main>
    );
}

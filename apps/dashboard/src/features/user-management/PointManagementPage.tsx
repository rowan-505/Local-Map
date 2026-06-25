"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { isAbortError } from "@/src/lib/api";
import { usersPath } from "@/src/lib/dashboardPaths";

import {
    adjustUserPoints,
    getAnalyticsPoints,
    listPointLedger,
    listTopPointUsers,
} from "./api";
import { POINT_REASON_OPTIONS, formatDateTime, reasonLabel } from "./constants";
import {
    INPUT_CLASS,
    PRIMARY_BTN,
    PointsDelta,
    SECONDARY_BTN,
    SELECT_CLASS,
} from "./ui";
import type {
    AdminLedgerList,
    PointReasonCode,
    PointsAnalytics,
    TopPointUser,
} from "./types";

const PAGE_SIZE = 25;

export default function PointManagementPage() {
    const [filterUserId, setFilterUserId] = useState("");
    const [filterReason, setFilterReason] = useState<PointReasonCode | "">("");
    const [page, setPage] = useState(1);

    const [ledger, setLedger] = useState<AdminLedgerList | null>(null);
    const [topUsers, setTopUsers] = useState<TopPointUser[]>([]);
    const [analytics, setAnalytics] = useState<PointsAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [busy, setBusy] = useState(false);
    const [formError, setFormError] = useState("");
    const [formMessage, setFormMessage] = useState("");
    const [targetUserId, setTargetUserId] = useState("");
    const [delta, setDelta] = useState("");
    const [reason, setReason] = useState<PointReasonCode>("admin_adjustment");
    const [note, setNote] = useState("");

    const ledgerParams = useMemo(
        () => ({
            userId: filterUserId.trim() || undefined,
            reasonCode: filterReason || undefined,
            page,
            pageSize: PAGE_SIZE,
        }),
        [filterUserId, filterReason, page]
    );

    const loadLedger = useCallback(
        (signal?: AbortSignal) => {
            setLoading(true);
            setError("");
            return listPointLedger(ledgerParams, signal ? { signal } : undefined)
                .then(setLedger)
                .catch((err) => {
                    if (isAbortError(err)) return;
                    setError(err instanceof Error ? err.message : "Failed to load point changes.");
                    setLedger(null);
                })
                .finally(() => setLoading(false));
        },
        [ledgerParams]
    );

    useEffect(() => {
        const controller = new AbortController();
        void loadLedger(controller.signal);
        return () => controller.abort();
    }, [loadLedger]);

    const reloadSide = useCallback((signal?: AbortSignal) => {
        const init = signal ? { signal } : undefined;
        listTopPointUsers(20, init)
            .then(setTopUsers)
            .catch(() => undefined);
        getAnalyticsPoints(init)
            .then(setAnalytics)
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        reloadSide(controller.signal);
        return () => controller.abort();
    }, [reloadSide]);

    const submitAdjustment = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            setFormError("");
            setFormMessage("");
            const value = Number(delta);
            if (!targetUserId.trim()) {
                setFormError("Enter the target user public_id.");
                return;
            }
            if (!Number.isInteger(value) || value === 0) {
                setFormError("Enter a non-zero whole number for points.");
                return;
            }
            setBusy(true);
            try {
                await adjustUserPoints(targetUserId.trim(), {
                    pointsDelta: value,
                    reasonCode: reason,
                    note: note.trim() || undefined,
                });
                setFormMessage(`Applied ${value > 0 ? "+" : ""}${value} points.`);
                setDelta("");
                setNote("");
                await loadLedger();
                reloadSide();
            } catch (err) {
                setFormError(err instanceof Error ? err.message : "Failed to apply points.");
            } finally {
                setBusy(false);
            }
        },
        [delta, targetUserId, reason, note, loadLedger, reloadSide]
    );

    const applyUser = useCallback((publicId: string) => {
        setTargetUserId(publicId);
        setFilterUserId(publicId);
        setPage(1);
    }, []);

    const items = ledger?.items ?? [];
    const total = ledger?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Point Management</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Manually award or deduct points. The ledger is append-only — corrections are
                        recorded as reversal rows.
                    </p>
                </header>

                {analytics ? (
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <StatsCard title="Total awarded" value={analytics.total_awarded} statusColor="success" />
                        <StatsCard title="Total removed" value={analytics.total_removed} statusColor="danger" />
                        <StatsCard title="Net points" value={analytics.net_points} />
                        <StatsCard title="Users with points" value={analytics.users_with_points} />
                    </div>
                ) : null}

                <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                    <h2 className="mb-4 text-base font-semibold text-gray-900">Adjust points</h2>
                    {formError ? (
                        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                            {formError}
                        </div>
                    ) : null}
                    {formMessage ? (
                        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
                            {formMessage}
                        </div>
                    ) : null}
                    <form className="flex flex-wrap items-end gap-3" onSubmit={submitAdjustment}>
                        <label className="flex flex-1 flex-col gap-1" style={{ minWidth: 260 }}>
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                User public_id
                            </span>
                            <input
                                type="text"
                                value={targetUserId}
                                onChange={(e) => setTargetUserId(e.target.value)}
                                placeholder="UUID — pick from Top users or paste"
                                className={INPUT_CLASS}
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Points (+/-)
                            </span>
                            <input
                                type="number"
                                value={delta}
                                onChange={(e) => setDelta(e.target.value)}
                                placeholder="e.g. 10"
                                className={`w-28 ${SELECT_CLASS}`}
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Reason
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={reason}
                                onChange={(e) => setReason(e.target.value as PointReasonCode)}
                            >
                                {POINT_REASON_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-1 flex-col gap-1" style={{ minWidth: 200 }}>
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Note (optional)
                            </span>
                            <input
                                type="text"
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                maxLength={1000}
                                className={INPUT_CLASS}
                            />
                        </label>
                        <button type="submit" disabled={busy} className={PRIMARY_BTN}>
                            Apply
                        </button>
                    </form>
                </section>

                <div className="grid gap-5 lg:grid-cols-3">
                    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:col-span-2">
                        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                            <h2 className="text-base font-semibold text-gray-900">Recent point changes</h2>
                            <div className="flex flex-wrap items-end gap-2">
                                <input
                                    type="text"
                                    value={filterUserId}
                                    onChange={(e) => {
                                        setFilterUserId(e.target.value);
                                        setPage(1);
                                    }}
                                    placeholder="Filter by user public_id"
                                    className={`w-56 ${SELECT_CLASS}`}
                                />
                                <select
                                    className={SELECT_CLASS}
                                    value={filterReason}
                                    onChange={(e) => {
                                        setFilterReason(e.target.value as PointReasonCode | "");
                                        setPage(1);
                                    }}
                                >
                                    <option value="">All reasons</option>
                                    {POINT_REASON_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {error ? (
                            <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800">
                                {error}
                            </div>
                        ) : null}

                        <div className="overflow-x-auto rounded-md border border-gray-200">
                            <table className="min-w-full text-left text-sm">
                                <thead className="border-b text-xs uppercase text-gray-500">
                                    <tr>
                                        <th className="px-3 py-2 text-right">Delta</th>
                                        <th className="px-3 py-2">User</th>
                                        <th className="px-3 py-2">Reason</th>
                                        <th className="px-3 py-2">By</th>
                                        <th className="px-3 py-2">When</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loading ? (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                                                Loading…
                                            </td>
                                        </tr>
                                    ) : items.length === 0 ? (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                                                No point changes found.
                                            </td>
                                        </tr>
                                    ) : (
                                        items.map((row) => (
                                            <tr key={row.id} className="border-b border-gray-100">
                                                <td className="px-3 py-2 text-right">
                                                    <PointsDelta value={row.points_delta} />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <Link
                                                        href={usersPath(row.user_public_id)}
                                                        className="text-gray-900 hover:underline"
                                                    >
                                                        {row.user_display_name}
                                                    </Link>
                                                    {row.note ? (
                                                        <p className="text-xs text-gray-500">{row.note}</p>
                                                    ) : null}
                                                </td>
                                                <td className="px-3 py-2 text-gray-700">
                                                    {reasonLabel(row.reason_code)}
                                                </td>
                                                <td className="px-3 py-2 text-gray-600">
                                                    {row.created_by_display_name ?? "—"}
                                                </td>
                                                <td className="px-3 py-2 text-gray-600">
                                                    {formatDateTime(row.created_at)}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
                            <span>{total.toLocaleString()} changes</span>
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
                    </section>

                    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <h2 className="mb-3 text-base font-semibold text-gray-900">Top point users</h2>
                        {topUsers.length === 0 ? (
                            <p className="text-sm text-gray-500">No users with points yet.</p>
                        ) : (
                            <ul className="divide-y divide-gray-100">
                                {topUsers.map((u, index) => (
                                    <li key={u.public_id} className="flex items-center justify-between gap-2 py-2">
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-gray-900">
                                                <span className="mr-1 text-gray-400">{index + 1}.</span>
                                                {u.display_name}
                                            </p>
                                            <p className="truncate text-xs text-gray-500">{u.email}</p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <span className="tabular-nums text-sm font-semibold text-gray-900">
                                                {u.total_points}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => applyUser(u.public_id)}
                                                className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
                                            >
                                                Use
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>
            </div>
        </main>
    );
}

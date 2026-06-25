"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { isAbortError } from "@/src/lib/api";
import { usersPath } from "@/src/lib/dashboardPaths";

import { getAnalyticsSummary, listUsers } from "./api";
import { ACCOUNT_STATUS_OPTIONS, ROLE_OPTIONS, formatDate, formatDateTime } from "./constants";
import { INPUT_CLASS, PRIMARY_BTN, RolePills, SECONDARY_BTN, SELECT_CLASS, StatusBadge, VerifiedBadge } from "./ui";
import type { AccountStatus, AdminUserList, AnalyticsSummary, UsersListFilters } from "./types";

const PAGE_SIZE = 25;

type TriState = "" | "true" | "false";

type Filters = {
    search: string;
    role: string;
    emailVerified: TriState;
    accountStatus: AccountStatus | "";
    primaryRegionId: string;
};

const EMPTY_FILTERS: Filters = {
    search: "",
    role: "",
    emailVerified: "",
    accountStatus: "",
    primaryRegionId: "",
};

export default function UsersPage() {
    const router = useRouter();
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [searchInput, setSearchInput] = useState("");
    const [page, setPage] = useState(1);

    const [data, setData] = useState<AdminUserList | null>(null);
    const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const apiFilters = useMemo<UsersListFilters>(
        () => ({
            search: filters.search || undefined,
            role: filters.role || undefined,
            emailVerified: filters.emailVerified === "" ? undefined : filters.emailVerified === "true",
            accountStatus: filters.accountStatus || undefined,
            primaryRegionId: filters.primaryRegionId ? Number(filters.primaryRegionId) : undefined,
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
                const res = await listUsers(apiFilters, signal ? { signal } : undefined);
                setData(res);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load users.");
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

    useEffect(() => {
        const controller = new AbortController();
        getAnalyticsSummary({ signal: controller.signal })
            .then(setSummary)
            .catch(() => undefined);
        return () => controller.abort();
    }, []);

    const patch = useCallback((next: Partial<Filters>) => {
        setFilters((prev) => ({ ...prev, ...next }));
        setPage(1);
    }, []);

    const resetFilters = useCallback(() => {
        setFilters(EMPTY_FILTERS);
        setSearchInput("");
        setPage(1);
    }, []);

    const items = data?.items ?? [];
    const total = data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(page * PAGE_SIZE, total);

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Users</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Public accounts, roles, verification, and points. Read-only list; open a user
                        to manage status, roles, notes, and points.
                    </p>
                </header>

                {summary ? (
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <StatsCard title="Total users" value={summary.total_users} />
                        <StatsCard
                            title="Verified"
                            value={summary.verified_users}
                            statusColor="success"
                        />
                        <StatsCard
                            title="Unverified"
                            value={summary.unverified_users}
                            statusColor="warning"
                        />
                        <StatsCard
                            title="Disabled"
                            value={summary.disabled_users}
                            statusColor="danger"
                        />
                    </div>
                ) : null}

                <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <form
                        className="flex flex-col gap-2 sm:flex-row"
                        onSubmit={(e) => {
                            e.preventDefault();
                            patch({ search: searchInput.trim() });
                        }}
                    >
                        <input
                            type="search"
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                            placeholder="Search name, email, or phone…"
                            autoComplete="off"
                            className={`flex-1 ${INPUT_CLASS}`}
                        />
                        <div className="flex gap-2">
                            <button type="submit" className={PRIMARY_BTN}>
                                Search
                            </button>
                            <button type="button" onClick={resetFilters} className={SECONDARY_BTN}>
                                Reset
                            </button>
                        </div>
                    </form>

                    <div className="flex flex-wrap gap-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Role
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.role}
                                onChange={(e) => patch({ role: e.target.value })}
                            >
                                <option value="">All</option>
                                {ROLE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Verified
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.emailVerified}
                                onChange={(e) => patch({ emailVerified: e.target.value as TriState })}
                            >
                                <option value="">Any</option>
                                <option value="true">Verified</option>
                                <option value="false">Unverified</option>
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Status
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={filters.accountStatus}
                                onChange={(e) =>
                                    patch({ accountStatus: e.target.value as AccountStatus | "" })
                                }
                            >
                                <option value="">All</option>
                                {ACCOUNT_STATUS_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Region ID
                            </span>
                            <input
                                type="number"
                                min={1}
                                value={filters.primaryRegionId}
                                onChange={(e) => patch({ primaryRegionId: e.target.value })}
                                placeholder="Any"
                                className={`w-28 ${SELECT_CLASS}`}
                            />
                        </label>
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
                                <th className="px-3 py-2">Display name</th>
                                <th className="px-3 py-2">Email</th>
                                <th className="px-3 py-2">Verified</th>
                                <th className="px-3 py-2">Roles</th>
                                <th className="px-3 py-2">Region</th>
                                <th className="px-3 py-2 text-right">Points</th>
                                <th className="px-3 py-2">Joined</th>
                                <th className="px-3 py-2">Last login</th>
                                <th className="px-3 py-2">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                                        Loading users…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                                        No users match the current filters.
                                    </td>
                                </tr>
                            ) : (
                                items.map((row) => (
                                    <tr
                                        key={row.public_id}
                                        onClick={() => router.push(usersPath(row.public_id))}
                                        className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                                    >
                                        <td className="px-3 py-2 font-medium text-gray-900">
                                            {row.display_name}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">{row.email}</td>
                                        <td className="px-3 py-2">
                                            <VerifiedBadge verified={row.email_verified} />
                                        </td>
                                        <td className="px-3 py-2">
                                            <RolePills roles={row.roles} />
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {row.primary_region_id ?? "—"}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                                            {row.total_points}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {formatDate(row.created_at)}
                                        </td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {formatDateTime(row.last_login_at)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <StatusBadge status={row.account_status} />
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

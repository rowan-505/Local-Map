"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import { getTransportTerminals } from "./api";
import {
    TRANSPORT_MODE_OPTIONS,
    TRANSPORT_REVIEW_STATUS_OPTIONS,
    transportModeLabel,
    transportReviewStatusLabel,
    transportTerminalDisplayName,
} from "./constants";
import type { TransportRawNameStatus, TransportTerminalListItem } from "./types";

const PAGE_SIZE = 50;

type TriState = "" | "true" | "false";

type Filters = {
    search: string;
    mode: string;
    terminalRole: string;
    reviewStatus: string;
    generatedName: TriState;
    linkedStop: TriState;
    adminAreaId: string;
    confidenceMin: string;
    confidenceMax: string;
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
        terminalRole: sp.get("terminalRole") ?? "",
        reviewStatus: sp.get("reviewStatus") ?? "",
        generatedName: tri("generatedName"),
        linkedStop: tri("linkedStop"),
        adminAreaId: sp.get("adminAreaId") ?? "",
        confidenceMin: sp.get("confidenceMin") ?? "",
        confidenceMax: sp.get("confidenceMax") ?? "",
        isActive: tri("isActive"),
        page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
    };
}

function filtersToSearchParams(filters: Filters): string {
    const sp = new URLSearchParams();
    if (filters.search) sp.set("search", filters.search);
    if (filters.mode) sp.set("mode", filters.mode);
    if (filters.terminalRole.trim()) sp.set("terminalRole", filters.terminalRole.trim());
    if (filters.reviewStatus) sp.set("reviewStatus", filters.reviewStatus);
    if (filters.generatedName) sp.set("generatedName", filters.generatedName);
    if (filters.linkedStop) sp.set("linkedStop", filters.linkedStop);
    if (filters.adminAreaId.trim()) sp.set("adminAreaId", filters.adminAreaId.trim());
    if (filters.confidenceMin.trim()) sp.set("confidenceMin", filters.confidenceMin.trim());
    if (filters.confidenceMax.trim()) sp.set("confidenceMax", filters.confidenceMax.trim());
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

export default function TransportTerminalsPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const filters = useMemo(
        () => readFilters(new URLSearchParams(searchParams.toString())),
        [searchParams]
    );

    const [searchInput, setSearchInput] = useState(filters.search);
    const [roleInput, setRoleInput] = useState(filters.terminalRole);
    const [adminAreaInput, setAdminAreaInput] = useState(filters.adminAreaId);
    const [confMinInput, setConfMinInput] = useState(filters.confidenceMin);
    const [confMaxInput, setConfMaxInput] = useState(filters.confidenceMax);

    const [items, setItems] = useState<readonly TransportTerminalListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => setSearchInput(filters.search), [filters.search]);
    useEffect(() => setRoleInput(filters.terminalRole), [filters.terminalRole]);
    useEffect(() => setAdminAreaInput(filters.adminAreaId), [filters.adminAreaId]);
    useEffect(() => setConfMinInput(filters.confidenceMin), [filters.confidenceMin]);
    useEffect(() => setConfMaxInput(filters.confidenceMax), [filters.confidenceMax]);

    const applyFilters = useCallback(
        (patch: Partial<Filters>, resetPage = true) => {
            const next: Filters = {
                ...filters,
                ...patch,
                page: resetPage ? 1 : (patch.page ?? filters.page),
            };
            const qs = filtersToSearchParams(next);
            router.replace(qs ? `${transportPath("terminals")}?${qs}` : transportPath("terminals"));
        },
        [filters, router]
    );

    const load = useCallback(
        async (signal: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const adminAreaId = Number(filters.adminAreaId);
                const confMin = Number(filters.confidenceMin);
                const confMax = Number(filters.confidenceMax);
                const result = await getTransportTerminals(
                    {
                        search: filters.search || undefined,
                        mode: filters.mode || undefined,
                        terminalRole: filters.terminalRole || undefined,
                        reviewStatus: filters.reviewStatus || undefined,
                        generatedName:
                            filters.generatedName === "" ? undefined : filters.generatedName === "true",
                        linkedStop:
                            filters.linkedStop === "" ? undefined : filters.linkedStop === "true",
                        adminAreaId:
                            filters.adminAreaId.trim() && Number.isFinite(adminAreaId) && adminAreaId >= 1
                                ? Math.floor(adminAreaId)
                                : undefined,
                        confidenceMin:
                            filters.confidenceMin.trim() && Number.isFinite(confMin) ? confMin : undefined,
                        confidenceMax:
                            filters.confidenceMax.trim() && Number.isFinite(confMax) ? confMax : undefined,
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
                setError(err instanceof Error ? err.message : "Failed to load terminals.");
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

    const openTerminal = (terminal: TransportTerminalListItem) => {
        if (terminal.linked_stop?.public_id) {
            router.push(
                `${transportPath("stops")}?stop=${encodeURIComponent(terminal.linked_stop.public_id)}`,
            );
            return;
        }
        router.push(transportPath(`terminals/${terminal.public_id}`));
    };

    const resetAll = () => {
        setSearchInput("");
        setRoleInput("");
        setAdminAreaInput("");
        setConfMinInput("");
        setConfMaxInput("");
        router.replace(transportPath("terminals"));
    };

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">Terminals</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Transport terminals with raw-name status, linked stop, role, and review status.
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
                            placeholder="Search name, Myanmar/English name, terminal code…"
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
                                applyFilters({ terminalRole: roleInput.trim() });
                            }}
                        >
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Role
                            </span>
                            <input
                                value={roleInput}
                                onChange={(e) => setRoleInput(e.target.value)}
                                onBlur={() => applyFilters({ terminalRole: roleInput.trim() })}
                                placeholder="Any"
                                className={`w-32 ${SELECT_CLASS}`}
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
                            label="Linked stop"
                            value={filters.linkedStop}
                            onChange={(v) => applyFilters({ linkedStop: v })}
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
                                className={`w-28 ${SELECT_CLASS}`}
                            />
                        </form>

                        <form
                            className="flex flex-col gap-1"
                            onSubmit={(e) => {
                                e.preventDefault();
                                applyFilters({
                                    confidenceMin: confMinInput.trim(),
                                    confidenceMax: confMaxInput.trim(),
                                });
                            }}
                        >
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Confidence min/max
                            </span>
                            <div className="flex gap-1">
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={confMinInput}
                                    onChange={(e) => setConfMinInput(e.target.value)}
                                    onBlur={() => applyFilters({ confidenceMin: confMinInput.trim() })}
                                    placeholder="0"
                                    className={`w-20 ${SELECT_CLASS}`}
                                />
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={confMaxInput}
                                    onChange={(e) => setConfMaxInput(e.target.value)}
                                    onBlur={() => applyFilters({ confidenceMax: confMaxInput.trim() })}
                                    placeholder="100"
                                    className={`w-20 ${SELECT_CLASS}`}
                                />
                            </div>
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
                                <th className="px-3 py-2">Display name</th>
                                <th className="px-3 py-2">Raw name</th>
                                <th className="px-3 py-2">Mode</th>
                                <th className="px-3 py-2">Role</th>
                                <th className="px-3 py-2">Linked stop</th>
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
                                        Loading terminals…
                                    </td>
                                </tr>
                            ) : items.length === 0 ? (
                                <tr>
                                    <td colSpan={9} className="px-3 py-8 text-center text-gray-500">
                                        No terminals match the current filters.
                                    </td>
                                </tr>
                            ) : (
                                items.map((row) => {
                                    const displayName = transportTerminalDisplayName(row);
                                    const isCandidate = row.raw_name_status !== "real";
                                    return (
                                        <tr
                                            key={row.public_id}
                                            onClick={() => openTerminal(row)}
                                            className="cursor-pointer border-b border-gray-100 hover:bg-gray-50"
                                        >
                                            <td className="px-3 py-2">
                                                <div
                                                    className={`font-medium ${isCandidate ? "italic text-gray-600" : "text-gray-900"}`}
                                                >
                                                    {displayName}
                                                </div>
                                                {row.terminal_code ? (
                                                    <div className="text-xs text-gray-500">
                                                        #{row.terminal_code}
                                                    </div>
                                                ) : null}
                                            </td>
                                            <td className="px-3 py-2">
                                                <span
                                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${rawNameBadgeClass(row.raw_name_status)}`}
                                                >
                                                    {row.raw_name_status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {transportModeLabel(row.mode)}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {row.terminal_role}
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {row.linked_stop ? row.linked_stop.name : "—"}
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

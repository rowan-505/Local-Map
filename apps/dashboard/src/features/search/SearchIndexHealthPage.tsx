"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import StatsCard from "@/src/components/dashboard/StatsCard";
import { isAbortError } from "@/src/lib/api";
import { searchPath } from "@/src/lib/dashboardNavigation";
import { rolesFromJwtAccessToken } from "@/src/lib/jwtRoles";

import {
    getSearchIndexHealth,
    reindexSearchEntity,
    reindexSearchFamily,
    repairSearchIndexHealth,
    runSearchIndexHealthCheck,
} from "./api";
import {
    entityTypeLabel,
    formatDateTime,
    indexFamilyLabel,
    indexHealthSeverityBadgeState,
    indexHealthSeverityLabel,
    maintenanceOperationStatusLabel,
} from "./constants";
import {
    phaseAtSearchIndexHealthLoadStart,
    resolveSearchIndexHealthLoadPhase,
    shouldShowSearchIndexHealthContent,
    shouldShowSearchIndexHealthSkeleton,
    type SearchIndexHealthLoadPhase,
} from "./searchIndexHealthPageState";
import SearchIndexMaintenanceConfirmDialog from "./SearchIndexMaintenanceConfirmDialog";
import type { SearchIndexHealthReport, SearchIndexMaintenanceOperation } from "./types";
import { PRIMARY_BTN, SECONDARY_BTN, SELECT_CLASS, SyncStateBadge } from "./ui";

const HEALTH_FAMILY_SKELETON_ROWS = 12;

type PendingAction =
    | { kind: "repair" }
    | { kind: "reindex_family"; entity_family: string }
    | { kind: "reindex_entity"; entity_type: string; entity_id: string };

function canMaintainSearchIndex(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    const roles = rolesFromJwtAccessToken(window.localStorage.getItem("accessToken"));
    return roles.includes("super_admin");
}

function formatRunLabel(run: SearchIndexHealthReport["last_rebuild_run"]): string {
    if (!run) return "No runs recorded";
    const finished = run.finished_at ? formatDateTime(run.finished_at) : "in progress";
    return `#${run.id} · ${run.status} · ${finished}`;
}

function formatOperationFlash(operation: SearchIndexMaintenanceOperation): string {
    const parts = [
        `${maintenanceOperationStatusLabel(operation.status)}`,
        `${operation.duration_ms.toLocaleString()} ms`,
    ];
    if (operation.rows_rebuilt > 0) {
        parts.push(`${operation.rows_rebuilt.toLocaleString()} rows rebuilt`);
    }
    if (operation.rebuild_run_id) {
        parts.push(`run #${operation.rebuild_run_id}`);
    }
    if (operation.message) {
        parts.push(operation.message);
    }
    return parts.join(" · ");
}

function SearchIndexHealthSkeleton() {
    return (
        <div className="space-y-5">
            <p className="text-sm text-gray-600">Checking search index health...</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, index) => (
                    <div
                        key={index}
                        className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                    >
                        <div className="h-3 w-24 animate-pulse rounded bg-gray-100" />
                        <div className="mt-3 h-7 w-20 animate-pulse rounded bg-gray-200" />
                    </div>
                ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                        <tr>
                            {Array.from({ length: 9 }).map((_, index) => (
                                <th key={index} className="px-4 py-3">
                                    <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {Array.from({ length: HEALTH_FAMILY_SKELETON_ROWS }).map((_, rowIndex) => (
                            <tr key={rowIndex}>
                                {Array.from({ length: 9 }).map((__, cellIndex) => (
                                    <td key={cellIndex} className="px-4 py-3">
                                        <div className="h-4 animate-pulse rounded bg-gray-100" />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function SearchIndexHealthPage() {
    const [data, setData] = useState<SearchIndexHealthReport | null>(null);
    const [phase, setPhase] = useState<SearchIndexHealthLoadPhase>("initial");
    const dataRef = useRef<SearchIndexHealthReport | null>(null);
    const [error, setError] = useState("");
    const [actionError, setActionError] = useState("");
    const [flash, setFlash] = useState("");
    const [runningAction, setRunningAction] = useState(false);
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
    const [entityType, setEntityType] = useState("place");
    const [entityId, setEntityId] = useState("");

    const canMaintain = canMaintainSearchIndex();
    const isRefreshing = phase === "refreshing";
    const showSkeleton = shouldShowSearchIndexHealthSkeleton(phase, data != null);
    const showContent = shouldShowSearchIndexHealthContent(phase, data != null);

    const load = useCallback(async (options?: { refresh?: boolean; signal?: AbortSignal }) => {
        const isRefresh = options?.refresh ?? false;
        const hasData = dataRef.current != null;
        setPhase(phaseAtSearchIndexHealthLoadStart(hasData, isRefresh));
        setError("");
        try {
            const res = await getSearchIndexHealth({
                signal: options?.signal,
                refresh: isRefresh,
            });
            dataRef.current = res;
            setData(res);
            setPhase("loaded");
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load search index health.");
            setPhase(
                resolveSearchIndexHealthLoadPhase({
                    hasData: dataRef.current != null,
                    isRefresh,
                    success: false,
                }),
            );
            if (!isRefresh) {
                dataRef.current = null;
                setData(null);
            }
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load({ signal: controller.signal });
        return () => controller.abort();
    }, [load]);

    const applyOperationResult = useCallback((operation: SearchIndexMaintenanceOperation) => {
        dataRef.current = operation.health_after;
        setData(operation.health_after);
        setPhase("loaded");
        setFlash(formatOperationFlash(operation));
        setActionError("");
    }, []);

    const runHealthCheck = useCallback(async () => {
        setRunningAction(true);
        setActionError("");
        setFlash("");
        try {
            const result = await runSearchIndexHealthCheck();
            applyOperationResult(result);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Health check failed.");
        } finally {
            setRunningAction(false);
        }
    }, [applyOperationResult]);

    const executePendingAction = useCallback(async () => {
        if (!pendingAction) return;
        setRunningAction(true);
        setActionError("");
        setFlash("");
        try {
            let result: SearchIndexMaintenanceOperation;
            if (pendingAction.kind === "repair") {
                result = await repairSearchIndexHealth();
            } else if (pendingAction.kind === "reindex_family") {
                result = await reindexSearchFamily({ entity_family: pendingAction.entity_family });
            } else {
                result = await reindexSearchEntity({
                    entity_type: pendingAction.entity_type,
                    entity_id: pendingAction.entity_id,
                });
            }
            applyOperationResult(result);
            setPendingAction(null);
        } catch (err) {
            setActionError(err instanceof Error ? err.message : "Maintenance action failed.");
        } finally {
            setRunningAction(false);
        }
    }, [applyOperationResult, pendingAction]);

    const requestEntityReindex = useCallback(() => {
        const trimmedId = entityId.trim();
        if (!trimmedId) {
            setActionError("Entity id is required.");
            return;
        }
        setActionError("");
        setPendingAction({
            kind: "reindex_entity",
            entity_type: entityType,
            entity_id: trimmedId,
        });
    }, [entityId, entityType]);

    const totals = data?.totals;
    const hasUnhealthyFamilies = (data?.families ?? []).some((row) => row.severity !== "healthy");

    const pendingDialogCopy =
        pendingAction?.kind === "repair"
            ? {
                  title: "Repair unhealthy families",
                  description:
                      "Rebuilds only families with missing, ghost, or stale rows. This uses the same targeted repair logic as the reconcile CLI.",
                  confirmLabel: "Repair unhealthy families",
              }
            : pendingAction?.kind === "reindex_family"
              ? {
                    title: `Reindex ${indexFamilyLabel(pendingAction.entity_family)}`,
                    description: `Rebuilds the mapped source view for ${indexFamilyLabel(pendingAction.entity_family)} via search.rebuild_search_documents.`,
                    confirmLabel: "Reindex family",
                }
              : pendingAction?.kind === "reindex_entity"
                ? {
                      title: `Reindex ${entityTypeLabel(pendingAction.entity_type)} #${pendingAction.entity_id}`,
                      description:
                          "Rebuilds the search document for one entity. Use family reindex for addresses, buildings, landuse, and water.",
                      confirmLabel: "Reindex entity",
                  }
                : null;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <header className="flex flex-wrap items-end justify-between gap-4 border-b border-gray-200 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Search index health</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Canonical source rows vs indexed search documents. Uses the same health
                            check as the reconcile CLI.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={SECONDARY_BTN}
                            disabled={phase === "initial" || isRefreshing || runningAction}
                            onClick={() => void load({ refresh: true })}
                        >
                            {isRefreshing ? "Refreshing…" : "Refresh"}
                        </button>
                        <button
                            type="button"
                            className={SECONDARY_BTN}
                            disabled={phase === "initial" || isRefreshing || runningAction}
                            onClick={() => void runHealthCheck()}
                        >
                            {runningAction ? "Running…" : "Run health check"}
                        </button>
                        {canMaintain && hasUnhealthyFamilies ? (
                            <button
                                type="button"
                                className={PRIMARY_BTN}
                                disabled={phase === "initial" || isRefreshing || runningAction}
                                onClick={() => setPendingAction({ kind: "repair" })}
                            >
                                Repair unhealthy
                            </button>
                        ) : null}
                        <Link href={searchPath("documents")} className={SECONDARY_BTN}>
                            Browse documents
                        </Link>
                    </div>
                </header>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        <p>{error}</p>
                        <button
                            type="button"
                            className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
                            onClick={() => void load({ refresh: data != null })}
                        >
                            Retry
                        </button>
                    </div>
                ) : null}

                {actionError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {actionError}
                    </div>
                ) : null}

                {flash ? (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                        {flash}
                    </div>
                ) : null}

                {showSkeleton ? <SearchIndexHealthSkeleton /> : null}

                {showContent && data ? (
                    <>
                        <div className="flex flex-wrap items-center gap-3">
                            {isRefreshing ? (
                                <span className="text-sm text-gray-500">Refreshing health data…</span>
                            ) : null}
                            <SyncStateBadge
                                state={indexHealthSeverityBadgeState(data.overall_severity)}
                                label={indexHealthSeverityLabel(data.overall_severity)}
                            />
                            {data.last_successful_run ? (
                                <span className="text-sm text-gray-600">
                                    Last successful rebuild:{" "}
                                    {formatDateTime(data.last_successful_run.finished_at)}
                                </span>
                            ) : null}
                            {!data.health_query_ok ? (
                                <span className="text-sm text-red-700">
                                    Health query failed: {data.health_query_error ?? "unknown error"}
                                </span>
                            ) : null}
                            {!canMaintain ? (
                                <span className="text-xs text-gray-500">
                                    Family repair and reindex actions require super_admin.
                                </span>
                            ) : null}
                        </div>

                        {data.overall_severity_reasons.length > 0 ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                                <p className="font-medium">Overall severity notes</p>
                                <ul className="mt-1 list-disc pl-5">
                                    {data.overall_severity_reasons.map((reason) => (
                                        <li key={reason}>{reason}</li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}

                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
                            <StatsCard
                                title="Overall severity"
                                value={indexHealthSeverityLabel(data.overall_severity)}
                                statusColor={
                                    data.overall_severity === "healthy"
                                        ? "success"
                                        : data.overall_severity === "warning"
                                          ? "warning"
                                          : "danger"
                                }
                            />
                            <StatsCard
                                title="Indexed documents"
                                value={totals?.indexed_count.toLocaleString() ?? "—"}
                            />
                            <StatsCard
                                title="Missing"
                                value={totals?.missing_count.toLocaleString() ?? "—"}
                                statusColor={
                                    (totals?.missing_count ?? 0) > 0 ? "danger" : "default"
                                }
                            />
                            <StatsCard
                                title="Ghost"
                                value={totals?.ghost_count.toLocaleString() ?? "—"}
                                statusColor={(totals?.ghost_count ?? 0) > 0 ? "warning" : "default"}
                            />
                            <StatsCard
                                title="Stale"
                                value={totals?.stale_count.toLocaleString() ?? "—"}
                                statusColor={(totals?.stale_count ?? 0) > 0 ? "warning" : "default"}
                            />
                            <StatsCard
                                title="Last rebuild"
                                value={data.last_rebuild_run?.status ?? "—"}
                                description={formatRunLabel(data.last_rebuild_run)}
                            />
                        </div>

                        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="px-4 py-3">Family</th>
                                        <th className="px-4 py-3">Entity type</th>
                                        <th className="px-4 py-3">Expected</th>
                                        <th className="px-4 py-3">Indexed</th>
                                        <th className="px-4 py-3">Missing</th>
                                        <th className="px-4 py-3">Ghost</th>
                                        <th className="px-4 py-3">Stale</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Severity notes</th>
                                        <th className="px-4 py-3">Last indexed</th>
                                        {canMaintain ? <th className="px-4 py-3">Actions</th> : null}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 bg-white">
                                    {data.families.map((row) => (
                                        <tr key={row.entity_family} className="hover:bg-gray-50">
                                            <td className="px-4 py-3 font-medium text-gray-900">
                                                {indexFamilyLabel(row.entity_family)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-700">
                                                {entityTypeLabel(row.search_entity_type)}
                                            </td>
                                            <td className="px-4 py-3 text-gray-800">
                                                {row.canonical_count.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-gray-800">
                                                {row.indexed_count.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-gray-800">
                                                {row.missing_count.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-gray-800">
                                                {row.ghost_count.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-gray-800">
                                                {row.stale_count.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                <SyncStateBadge
                                                    state={indexHealthSeverityBadgeState(row.severity)}
                                                    label={indexHealthSeverityLabel(row.severity)}
                                                />
                                            </td>
                                            <td className="px-4 py-3 text-xs break-words text-gray-600 [overflow-wrap:anywhere]">
                                                {row.severity_reasons.length > 0
                                                    ? row.severity_reasons.join("; ")
                                                    : "—"}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600">
                                                {formatDateTime(row.latest_indexed_at)}
                                            </td>
                                            {canMaintain ? (
                                                <td className="px-4 py-3">
                                                    <button
                                                        type="button"
                                                        className="text-xs font-medium text-blue-700 hover:text-blue-900 disabled:opacity-50"
                                                        disabled={runningAction}
                                                        onClick={() =>
                                                            setPendingAction({
                                                                kind: "reindex_family",
                                                                entity_family: row.entity_family,
                                                            })
                                                        }
                                                    >
                                                        Reindex family
                                                    </button>
                                                </td>
                                            ) : null}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {canMaintain ? (
                            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                <h2 className="text-sm font-semibold text-gray-900">
                                    Incremental entity reindex
                                </h2>
                                <p className="mt-1 text-xs text-gray-600">
                                    For supported entity types only (places, admin areas, street
                                    groups, transport). Addresses, buildings, landuse, and water use
                                    family rebuild instead.
                                </p>
                                <div className="mt-3 flex flex-wrap items-end gap-3">
                                    <label className="block space-y-1 text-sm">
                                        <span className="text-gray-700">Entity type</span>
                                        <select
                                            value={entityType}
                                            onChange={(e) => setEntityType(e.target.value)}
                                            className={SELECT_CLASS}
                                        >
                                            {[
                                                "place",
                                                "admin_area",
                                                "street_group",
                                                "transport_stop",
                                                "transport_terminal",
                                                "transport_route",
                                                "transport_route_variant",
                                            ].map((type) => (
                                                <option key={type} value={type}>
                                                    {entityTypeLabel(type)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block space-y-1 text-sm">
                                        <span className="text-gray-700">Internal entity id</span>
                                        <input
                                            value={entityId}
                                            onChange={(e) => setEntityId(e.target.value)}
                                            placeholder="e.g. 12345"
                                            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        className={PRIMARY_BTN}
                                        disabled={runningAction}
                                        onClick={() => void requestEntityReindex()}
                                    >
                                        Reindex entity
                                    </button>
                                </div>
                            </div>
                        ) : null}

                        <p className="text-xs text-gray-500">
                            Expected = intended searchable rows from source views (not raw table
                            counts). Severity uses missing/stale drift vs expected searchable rows,
                            ghost rows, rebuild age, and health query status.
                        </p>
                    </>
                ) : null}
            </div>

            {pendingDialogCopy ? (
                <SearchIndexMaintenanceConfirmDialog
                    title={pendingDialogCopy.title}
                    description={pendingDialogCopy.description}
                    confirmLabel={pendingDialogCopy.confirmLabel}
                    saving={runningAction}
                    error={actionError}
                    onClose={() => {
                        if (!runningAction) {
                            setPendingAction(null);
                            setActionError("");
                        }
                    }}
                    onConfirm={() => void executePendingAction()}
                />
            ) : null}
        </main>
    );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { transportPath } from "@/src/lib/dashboardNavigation";
import { getTransportStopRouteUsageDetail, mapStopRouteUsageDetailItemToRouteUsage, removeTransportRouteStop } from "./api";
import { formatReviewMapStopActionError } from "./reviewMapActionFeedback";
import { formatRouteUsageDirectionBreakdown, formatRouteUsageSummary } from "./routeUsageSummaryDisplay";
import type { TransportRouteStopMutationResult, TransportStopRouteUsage, TransportStopRouteUsageSummary } from "./types";

const ROUTES_PAGE_SIZE = 25;

const BTN_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";

const DELETE_BLOCKED_MESSAGE =
    "Disconnect this stop from all routes before permanent deletion.";

export type TransportStopUsageDialogMode = "usage" | "delete";

export type TransportStopUsageDialogProps = {
    readonly open: boolean;
    readonly stopPublicId: string | null;
    readonly stopName: string;
    readonly mode?: TransportStopUsageDialogMode;
    readonly onClose: () => void;
    /** Variant currently open in review map — ordered stops refresh when disconnected. */
    readonly activeVariantPublicId?: string | null;
    /** Called after a successful disconnect with the mutation response. */
    readonly onDisconnected?: (result: TransportRouteStopMutationResult) => void;
    /** Called when a disconnect on another route changes usage (eligibility refresh). */
    readonly onRouteUsageChanged?: () => void;
    /** User chose permanent delete while usage is empty. */
    readonly onPermanentDeleteRequest?: () => void;
    readonly permanentDeleteLoading?: boolean;
    /** Backend eligibility message when delete is blocked for non-route reasons. */
    readonly deleteBlockMessage?: string | null;
    readonly deleteAllowed?: boolean;
    readonly canWrite: boolean;
};

function variantLabel(route: TransportStopRouteUsage): string {
    const parts = [route.variant_code];
    if (route.direction_name) {
        parts.push(route.direction_name);
    } else if (route.headsign) {
        parts.push(route.headsign);
    }
    return parts.join(" · ");
}

/**
 * Lists every route variant that references a stop and supports disconnecting
 * memberships before permanent deletion. Mode-agnostic for all transport modes.
 */
export default function TransportStopUsageDialog({
    open,
    stopPublicId,
    stopName,
    mode = "usage",
    onClose,
    activeVariantPublicId = null,
    onDisconnected,
    onRouteUsageChanged,
    onPermanentDeleteRequest,
    permanentDeleteLoading = false,
    deleteBlockMessage = null,
    deleteAllowed: deleteAllowedProp,
    canWrite,
}: TransportStopUsageDialogProps) {
    const titleId = useId();
    const [routes, setRoutes] = useState<readonly TransportStopRouteUsage[]>([]);
    const [routesTotal, setRoutesTotal] = useState(0);
    const [usageSummary, setUsageSummary] = useState<TransportStopRouteUsageSummary | null>(null);
    const [routesPage, setRoutesPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reloadNonce, setReloadNonce] = useState(0);
    const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
    const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(null);
    const [actionMessage, setActionMessage] = useState<string | null>(null);

    const loadRoutes = useCallback(async () => {
        if (!stopPublicId) {
            return;
        }
        setLoading(true);
        setError("");
        try {
            const result = await getTransportStopRouteUsageDetail(stopPublicId);
            const mapped = result.items.map((item) => mapStopRouteUsageDetailItemToRouteUsage(item));
            setRoutes(mapped);
            setRoutesTotal(mapped.length);
            setUsageSummary(result.summary);
        } catch (err) {
            if (isAbortError(err)) {
                return;
            }
            setRoutes([]);
            setRoutesTotal(0);
            setUsageSummary(null);
            setError(formatReviewMapStopActionError(err));
        } finally {
            setLoading(false);
        }
    }, [stopPublicId]);

    useEffect(() => {
        if (!open || !stopPublicId) {
            setRoutes([]);
            setRoutesTotal(0);
            setUsageSummary(null);
            setRoutesPage(1);
            setLoading(false);
            setError("");
            setDisconnectingId(null);
            setConfirmDisconnectId(null);
            setActionMessage(null);
            return;
        }
        void loadRoutes();
    }, [open, stopPublicId, reloadNonce, loadRoutes]);

    const visibleRoutes = useMemo(() => {
        const start = (routesPage - 1) * ROUTES_PAGE_SIZE;
        return routes.slice(start, start + ROUTES_PAGE_SIZE);
    }, [routes, routesPage]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !disconnectingId && !permanentDeleteLoading) {
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, disconnectingId, permanentDeleteLoading, onClose]);

    const refreshUsage = useCallback(() => {
        setReloadNonce((value) => value + 1);
    }, []);

    const handleDisconnect = useCallback(
        async (route: TransportStopRouteUsage) => {
            setDisconnectingId(route.route_stop_id);
            setActionMessage(null);
            setError("");
            try {
                const result = await removeTransportRouteStop(route.route_stop_id);
                setConfirmDisconnectId(null);

                if (
                    activeVariantPublicId &&
                    result.variant_public_id === activeVariantPublicId
                ) {
                    onDisconnected?.(result);
                } else {
                    onRouteUsageChanged?.();
                }

                setActionMessage("Stop disconnected from route");
                refreshUsage();
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                setError(formatReviewMapStopActionError(err));
            } finally {
                setDisconnectingId(null);
            }
        },
        [
            activeVariantPublicId,
            onDisconnected,
            onRouteUsageChanged,
            refreshUsage,
        ],
    );

    if (!open || !stopPublicId) {
        return null;
    }

    const totalPages = Math.max(1, Math.ceil(routesTotal / ROUTES_PAGE_SIZE));
    const deleteAllowedByRoutes = routesTotal === 0 && !loading;
    const deleteAllowed =
        deleteAllowedProp !== undefined
            ? deleteAllowedProp && deleteAllowedByRoutes
            : deleteAllowedByRoutes;
    const showDeleteSection = mode === "delete";

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
            role="presentation"
            onClick={() => {
                if (!disconnectingId && !permanentDeleteLoading) {
                    onClose();
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-100 px-5 py-4">
                    <h2 id={titleId} className="text-lg font-semibold text-slate-900">
                        {showDeleteSection ? "Delete stop" : "Routes using this stop"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                        {stopName ? `"${stopName}"` : "This stop"}
                        {usageSummary && !loading ? (
                            <>
                                {" "}
                                · {formatRouteUsageSummary(usageSummary)}
                            </>
                        ) : (
                            <>
                                {" "}
                                · Routes using this stop:{" "}
                                <span className="font-medium tabular-nums text-slate-900">
                                    {loading ? "…" : routesTotal}
                                </span>
                            </>
                        )}
                    </p>
                    {usageSummary && !loading ? (
                        <p className="mt-1 text-xs text-slate-500">
                            {formatRouteUsageDirectionBreakdown(usageSummary) ??
                                "No inbound/outbound/loop direction tags"}
                        </p>
                    ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    {actionMessage ? (
                        <p className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                            {actionMessage}
                        </p>
                    ) : null}
                    {error ? (
                        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {error}
                        </div>
                    ) : null}

                    {loading ? (
                        <div className="space-y-2">
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />
                            ))}
                        </div>
                    ) : routes.length === 0 ? (
                        <p className="py-6 text-center text-sm text-gray-500">
                            No routes currently use this stop.
                        </p>
                    ) : (
                        <ul className="divide-y divide-gray-100 rounded-md border border-gray-100">
                            {visibleRoutes.map((route) => {
                                const busy = disconnectingId === route.route_stop_id;
                                const confirming = confirmDisconnectId === route.route_stop_id;
                                return (
                                    <li
                                        key={route.route_stop_id}
                                        className="px-3 py-2.5"
                                    >
                                        <div className="flex items-start gap-2">
                                            <span className="mt-0.5 inline-flex h-5 flex-none items-center justify-center rounded bg-gray-900 px-1.5 text-[10px] font-semibold text-white">
                                                {route.route_code}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium text-gray-900">
                                                    {route.route_name}
                                                </p>
                                                <p className="truncate text-xs text-gray-500">
                                                    {variantLabel(route)} · seq {route.stop_sequence}
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                                <Link
                                                    href={`${transportPath("routes")}?route=${route.route_public_id}`}
                                                    className={BTN_CLASS}
                                                >
                                                    Open route
                                                </Link>
                                                {confirming ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            disabled={!canWrite || busy}
                                                            title={!canWrite ? "Read-only viewers cannot disconnect stops" : undefined}
                                                            onClick={() =>
                                                                void handleDisconnect(route)
                                                            }
                                                            className={BTN_CLASS}
                                                        >
                                                            {busy ? "Disconnecting…" : "Confirm"}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() =>
                                                                setConfirmDisconnectId(null)
                                                            }
                                                            className={BTN_CLASS}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        disabled={!canWrite || Boolean(disconnectingId)}
                                                        title={!canWrite ? "Read-only viewers cannot disconnect stops" : undefined}
                                                        onClick={() =>
                                                            setConfirmDisconnectId(
                                                                route.route_stop_id,
                                                            )
                                                        }
                                                        className={BTN_CLASS}
                                                    >
                                                        Disconnect
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {routesTotal > ROUTES_PAGE_SIZE ? (
                    <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-3 text-sm text-gray-600">
                        <button
                            type="button"
                            disabled={loading || routesPage <= 1}
                            onClick={() => setRoutesPage((page) => Math.max(1, page - 1))}
                            className={BTN_CLASS}
                        >
                            Previous
                        </button>
                        <span className="text-xs tabular-nums">
                            Page {routesPage} of {totalPages}
                        </span>
                        <button
                            type="button"
                            disabled={loading || routesPage >= totalPages}
                            onClick={() => setRoutesPage((page) => Math.min(totalPages, page + 1))}
                            className={BTN_CLASS}
                        >
                            Next
                        </button>
                    </div>
                ) : null}

                {showDeleteSection ? (
                    <div className="border-t border-slate-100 px-5 py-4">
                        {!deleteAllowed ? (
                            <p className="text-sm text-amber-900">
                                {routesTotal > 0
                                    ? DELETE_BLOCKED_MESSAGE
                                    : (deleteBlockMessage ?? DELETE_BLOCKED_MESSAGE)}
                            </p>
                        ) : (
                            <p className="text-sm text-emerald-800">
                                This stop is not used on any routes. You can delete it permanently.
                            </p>
                        )}
                        <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button
                                type="button"
                                disabled={disconnectingId !== null || permanentDeleteLoading}
                                onClick={onClose}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                disabled={!canWrite || !deleteAllowed || permanentDeleteLoading}
                                title={!canWrite ? "Read-only viewers cannot delete stops" : undefined}
                                onClick={onPermanentDeleteRequest}
                                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                {permanentDeleteLoading ? "Deleting…" : "Permanent delete"}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="flex justify-end border-t border-slate-100 px-5 py-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export { DELETE_BLOCKED_MESSAGE };

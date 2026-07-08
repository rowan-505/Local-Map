"use client";

import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import {
    applyTransportRouteReviewAction,
    getTransportRouteReviewReadiness,
} from "./api";
import { transportReviewStatusLabel } from "./constants";
import { TransportReviewActionBar } from "./transportReviewUi";
import type {
    RouteReviewReadiness,
    TransportReviewAction,
    TransportRouteDetail,
    TransportRoutePath,
} from "./types";

function pathGeomSource(path: TransportRoutePath | null | undefined): string | null {
    if (!path?.normalized_data || typeof path.normalized_data !== "object") {
        return null;
    }
    const raw = path.normalized_data.geom_source;
    return typeof raw === "string" && raw.trim() ? raw : null;
}

export default function TransportRouteReviewPanel({
    route,
    path,
    onRouteUpdated,
    readiness: readinessProp,
    readinessLoading: readinessLoadingProp,
    readinessError: readinessErrorProp,
    onReadinessReload,
}: {
    readonly route: TransportRouteDetail;
    readonly path: TransportRoutePath | null;
    readonly onRouteUpdated: (updated: TransportRouteDetail) => void;
    /** When provided, the panel reuses parent-loaded readiness instead of fetching again. */
    readonly readiness?: RouteReviewReadiness | null;
    readonly readinessLoading?: boolean;
    readonly readinessError?: string;
    readonly onReadinessReload?: () => Promise<void>;
}) {
    const [localReadiness, setLocalReadiness] = useState<RouteReviewReadiness | null>(null);
    const [localLoading, setLocalLoading] = useState(true);
    const [localLoadError, setLocalLoadError] = useState("");

    const usesExternalReadiness = readinessProp !== undefined;

    const loadReadiness = useCallback(async (signal?: AbortSignal) => {
        if (usesExternalReadiness) {
            return;
        }
        setLocalLoading(true);
        setLocalLoadError("");
        try {
            const result = await getTransportRouteReviewReadiness(route.public_id, { signal });
            setLocalReadiness(result);
        } catch (err) {
            if (isAbortError(err)) return;
            setLocalLoadError(err instanceof Error ? err.message : "Failed to load review readiness.");
        } finally {
            setLocalLoading(false);
        }
    }, [route.public_id, usesExternalReadiness]);

    useEffect(() => {
        if (usesExternalReadiness) {
            return;
        }
        const controller = new AbortController();
        void loadReadiness(controller.signal);
        return () => controller.abort();
    }, [loadReadiness, usesExternalReadiness]);

    const readiness = usesExternalReadiness ? readinessProp : localReadiness;
    const loading = usesExternalReadiness ? (readinessLoadingProp ?? false) : localLoading;
    const loadError = usesExternalReadiness ? (readinessErrorProp ?? "") : localLoadError;

    const reloadReadiness = useCallback(async () => {
        if (onReadinessReload) {
            await onReadinessReload();
            return;
        }
        await loadReadiness();
    }, [onReadinessReload, loadReadiness]);

    const handleAction = useCallback(
        async (action: TransportReviewAction) => {
            try {
                const result = await applyTransportRouteReviewAction(route.public_id, action);
                onRouteUpdated({ ...route, review_status: result.review_status });
                await reloadReadiness();
            } catch (err) {
                if (action === "mark_verified" && !isAbortError(err)) {
                    const fresh = await getTransportRouteReviewReadiness(route.public_id);
                    if (usesExternalReadiness) {
                        await onReadinessReload?.();
                    } else {
                        setLocalReadiness(fresh);
                    }
                    return { blockers: fresh.blockers };
                }
                if (action === "mark_reviewed" && !isAbortError(err)) {
                    const fresh = await getTransportRouteReviewReadiness(route.public_id);
                    if (usesExternalReadiness) {
                        await onReadinessReload?.();
                    } else {
                        setLocalReadiness(fresh);
                    }
                    return { blockers: fresh.mark_reviewed_blockers };
                }
                throw err;
            }
        },
        [route, onRouteUpdated, reloadReadiness]
    );

    const geomSource = pathGeomSource(path);

    return (
        <section className="mt-4 border-t border-gray-100 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Review workflow
            </h3>

            <div className="mb-3 space-y-1 text-sm">
                <div className="flex justify-between gap-3">
                    <span className="text-gray-500">Review status</span>
                    <span className="font-medium text-gray-900">
                        {transportReviewStatusLabel(route.review_status)}
                    </span>
                </div>
                {path ? (
                    <>
                        <div className="flex justify-between gap-3">
                            <span className="text-gray-500">Path kind</span>
                            <span className="font-medium text-gray-900">{path.path_kind}</span>
                        </div>
                        {geomSource ? (
                            <div className="flex justify-between gap-3">
                                <span className="text-gray-500">Geom source</span>
                                <span className="font-medium text-gray-900">{geomSource}</span>
                            </div>
                        ) : null}
                    </>
                ) : (
                    <p className="text-xs text-gray-500">No active route path for the selected variant.</p>
                )}
            </div>

            {loading ? (
                <p className="text-xs text-gray-500">Loading readiness…</p>
            ) : loadError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                    {loadError}
                </p>
            ) : (
                <>
                    {readiness && readiness.warnings.length > 0 ? (
                        <ul className="mb-2 list-inside list-disc text-xs text-gray-600">
                            {readiness.warnings.map((w) => (
                                <li key={w}>{w}</li>
                            ))}
                        </ul>
                    ) : null}
                    <TransportReviewActionBar
                        currentStatus={route.review_status}
                        blockers={readiness?.blockers ?? []}
                        markReviewedBlockers={readiness?.mark_reviewed_blockers ?? []}
                        onAction={handleAction}
                    />
                </>
            )}
        </section>
    );
}

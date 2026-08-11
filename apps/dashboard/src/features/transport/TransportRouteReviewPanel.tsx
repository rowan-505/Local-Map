"use client";

import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import {
    applyTransportRouteReviewAction,
    getTransportRouteReviewReadiness,
} from "./api";
import { AdvancedToolSection, ReadinessUnavailableNotice } from "./TransportRouteDetailCards";
import { logTransportReadinessFetchError } from "./transportFetchErrors";
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
    readinessUnavailable: readinessUnavailableProp,
    onReadinessReload,
    onReadinessApplied,
}: {
    readonly route: TransportRouteDetail;
    readonly path: TransportRoutePath | null;
    readonly onRouteUpdated: (updated: TransportRouteDetail) => void;
    /** When provided, the panel reuses parent-loaded readiness instead of fetching again. */
    readonly readiness?: RouteReviewReadiness | null;
    readonly readinessLoading?: boolean;
    readonly readinessUnavailable?: boolean;
    readonly onReadinessReload?: () => Promise<void>;
    /** Apply readiness from a mutation response without a second GET. */
    readonly onReadinessApplied?: (readiness: RouteReviewReadiness) => void;
}) {
    const [localReadiness, setLocalReadiness] = useState<RouteReviewReadiness | null>(null);
    const [localLoading, setLocalLoading] = useState(true);
    const [localUnavailable, setLocalUnavailable] = useState(false);

    const usesExternalReadiness = readinessProp !== undefined;

    const loadReadiness = useCallback(async (signal?: AbortSignal) => {
        if (usesExternalReadiness) {
            return;
        }
        setLocalLoading(true);
        setLocalUnavailable(false);
        try {
            const result = await getTransportRouteReviewReadiness(route.public_id, { signal });
            setLocalReadiness(result);
        } catch (err) {
            if (isAbortError(err)) return;
            logTransportReadinessFetchError(err, "Failed to load review readiness.");
            setLocalReadiness(null);
            setLocalUnavailable(true);
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
    const unavailable = usesExternalReadiness
        ? (readinessUnavailableProp ?? false)
        : localUnavailable;

    const reloadReadiness = useCallback(async () => {
        if (onReadinessReload) {
            await onReadinessReload();
            return;
        }
        await loadReadiness();
    }, [onReadinessReload, loadReadiness]);

    const applyReadiness = useCallback(
        (next: RouteReviewReadiness) => {
            if (usesExternalReadiness) {
                onReadinessApplied?.(next);
            } else {
                setLocalReadiness(next);
            }
        },
        [usesExternalReadiness, onReadinessApplied],
    );

    const handleAction = useCallback(
        async (action: TransportReviewAction) => {
            try {
                const result = await applyTransportRouteReviewAction(route.public_id, action);
                onRouteUpdated({ ...route, review_status: result.review_status });
                if (result.readiness) {
                    applyReadiness(result.readiness);
                } else {
                    await reloadReadiness();
                }
            } catch (err) {
                if (action === "mark_verified" && !isAbortError(err)) {
                    const fresh = await getTransportRouteReviewReadiness(route.public_id);
                    applyReadiness(fresh);
                    if (usesExternalReadiness && !onReadinessApplied) {
                        await onReadinessReload?.();
                    }
                    return { blockers: fresh.blockers };
                }
                if (action === "mark_reviewed" && !isAbortError(err)) {
                    const fresh = await getTransportRouteReviewReadiness(route.public_id);
                    applyReadiness(fresh);
                    if (usesExternalReadiness && !onReadinessApplied) {
                        await onReadinessReload?.();
                    }
                    return { blockers: fresh.mark_reviewed_blockers };
                }
                throw err;
            }
        },
        [
            route,
            onRouteUpdated,
            reloadReadiness,
            applyReadiness,
            usesExternalReadiness,
            onReadinessApplied,
            onReadinessReload,
        ],
    );

    const geomSource = pathGeomSource(path);

    return (
        <AdvancedToolSection
            accent="slate"
            title="Review workflow"
            description="Change review status when the route and selected variant are ready."
        >
            <dl className="mb-3 space-y-2 text-sm">
                {path ? (
                    <>
                        <div className="flex justify-between gap-3 rounded-lg bg-slate-50/80 px-2.5 py-1.5">
                            <dt className="text-slate-500">Path kind</dt>
                            <dd className="font-medium text-slate-900">{path.path_kind}</dd>
                        </div>
                        {geomSource ? (
                            <div className="flex justify-between gap-3 rounded-lg bg-slate-50/80 px-2.5 py-1.5">
                                <dt className="text-slate-500">Geom source</dt>
                                <dd className="font-medium text-slate-900">{geomSource}</dd>
                            </div>
                        ) : null}
                    </>
                ) : (
                    <p className="text-xs text-slate-500">
                        No active route path for the selected variant.
                    </p>
                )}
            </dl>

            {loading && !unavailable ? (
                <div className="mb-3 h-8 animate-pulse rounded-lg bg-slate-100" />
            ) : null}

            {unavailable ? (
                <div className="mb-3">
                    <ReadinessUnavailableNotice
                        onRetry={() => void reloadReadiness()}
                        retrying={loading}
                    />
                </div>
            ) : null}

            {!unavailable && readiness && readiness.warnings.length > 0 ? (
                <ul className="mb-3 space-y-1">
                    {readiness.warnings.map((w) => (
                        <li
                            key={w}
                            className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600"
                        >
                            {w}
                        </li>
                    ))}
                </ul>
            ) : null}
            <TransportReviewActionBar
                currentStatus={route.review_status}
                blockers={readiness?.blockers ?? []}
                markReviewedBlockers={readiness?.mark_reviewed_blockers ?? []}
                onAction={handleAction}
            />
        </AdvancedToolSection>
    );
}

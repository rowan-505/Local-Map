"use client";

import { useCallback, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import type {
    DuplicateStatus,
    PublicVisibility,
    RouteGeometryStatus,
    StopGeometryStatus,
    TransportReviewAction,
} from "./types";

const BADGE_BASE = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1";

const ROUTE_GEOMETRY_LABELS: Record<RouteGeometryStatus, string> = {
    no_path: "No path",
    estimate: "Est. path",
    manual: "Manual path",
    verified: "Verified path",
};

const STOP_GEOMETRY_LABELS: Record<StopGeometryStatus, string> = {
    missing: "No location",
    estimate: "Est. location",
    manual: "Manual location",
    verified: "Verified location",
};

function routeGeometryBadgeClass(status: RouteGeometryStatus): string {
    switch (status) {
        case "verified":
            return `${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`;
        case "manual":
            return `${BADGE_BASE} bg-blue-50 text-blue-800 ring-blue-100`;
        case "estimate":
            return `${BADGE_BASE} bg-amber-50 text-amber-900 ring-amber-100`;
        case "no_path":
        default:
            return `${BADGE_BASE} bg-gray-100 text-gray-700 ring-gray-200`;
    }
}

function stopGeometryBadgeClass(status: StopGeometryStatus): string {
    switch (status) {
        case "verified":
            return `${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`;
        case "manual":
            return `${BADGE_BASE} bg-blue-50 text-blue-800 ring-blue-100`;
        case "estimate":
            return `${BADGE_BASE} bg-amber-50 text-amber-900 ring-amber-100`;
        case "missing":
        default:
            return `${BADGE_BASE} bg-red-50 text-red-800 ring-red-100`;
    }
}

export function GeometryBadge(
    props:
        | { readonly kind: "route"; readonly status: RouteGeometryStatus }
        | { readonly kind: "stop"; readonly status: StopGeometryStatus }
) {
    if (props.kind === "route") {
        return (
            <span className={routeGeometryBadgeClass(props.status)} title="Route geometry">
                {ROUTE_GEOMETRY_LABELS[props.status]}
            </span>
        );
    }
    return (
        <span className={stopGeometryBadgeClass(props.status)} title="Stop geometry">
            {STOP_GEOMETRY_LABELS[props.status]}
        </span>
    );
}

export function SourceBadge({ hasSourceLink }: { readonly hasSourceLink: boolean }) {
    return hasSourceLink ? (
        <span className={`${BADGE_BASE} bg-indigo-50 text-indigo-800 ring-indigo-100`} title="Source link">
            Source
        </span>
    ) : (
        <span className={`${BADGE_BASE} bg-gray-100 text-gray-600 ring-gray-200`} title="No source link">
            No source
        </span>
    );
}

export function PublicVisibilityBadge({ visibility }: { readonly visibility: PublicVisibility }) {
    return visibility === "visible" ? (
        <span className={`${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`} title="Public visibility">
            Visible
        </span>
    ) : (
        <span className={`${BADGE_BASE} bg-gray-100 text-gray-600 ring-gray-200`} title="Public visibility">
            Hidden
        </span>
    );
}

/** Dashboard route detail — how this route would appear on public map/API. */
export function PublicPreviewBadge({
    reviewStatus,
    isActive,
    deletedAt,
}: {
    readonly reviewStatus: string;
    readonly isActive: boolean;
    readonly deletedAt?: string | null;
}) {
    let label = "Hidden";
    let detail = "";
    let className = `${BADGE_BASE} bg-gray-100 text-gray-600 ring-gray-200`;

    if (deletedAt || !isActive) {
        label = "Hidden: inactive";
        detail = deletedAt ? "Route is deleted." : "Route is inactive.";
    } else if (reviewStatus === "imported_unreviewed") {
        label = "Hidden: imported_unreviewed";
        detail = "Not shown on public map/API until metadata is reviewed.";
    } else if (reviewStatus === "needs_review") {
        label = "Hidden: needs_review";
        detail = "Not shown on public map/API until review issues are resolved.";
    } else if (reviewStatus === "reviewed") {
        label = "Visible: reviewed";
        detail = "Eligible for public map/API when active.";
        className = `${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`;
    } else if (reviewStatus === "verified") {
        label = "Visible: verified";
        detail = "Eligible for public map/API when active.";
        className = `${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`;
    } else if (reviewStatus === "rejected") {
        label = "Hidden: rejected";
        detail = "Rejected routes are never public.";
    } else {
        detail = `review_status=${reviewStatus}`;
    }

    return (
        <span className={className} title={detail || "Public preview"}>
            Public preview: {label}
        </span>
    );
}

export function IssueCountBadge({ count }: { readonly count: number }) {
    if (count <= 0) {
        return (
            <span className={`${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`} title="Open issues">
                0 issues
            </span>
        );
    }
    return (
        <span className={`${BADGE_BASE} bg-amber-50 text-amber-900 ring-amber-100`} title="Open issues">
            {count} issue{count === 1 ? "" : "s"}
        </span>
    );
}

const DUPLICATE_LABELS: Record<DuplicateStatus, string> = {
    none: "No duplicates",
    nearby: "Nearby duplicate",
    duplicate_name: "Duplicate name",
};

export function DuplicateBadge({ status }: { readonly status: DuplicateStatus }) {
    if (status === "none") {
        return (
            <span className={`${BADGE_BASE} bg-gray-100 text-gray-600 ring-gray-200`} title="Duplicate status">
                {DUPLICATE_LABELS.none}
            </span>
        );
    }
    if (status === "duplicate_name") {
        return (
            <span className={`${BADGE_BASE} bg-red-50 text-red-800 ring-red-100`} title="Duplicate status">
                {DUPLICATE_LABELS.duplicate_name}
            </span>
        );
    }
    return (
        <span className={`${BADGE_BASE} bg-amber-50 text-amber-900 ring-amber-100`} title="Duplicate status">
            {DUPLICATE_LABELS.nearby}
        </span>
    );
}

/** Compact row of list-item quality badges. */
export function TransportRouteQualityBadges({
    geometryStatus,
    hasSourceLink,
    issueCount,
    publicVisibility,
}: {
    readonly geometryStatus: RouteGeometryStatus;
    readonly hasSourceLink: boolean;
    readonly issueCount: number;
    readonly publicVisibility: PublicVisibility;
}) {
    return (
        <div className="flex flex-wrap gap-1">
            <GeometryBadge kind="route" status={geometryStatus} />
            <SourceBadge hasSourceLink={hasSourceLink} />
            <IssueCountBadge count={issueCount} />
            <PublicVisibilityBadge visibility={publicVisibility} />
        </div>
    );
}

export type RouteListWorkStatus =
    | "imported"
    | "needs_stop_review"
    | "needs_path_review"
    | "ready_to_review"
    | "reviewed"
    | "verified";

const ROUTE_LIST_WORK_STATUS_LABELS: Record<RouteListWorkStatus, string> = {
    imported: "Imported",
    needs_stop_review: "Needs stop review",
    needs_path_review: "Needs path review",
    ready_to_review: "Ready to review",
    reviewed: "Reviewed",
    verified: "Verified",
};

function routeListWorkStatusClass(status: RouteListWorkStatus): string {
    switch (status) {
        case "verified":
            return `${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`;
        case "reviewed":
            return `${BADGE_BASE} bg-blue-50 text-blue-800 ring-blue-100`;
        case "ready_to_review":
            return `${BADGE_BASE} bg-sky-50 text-sky-800 ring-sky-100`;
        case "needs_path_review":
        case "needs_stop_review":
            return `${BADGE_BASE} bg-amber-50 text-amber-900 ring-amber-100`;
        case "imported":
        default:
            return `${BADGE_BASE} bg-violet-50 text-violet-800 ring-violet-100`;
    }
}

export type RouteListWorkStatusInput = {
    readonly review_status: string;
    readonly variant_count: number;
    readonly stop_count: number;
    readonly path_count: number;
    readonly geometry_status: RouteGeometryStatus;
};

/** One validator-focused work status for the routes list. */
export function pickRouteListWorkStatus(row: RouteListWorkStatusInput): RouteListWorkStatus {
    if (row.review_status === "verified") {
        return "verified";
    }
    if (row.review_status === "reviewed") {
        return "reviewed";
    }
    if (row.review_status === "imported_unreviewed") {
        return "imported";
    }

    const needsPathReview =
        row.variant_count > 0 &&
        (row.path_count < row.variant_count ||
            row.geometry_status === "no_path" ||
            row.geometry_status === "estimate");

    const needsStopReview = row.variant_count > 0 && row.stop_count === 0;

    if (needsPathReview) {
        return "needs_path_review";
    }
    if (needsStopReview) {
        return "needs_stop_review";
    }
    if (row.review_status === "needs_review") {
        return "ready_to_review";
    }
    return "ready_to_review";
}

export function TransportRouteListWorkStatus({
    reviewStatus,
    variantCount,
    stopCount,
    pathCount,
    geometryStatus,
}: {
    readonly reviewStatus: string;
    readonly variantCount: number;
    readonly stopCount: number;
    readonly pathCount: number;
    readonly geometryStatus: RouteGeometryStatus;
}) {
    const status = pickRouteListWorkStatus({
        review_status: reviewStatus,
        variant_count: variantCount,
        stop_count: stopCount,
        path_count: pathCount,
        geometry_status: geometryStatus,
    });
    return (
        <span className={routeListWorkStatusClass(status)} title="Work status">
            {ROUTE_LIST_WORK_STATUS_LABELS[status]}
        </span>
    );
}

export type RouteListVisibility = "hidden" | "public" | "inactive";

export function pickRouteListVisibility(args: {
    readonly isActive: boolean;
    readonly publicVisibility: PublicVisibility;
}): RouteListVisibility {
    if (!args.isActive) {
        return "inactive";
    }
    if (args.publicVisibility === "visible") {
        return "public";
    }
    return "hidden";
}

const ROUTE_LIST_VISIBILITY_LABELS: Record<RouteListVisibility, string> = {
    hidden: "Hidden",
    public: "Public",
    inactive: "Inactive",
};

function routeListVisibilityClass(visibility: RouteListVisibility): string {
    switch (visibility) {
        case "public":
            return `${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`;
        case "inactive":
            return `${BADGE_BASE} bg-gray-100 text-gray-600 ring-gray-200`;
        case "hidden":
        default:
            return `${BADGE_BASE} bg-gray-100 text-gray-700 ring-gray-200`;
    }
}

export function TransportRouteListVisibility({
    isActive,
    publicVisibility,
}: {
    readonly isActive: boolean;
    readonly publicVisibility: PublicVisibility;
}) {
    const visibility = pickRouteListVisibility({ isActive, publicVisibility });
    return (
        <span className={routeListVisibilityClass(visibility)} title="Visibility">
            {ROUTE_LIST_VISIBILITY_LABELS[visibility]}
        </span>
    );
}

export type RouteListPublicNameParts = {
    readonly primary: string;
    readonly secondary: string | null;
};

/** Myanmar route name on line 1; English primary name on line 2 when present. */
export function formatRouteListPublicName(row: {
    readonly name_mm: string | null;
    readonly name_en: string | null;
    readonly public_name: string;
}): RouteListPublicNameParts {
    const myanmar = row.name_mm?.trim() || row.public_name?.trim() || "—";
    const english = row.name_en?.trim();
    return { primary: myanmar, secondary: english || null };
}

export function formatRouteOriginDestination(
    origin: string | null,
    destination: string | null
): string {
    const o = origin?.trim();
    const d = destination?.trim();
    if (o && d) {
        return `${o} → ${d}`;
    }
    return o || d || "—";
}

export function TransportStopQualityBadges({
    geometryStatus,
    hasSourceLink,
    duplicateStatus,
}: {
    readonly geometryStatus: StopGeometryStatus;
    readonly hasSourceLink: boolean;
    readonly duplicateStatus: DuplicateStatus;
}) {
    return (
        <div className="flex flex-wrap gap-1">
            <GeometryBadge kind="stop" status={geometryStatus} />
            <SourceBadge hasSourceLink={hasSourceLink} />
            <DuplicateBadge status={duplicateStatus} />
        </div>
    );
}

type StopListValidatorStatus = "needs_location_review" | "no_routes" | "reviewed" | "has_routes";

const STOP_LIST_STATUS_LABELS: Record<StopListValidatorStatus, string> = {
    needs_location_review: "Needs location review",
    no_routes: "No routes",
    reviewed: "Reviewed",
    has_routes: "Has routes",
};

function stopListValidatorStatusClass(status: StopListValidatorStatus): string {
    switch (status) {
        case "needs_location_review":
            return `${BADGE_BASE} bg-amber-50 text-amber-900 ring-amber-100`;
        case "no_routes":
            return `${BADGE_BASE} bg-gray-100 text-gray-600 ring-gray-200`;
        case "reviewed":
            return `${BADGE_BASE} bg-emerald-50 text-emerald-800 ring-emerald-100`;
        case "has_routes":
        default:
            return `${BADGE_BASE} bg-slate-50 text-slate-700 ring-slate-200`;
    }
}

function pickStopListValidatorStatus(args: {
    readonly geometryStatus: StopGeometryStatus;
    readonly routeCount: number;
    readonly reviewStatus: string;
}): StopListValidatorStatus {
    if (args.geometryStatus === "missing" || args.geometryStatus === "estimate") {
        return "needs_location_review";
    }
    if (args.routeCount === 0) {
        return "no_routes";
    }
    if (args.reviewStatus === "reviewed" || args.reviewStatus === "verified") {
        return "reviewed";
    }
    return "has_routes";
}

/**
 * One validator-focused status for the stops list. Technical geometry/source/
 * duplicate chips stay in stop detail; duplicate chips appear here only when the
 * list duplicate filter is active.
 */
export function TransportStopListStatus({
    geometryStatus,
    routeCount,
    reviewStatus,
    duplicateStatus,
    showDuplicateDetails = false,
}: {
    readonly geometryStatus: StopGeometryStatus;
    readonly routeCount: number;
    readonly reviewStatus: string;
    readonly duplicateStatus: DuplicateStatus;
    readonly showDuplicateDetails?: boolean;
}) {
    const status = pickStopListValidatorStatus({ geometryStatus, routeCount, reviewStatus });
    const showDuplicate =
        showDuplicateDetails && duplicateStatus !== "none";

    return (
        <div className="flex flex-wrap gap-1">
            <span className={stopListValidatorStatusClass(status)} title="Validator status">
                {STOP_LIST_STATUS_LABELS[status]}
            </span>
            {showDuplicate ? <DuplicateBadge status={duplicateStatus} /> : null}
        </div>
    );
}

const REVIEW_ACTIONS: {
    action: TransportReviewAction;
    label: string;
    variant: "primary" | "secondary" | "danger";
}[] = [
    { action: "mark_reviewed", label: "Mark reviewed", variant: "primary" },
    { action: "mark_needs_review", label: "Needs review", variant: "secondary" },
    { action: "mark_verified", label: "Verified", variant: "primary" },
    { action: "reject", label: "Reject", variant: "danger" },
];

function actionButtonClass(variant: "primary" | "secondary" | "danger", disabled: boolean): string {
    const base =
        "rounded-md px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50";
    if (variant === "danger") {
        return `${base} border border-red-300 bg-white text-red-700 hover:bg-red-50`;
    }
    if (variant === "secondary") {
        return `${base} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;
    }
    return `${base} bg-gray-900 text-white hover:bg-gray-800`;
}

export type TransportReviewActionBarProps = {
    readonly currentStatus: string;
    readonly blockers?: readonly string[];
    readonly markReviewedBlockers?: readonly string[];
    readonly disabled?: boolean;
    readonly onAction: (
        action: TransportReviewAction,
        reason?: string
    ) => Promise<{ blockers?: string[] } | void>;
};

export function TransportReviewActionBar({
    currentStatus,
    blockers = [],
    markReviewedBlockers = [],
    disabled = false,
    onAction,
}: TransportReviewActionBarProps) {
    const [busy, setBusy] = useState<TransportReviewAction | null>(null);
    const [error, setError] = useState("");
    const [localBlockers, setLocalBlockers] = useState<readonly string[]>([]);

    const visibleBlockers = localBlockers.length > 0 ? localBlockers : blockers;
    const verifyBlocked = visibleBlockers.length > 0;
    const markReviewedBlocked = markReviewedBlockers.length > 0;

    const handleAction = useCallback(
        async (action: TransportReviewAction) => {
            setError("");
            setLocalBlockers([]);
            setBusy(action);
            try {
                const result = await onAction(action);
                if (result?.blockers && result.blockers.length > 0) {
                    setLocalBlockers(result.blockers);
                }
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Review action failed.");
            } finally {
                setBusy(null);
            }
        },
        [onAction]
    );

    const isProtected = currentStatus === "manual_protected";

    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
                {REVIEW_ACTIONS.map(({ action, label, variant }) => {
                    const isVerify = action === "mark_verified";
                    const isMarkReviewed = action === "mark_reviewed";
                    const actionDisabled =
                        disabled ||
                        busy !== null ||
                        isProtected ||
                        (isVerify && verifyBlocked) ||
                        (isMarkReviewed && markReviewedBlocked);
                    return (
                        <button
                            key={action}
                            type="button"
                            disabled={actionDisabled}
                            onClick={() => void handleAction(action)}
                            className={actionButtonClass(variant, actionDisabled)}
                        >
                            {busy === action ? "Saving…" : label}
                        </button>
                    );
                })}
            </div>

            {isProtected ? (
                <p className="text-xs text-purple-800">Manual protected — review actions are locked.</p>
            ) : null}

            {markReviewedBlocked ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                    <p className="font-medium">Cannot mark reviewed until resolved:</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                        {markReviewedBlockers.map((b) => (
                            <li key={b}>{b}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {visibleBlockers.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                    <p className="font-medium">Cannot verify until resolved:</p>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                        {visibleBlockers.map((b) => (
                            <li key={b}>{b}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {error ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                    {error}
                </p>
            ) : null}
        </div>
    );
}

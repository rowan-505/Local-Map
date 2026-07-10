"use client";

import type { ReactNode } from "react";

import { transportModeLabel } from "./constants";
import { formatCandidateDistance } from "./reviewMapCandidateDisplay";
import type { ReviewMapNearbyCandidatesSearchStatus } from "./reviewMapNearbyCandidatesSearch";
import ReviewMapNearbyCandidatesStatus from "./ReviewMapNearbyCandidatesStatus";
import { formatCompactDirectionUsageSummary } from "./routeUsageSummaryDisplay";
import {
    STOP_DETAIL_DESTRUCTIVE_BTN,
    STOP_DETAIL_PRIMARY_BTN,
    STOP_DETAIL_SECONDARY_BTN,
    type TransportMapStopDetailCardAction,
} from "./TransportMapStopDetailCard";
import { ReviewStatusBadge } from "./transportReviewUi";
import type { TransportNearbyStopCandidate, TransportStopRouteUsageSummary } from "./types";

const ROW_CLASS = "flex flex-wrap gap-1";
const MERGE_GRID_CLASS = "grid grid-cols-2 gap-1";

export type TransportStopContextCardMode = "selected_route_stop" | "nearby_candidate_stop";

function InfoRow({
    label,
    value,
    valueTitle,
}: {
    readonly label: string;
    readonly value: ReactNode;
    readonly valueTitle?: string;
}) {
    const textValue = typeof value === "string" ? value : undefined;
    return (
        <div className="flex items-start justify-between gap-2 py-0.5 text-[11px] leading-snug">
            <span className="shrink-0 text-gray-500">{label}</span>
            <span
                className="min-w-0 max-w-[62%] break-words text-right font-medium text-gray-900 line-clamp-2"
                title={valueTitle ?? textValue}
            >
                {value}
            </span>
        </div>
    );
}

function ActionRow({
    actions,
    busy,
    destructive = false,
    className = ROW_CLASS,
}: {
    readonly actions: readonly TransportMapStopDetailCardAction[];
    readonly busy: boolean;
    readonly destructive?: boolean;
    readonly className?: string;
}) {
    if (actions.length === 0) {
        return null;
    }
    return (
        <div className={className}>
            {actions.map((action) => (
                <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    disabled={busy || action.disabled}
                    title={action.title}
                    className={
                        action.variant === "primary"
                            ? STOP_DETAIL_PRIMARY_BTN
                            : destructive || action.variant === "destructive"
                              ? STOP_DETAIL_DESTRUCTIVE_BTN
                              : STOP_DETAIL_SECONDARY_BTN
                    }
                >
                    {action.label}
                </button>
            ))}
        </div>
    );
}

function directionUsageText({
    loading,
    error,
    summary,
}: {
    readonly loading: boolean;
    readonly error: string | null;
    readonly summary: TransportStopRouteUsageSummary | null;
}): string {
    if (loading) {
        return "Loading...";
    }
    if (error || !summary) {
        return "—";
    }
    return formatCompactDirectionUsageSummary(summary);
}

export type TransportStopContextCardProps = {
    readonly mode: TransportStopContextCardMode;
    readonly busy?: boolean;
    /** Selected route stop sequence number. */
    readonly stopSequence?: number | null;
    readonly nameMm?: string | null;
    readonly nameEn?: string | null;
    readonly reviewStatus?: string | null;
    readonly hasUnsavedMove?: boolean;
    /** Formatted route usage line for the selected route stop. */
    readonly routeUsageText?: string | null;
    readonly routeUsageLoading?: boolean;
    /** Calculated arrival/departure line when timetable data exists. */
    readonly timetableText?: string | null;
    readonly nearbyCandidateCount?: number;
    readonly nearbyCandidatesStatus?: ReviewMapNearbyCandidatesSearchStatus;
    readonly onRetryNearbyCandidates?: () => void;
    readonly candidate?: TransportNearbyStopCandidate | null;
    readonly candidateUsageSummary?: TransportStopRouteUsageSummary | null;
    readonly candidateUsageLoading?: boolean;
    readonly candidateUsageError?: string | null;
    readonly primaryActions?: readonly TransportMapStopDetailCardAction[];
    readonly mainActions?: readonly TransportMapStopDetailCardAction[];
    readonly destructiveActions?: readonly TransportMapStopDetailCardAction[];
    readonly candidateCheckRoutesAction?: TransportMapStopDetailCardAction | null;
    readonly candidateKeepCurrentAction?: TransportMapStopDetailCardAction | null;
    readonly candidateKeepCandidateAction?: TransportMapStopDetailCardAction | null;
    readonly candidateCompareMergeAction?: TransportMapStopDetailCardAction | null;
    readonly onBackToSelectedStop?: () => void;
    readonly extraControls?: ReactNode;
    readonly deleteBlockMessage?: string | null;
};

/**
 * Single review-map stop context card. Switches between the selected route stop
 * and a nearby candidate without rendering a second card.
 */
export default function TransportStopContextCard({
    mode,
    busy = false,
    stopSequence = null,
    nameMm = null,
    nameEn = null,
    reviewStatus = null,
    hasUnsavedMove = false,
    routeUsageText = null,
    routeUsageLoading = false,
    timetableText = null,
    nearbyCandidateCount = 0,
    nearbyCandidatesStatus = "idle",
    onRetryNearbyCandidates,
    candidate = null,
    candidateUsageSummary = null,
    candidateUsageLoading = false,
    candidateUsageError = null,
    primaryActions = [],
    mainActions = [],
    destructiveActions = [],
    candidateCheckRoutesAction = null,
    candidateKeepCurrentAction = null,
    candidateKeepCandidateAction = null,
    candidateCompareMergeAction = null,
    onBackToSelectedStop,
    extraControls = null,
    deleteBlockMessage = null,
}: TransportStopContextCardProps) {
    const isCandidateMode = mode === "nearby_candidate_stop";
    const headerLabel = isCandidateMode ? "Candidate stop" : "Selected stop";
    const headerColor = isCandidateMode ? "text-purple-800" : "text-blue-800";

    const nameMyDisplay = nameMm?.trim() || "—";
    const nameEnDisplay = nameEn?.trim() || "—";

    const candidateNameMy = candidate?.nameMy?.trim() || "—";
    const candidateNameEn = candidate?.nameEn?.trim() || "—";

    const candidateRoutesText =
        candidateUsageLoading || candidateUsageError || !candidateUsageSummary
            ? candidateUsageLoading
                ? "Loading..."
                : candidateUsageError
                  ? "—"
                  : "—"
            : String(candidateUsageSummary.totalRoutes);
    const candidateVariantsText =
        candidateUsageLoading || candidateUsageError || !candidateUsageSummary
            ? candidateUsageLoading
                ? "Loading..."
                : candidateUsageError
                  ? "—"
                  : "—"
            : String(candidateUsageSummary.totalVariants);
    const candidateDirectionText = directionUsageText({
        loading: candidateUsageLoading,
        error: candidateUsageError,
        summary: candidateUsageSummary,
    });

    const selectedRouteUsageDisplay = routeUsageLoading
        ? "Loading..."
        : routeUsageText ?? null;

    const hasSelectedActions =
        primaryActions.length > 0 || mainActions.length > 0 || destructiveActions.length > 0;
    const hasCandidateActions =
        candidateCheckRoutesAction ||
        candidateKeepCurrentAction ||
        candidateKeepCandidateAction ||
        candidateCompareMergeAction ||
        onBackToSelectedStop;

    const showNearbyFooter =
        !isCandidateMode &&
        (nearbyCandidatesStatus !== "idle" || nearbyCandidateCount > 0);

    return (
        <section
            className="flex max-h-[min(calc(100dvh-7rem),520px)] flex-col sm:max-h-[min(calc(100dvh-8rem),520px)]"
            aria-label={headerLabel}
        >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                    <p
                        className={`text-[10px] font-semibold uppercase tracking-wide ${headerColor}`}
                    >
                        {headerLabel}
                    </p>
                    <ReviewStatusBadge
                        reviewStatus={
                            (isCandidateMode
                                ? candidate?.reviewStatus
                                : reviewStatus) ?? "needs_review"
                        }
                    />
                </div>

                {isCandidateMode ? (
                    <div className="mt-1 space-y-0">
                        <InfoRow label="Myanmar" value={candidateNameMy} valueTitle={candidateNameMy} />
                        <InfoRow label="English" value={candidateNameEn} valueTitle={candidateNameEn} />
                        {candidate && Number.isFinite(candidate.distanceMeters) ? (
                            <InfoRow
                                label="Distance"
                                value={formatCandidateDistance(candidate.distanceMeters)}
                            />
                        ) : null}
                        <InfoRow
                            label="Mode"
                            value={candidate ? transportModeLabel(candidate.mode) : "—"}
                        />
                        <InfoRow
                            label="Stop type"
                            value={candidate?.stopType?.trim() || "—"}
                        />
                        <InfoRow label="Routes" value={candidateRoutesText} />
                        <InfoRow label="Variants" value={candidateVariantsText} />
                        <InfoRow
                            label="Direction usage"
                            value={candidateDirectionText}
                            valueTitle={candidateDirectionText}
                        />
                        {candidateUsageLoading ? (
                            <p className="mt-1 text-[10px] text-purple-800">Loading route usage...</p>
                        ) : null}
                    </div>
                ) : (
                    <div className="mt-1 space-y-0">
                        {stopSequence !== null ? (
                            <InfoRow label="Sequence" value={`#${stopSequence}`} />
                        ) : null}
                        <InfoRow label="Myanmar" value={nameMyDisplay} valueTitle={nameMyDisplay} />
                        <InfoRow label="English" value={nameEnDisplay} valueTitle={nameEnDisplay} />
                        <InfoRow
                            label="Location"
                            value={hasUnsavedMove ? "Unsaved preview" : "Saved"}
                        />
                        {selectedRouteUsageDisplay || routeUsageLoading ? (
                            <InfoRow
                                label="Route usage"
                                value={selectedRouteUsageDisplay ?? "—"}
                                valueTitle={selectedRouteUsageDisplay ?? undefined}
                            />
                        ) : null}
                        {timetableText ? (
                            <InfoRow
                                label="Timetable"
                                value={timetableText}
                                valueTitle={timetableText}
                            />
                        ) : null}
                        {nearbyCandidatesStatus === "success" || nearbyCandidateCount > 0 ? (
                            <InfoRow
                                label="Nearby candidates"
                                value={String(nearbyCandidateCount)}
                            />
                        ) : null}
                    </div>
                )}

                {deleteBlockMessage && !isCandidateMode ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-amber-900">
                        {deleteBlockMessage}
                    </p>
                ) : null}

                {extraControls && !isCandidateMode ? (
                    <div className="mt-1.5">{extraControls}</div>
                ) : null}
            </div>

            {showNearbyFooter ? (
                <div className="shrink-0 border-t border-gray-100">
                    <ReviewMapNearbyCandidatesStatus
                        status={nearbyCandidatesStatus}
                        count={nearbyCandidateCount}
                        retryDisabled={nearbyCandidatesStatus === "loading"}
                        onRetry={onRetryNearbyCandidates}
                    />
                </div>
            ) : null}

            {hasSelectedActions && !isCandidateMode ? (
                <div className="sticky bottom-0 shrink-0 space-y-1 border-t border-gray-200 bg-white/95 px-3 py-2 backdrop-blur-sm">
                    <ActionRow actions={primaryActions} busy={busy} />
                    <ActionRow actions={mainActions} busy={busy} />
                    <ActionRow actions={destructiveActions} busy={busy} destructive />
                </div>
            ) : null}

            {hasCandidateActions && isCandidateMode ? (
                <div className="sticky bottom-0 shrink-0 space-y-1.5 border-t border-purple-100 bg-white/95 px-3 py-2 backdrop-blur-sm">
                    {onBackToSelectedStop ? (
                        <button
                            type="button"
                            onClick={onBackToSelectedStop}
                            disabled={busy}
                            className="text-[10px] font-medium text-purple-800 hover:text-purple-950 disabled:opacity-40"
                        >
                            ← Back to selected stop
                        </button>
                    ) : null}
                    {candidateCheckRoutesAction ? (
                        <ActionRow actions={[candidateCheckRoutesAction]} busy={busy} />
                    ) : null}
                    {candidateKeepCurrentAction || candidateKeepCandidateAction ? (
                        <ActionRow
                            actions={[
                                ...(candidateKeepCurrentAction ? [candidateKeepCurrentAction] : []),
                                ...(candidateKeepCandidateAction
                                    ? [candidateKeepCandidateAction]
                                    : []),
                            ]}
                            busy={busy}
                            className={MERGE_GRID_CLASS}
                        />
                    ) : null}
                    {candidateCompareMergeAction ? (
                        <ActionRow actions={[candidateCompareMergeAction]} busy={busy} />
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}

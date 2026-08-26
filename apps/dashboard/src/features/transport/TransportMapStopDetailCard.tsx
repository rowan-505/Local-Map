"use client";

import { useState, type ReactNode, type RefObject } from "react";

import { transportModeLabel } from "./constants";
import { formatCandidateDistance } from "./reviewMapCandidateDisplay";
import {
    formatCompactDirectionUsageSummary,
    formatRouteUsageSummary,
    shortStopPublicId,
} from "./routeUsageSummaryDisplay";
import { canonicalYbsVariantCode, ybsDirectionLabel } from "./variantDirection";
import { ReviewStatusBadge } from "./transportReviewUi";
import type {
    TransportStopRouteUsageDetailItem,
    TransportStopRouteUsageSummary,
} from "./types";

const ROW_CLASS = "flex flex-wrap gap-1";
export const STOP_DETAIL_PRIMARY_BTN =
    "rounded-md bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40";
export const STOP_DETAIL_SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40";
export const STOP_DETAIL_DESTRUCTIVE_BTN =
    "rounded-md border border-red-200 bg-white px-2 py-0.5 text-[10px] font-medium text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40";

export type TransportMapStopDetailCardStop = {
    readonly publicId: string;
    readonly title: string;
    readonly nameMy: string | null;
    readonly nameEn: string | null;
    readonly mode: string;
    readonly stopType: string;
    readonly reviewStatus: string | null;
    readonly confidenceScore: number | null;
    readonly distanceMeters?: number | null;
};

export type TransportMapStopDetailCardAction = {
    readonly label: string;
    readonly onClick: () => void;
    readonly disabled?: boolean;
    readonly title?: string;
    readonly variant?: "primary" | "secondary" | "destructive";
};

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

function formatRouteItemLabel(item: TransportStopRouteUsageDetailItem): string {
    const canonicalYbs = item.routeCode.startsWith("YBS-");
    const direction = canonicalYbs
        ? ybsDirectionLabel(item.directionId)
        : item.directionName?.trim() ||
          (item.directionId === null ? null : `Direction ${item.directionId}`);
    const variantCode = canonicalYbs
        ? (canonicalYbsVariantCode(item.routeCode, item.directionId) ?? item.variantCode)
        : item.variantCode;
    return direction
        ? `${item.routeCode} · ${variantCode} (${direction})`
        : `${item.routeCode} · ${variantCode}`;
}

function directionDisplay({
    loading,
    error,
    summary,
}: {
    readonly loading: boolean;
    readonly error: string | null;
    readonly summary: TransportStopRouteUsageSummary | null;
}): { text: string; title?: string } {
    if (loading) {
        return { text: "Loading..." };
    }
    if (error || !summary) {
        return { text: "—" };
    }
    const text = formatCompactDirectionUsageSummary(summary);
    return { text, title: text };
}

function ActionButtons({
    actions,
    busy,
}: {
    readonly actions: readonly TransportMapStopDetailCardAction[];
    readonly busy: boolean;
}) {
    if (actions.length === 0) {
        return null;
    }
    return (
        <div className={ROW_CLASS}>
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
                            : action.variant === "destructive"
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

export type TransportMapStopDetailCardProps = {
    readonly label: string;
    readonly stop: TransportMapStopDetailCardStop;
    readonly usageSummary?: TransportStopRouteUsageSummary | null;
    readonly usageItems?: readonly TransportStopRouteUsageDetailItem[];
    readonly usageLoading?: boolean;
    readonly usageError?: string | null;
    readonly primaryActions?: readonly TransportMapStopDetailCardAction[];
    readonly actions?: readonly TransportMapStopDetailCardAction[];
    readonly extraControls?: ReactNode;
    readonly cardRef?: RefObject<HTMLDivElement | null>;
    readonly onClose?: () => void;
    readonly busy?: boolean;
    /** `overlay` = compact floating map card; `panel` = legacy sidebar strip. */
    readonly appearance?: "overlay" | "panel";
};

function OverlayCandidateCard(props: TransportMapStopDetailCardProps) {
    const {
        label,
        stop,
        usageSummary = null,
        usageItems = [],
        usageLoading = false,
        usageError = null,
        primaryActions = [],
        actions = [],
        extraControls = null,
        cardRef,
        onClose,
        busy = false,
    } = props;
    const [routesExpanded, setRoutesExpanded] = useState(false);
    const [moreExpanded, setMoreExpanded] = useState(false);

    const confidence =
        stop.confidenceScore === null ? "—" : String(Math.round(stop.confidenceScore));
    const routesSummary =
        usageLoading || usageError || !usageSummary
            ? usageLoading
                ? "Loading..."
                : usageError
                  ? "—"
                  : "—"
            : formatRouteUsageSummary(usageSummary);
    const direction = directionDisplay({
        loading: usageLoading,
        error: usageError,
        summary: usageSummary,
    });
    const nameMy = stop.nameMy?.trim() || "—";
    const nameEn = stop.nameEn?.trim() || "—";

    return (
        <section
            ref={cardRef}
            tabIndex={-1}
            className="flex max-h-[min(48vh,400px)] flex-col outline-none focus:ring-2 focus:ring-purple-300"
            aria-label={label}
        >
            <div className="shrink-0 px-3 pb-1 pt-2">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-purple-800">
                            {label}
                        </p>
                        <p
                            className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-gray-900"
                            title={stop.title}
                        >
                            {stop.title}
                        </p>
                    </div>
                    {onClose ? (
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="shrink-0 rounded p-1 text-gray-500 hover:bg-white/70 hover:text-gray-800 disabled:opacity-40"
                            aria-label="Close candidate details"
                        >
                            ×
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
                <div className="space-y-0">
                    <InfoRow label="Myanmar" value={nameMy} valueTitle={nameMy} />
                    <InfoRow label="English" value={nameEn} valueTitle={nameEn} />
                    {stop.distanceMeters !== undefined && stop.distanceMeters !== null ? (
                        <InfoRow
                            label="Distance"
                            value={formatCandidateDistance(stop.distanceMeters)}
                        />
                    ) : null}
                    <InfoRow label="Mode" value={transportModeLabel(stop.mode)} />
                    <InfoRow label="Stop type" value={stop.stopType || "—"} />
                    <div className="flex items-center justify-between gap-2 py-0.5 text-[11px] leading-snug">
                        <span className="shrink-0 text-gray-500">Review status</span>
                        <ReviewStatusBadge reviewStatus={stop.reviewStatus ?? "needs_review"} />
                    </div>
                    <InfoRow
                        label="Routes"
                        value={routesSummary}
                        valueTitle={routesSummary}
                    />
                    <InfoRow
                        label="Route variant directions"
                        value={direction.text}
                        valueTitle={direction.title}
                    />
                </div>

                {usageItems.length > 0 && !usageLoading && !usageError ? (
                    <div className="mt-1.5 border-t border-gray-100 pt-1.5">
                        <button
                            type="button"
                            onClick={() => setRoutesExpanded((open) => !open)}
                            className="text-[10px] font-medium text-purple-800 hover:text-purple-950"
                        >
                            {routesExpanded ? "Hide routes" : "Show routes"}
                        </button>
                        {routesExpanded ? (
                            <ul className="mt-1 space-y-0.5">
                                {usageItems.map((item) => {
                                    const line = formatRouteItemLabel(item);
                                    return (
                                        <li
                                            key={`${item.routeCode}-${item.variantCode}-${item.directionId}`}
                                            className="line-clamp-2 break-words text-[10px] leading-snug text-gray-700"
                                            title={line}
                                        >
                                            {line}
                                        </li>
                                    );
                                })}
                            </ul>
                        ) : null}
                    </div>
                ) : null}

                <div className="mt-1.5 border-t border-gray-100 pt-1.5">
                    <button
                        type="button"
                        onClick={() => setMoreExpanded((open) => !open)}
                        className="text-[10px] font-medium text-gray-600 hover:text-gray-900"
                    >
                        {moreExpanded ? "Less" : "More"}
                    </button>
                    {moreExpanded ? (
                        <div className="mt-1 space-y-0">
                            <InfoRow
                                label="Stop ID"
                                value={shortStopPublicId(stop.publicId)}
                                valueTitle={stop.publicId}
                            />
                            <InfoRow label="Confidence" value={confidence} />
                        </div>
                    ) : null}
                </div>

                {extraControls ? <div className="mt-1.5">{extraControls}</div> : null}
            </div>

            {primaryActions.length > 0 || actions.length > 0 ? (
                <div className="shrink-0 space-y-1.5 border-t border-gray-200 bg-white/95 px-3 py-2">
                    <ActionButtons actions={primaryActions} busy={busy} />
                    <ActionButtons actions={actions} busy={busy} />
                </div>
            ) : null}
        </section>
    );
}

export default function TransportMapStopDetailCard(props: TransportMapStopDetailCardProps) {
    if (props.appearance === "overlay") {
        return <OverlayCandidateCard {...props} />;
    }

    const {
        label,
        stop,
        usageSummary = null,
        usageItems = [],
        usageLoading = false,
        usageError = null,
        primaryActions = [],
        actions = [],
        extraControls = null,
        cardRef,
        onClose,
        busy = false,
    } = props;

    const confidence =
        stop.confidenceScore === null ? "—" : String(Math.round(stop.confidenceScore));

    return (
        <section
            ref={cardRef}
            tabIndex={-1}
            className="border-b border-blue-100 bg-blue-50/60 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-300"
            aria-label={label}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                        {label}
                    </p>
                    <p
                        className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-gray-900"
                        title={stop.title}
                    >
                        {stop.title}
                    </p>
                </div>
                {onClose ? (
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="shrink-0 rounded p-1 text-gray-500 hover:bg-white/70 hover:text-gray-800 disabled:opacity-40"
                        aria-label="Close stop details"
                    >
                        ×
                    </button>
                ) : null}
            </div>

            <div className="mt-2 space-y-0.5">
                <InfoRow label="Stop ID" value={shortStopPublicId(stop.publicId)} />
                <InfoRow label="Myanmar" value={stop.nameMy?.trim() || "—"} />
                <InfoRow label="English" value={stop.nameEn?.trim() || "—"} />
                <InfoRow label="Mode" value={transportModeLabel(stop.mode)} />
                <InfoRow label="Stop type" value={stop.stopType || "—"} />
                <div className="flex items-center justify-between gap-2 py-0.5 text-[11px]">
                    <span className="text-gray-500">Review status</span>
                    <ReviewStatusBadge reviewStatus={stop.reviewStatus ?? "needs_review"} />
                </div>
                <InfoRow label="Confidence" value={confidence} />
                {stop.distanceMeters !== undefined && stop.distanceMeters !== null ? (
                    <InfoRow
                        label="Distance"
                        value={formatCandidateDistance(stop.distanceMeters)}
                    />
                ) : null}
                <InfoRow
                    label="Routes"
                    value={
                        usageLoading
                            ? "Loading..."
                            : usageError
                              ? "—"
                              : usageSummary
                                ? formatRouteUsageSummary(usageSummary)
                                : "—"
                    }
                />
                <InfoRow
                    label="Route variant directions"
                    value={
                        directionDisplay({
                            loading: usageLoading,
                            error: usageError,
                            summary: usageSummary,
                        }).text
                    }
                />
            </div>

            {extraControls ? <div className="mt-2">{extraControls}</div> : null}

            {primaryActions.length > 0 ? (
                <div className={`mt-2 ${ROW_CLASS}`}>
                    <ActionButtons actions={primaryActions} busy={busy} />
                </div>
            ) : null}

            {actions.length > 0 ? (
                <div className={`mt-1.5 ${ROW_CLASS}`}>
                    <ActionButtons actions={actions} busy={busy} />
                </div>
            ) : null}
        </section>
    );
}

"use client";

import type { ReactNode } from "react";

import {
    STOP_DETAIL_DESTRUCTIVE_BTN,
    STOP_DETAIL_PRIMARY_BTN,
    STOP_DETAIL_SECONDARY_BTN,
    type TransportMapStopDetailCardAction,
} from "./TransportMapStopDetailCard";
import { ReviewStatusBadge } from "./transportReviewUi";

const ROW_CLASS = "flex flex-wrap gap-1";

function ActionRow({
    actions,
    busy,
    destructive = false,
}: {
    readonly actions: readonly TransportMapStopDetailCardAction[];
    readonly busy: boolean;
    readonly destructive?: boolean;
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

export type ReviewMapSelectedStopPanelProps = {
    /** Display title, e.g. "#2 Stop Name". Mode-agnostic (bus, train, ferry, ...). */
    readonly title: string;
    /** Secondary name line (e.g. English name), hidden when empty. */
    readonly secondaryName?: string | null;
    readonly reviewStatus?: string | null;
    /** True while an unsaved preview location exists. */
    readonly hasUnsavedMove: boolean;
    /** One-line route usage summary; already formatted and error-safe. */
    readonly usageText?: string | null;
    readonly primaryActions: readonly TransportMapStopDetailCardAction[];
    readonly mainActions: readonly TransportMapStopDetailCardAction[];
    readonly destructiveActions: readonly TransportMapStopDetailCardAction[];
    readonly busy?: boolean;
    readonly extraControls?: ReactNode;
    readonly footer?: ReactNode;
};

/**
 * Compact selected-stop panel for the Review Map overlay. Scrollable body with
 * sticky action rows so buttons stay visible.
 */
export default function ReviewMapSelectedStopPanel({
    title,
    secondaryName = null,
    reviewStatus = null,
    hasUnsavedMove,
    usageText = null,
    primaryActions,
    mainActions,
    destructiveActions,
    busy = false,
    extraControls = null,
    footer = null,
}: ReviewMapSelectedStopPanelProps) {
    const hasActions =
        primaryActions.length > 0 || mainActions.length > 0 || destructiveActions.length > 0;

    return (
        <section
            className="flex max-h-[min(70vh,520px)] flex-col"
            aria-label="Selected stop"
        >
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                        Selected stop
                    </p>
                    <ReviewStatusBadge reviewStatus={reviewStatus ?? "needs_review"} />
                </div>

                <p
                    className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-gray-900"
                    title={title}
                >
                    {title}
                </p>
                {secondaryName?.trim() ? (
                    <p
                        className="line-clamp-2 text-[11px] leading-snug text-gray-600"
                        title={secondaryName}
                    >
                        {secondaryName}
                    </p>
                ) : null}

                {hasUnsavedMove ? (
                    <p className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium leading-snug text-amber-900">
                        Unsaved preview location — Save or Revert.
                    </p>
                ) : (
                    <p className="mt-1 text-[11px] text-gray-500">Saved location</p>
                )}

                {usageText ? (
                    <p
                        className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-600"
                        title={usageText}
                    >
                        {usageText}
                    </p>
                ) : null}

                {extraControls ? <div className="mt-1.5">{extraControls}</div> : null}
            </div>

            {footer ? <div className="shrink-0 border-t border-gray-100">{footer}</div> : null}

            {hasActions ? (
                <div className="shrink-0 space-y-1 border-t border-gray-200 bg-white/95 px-3 py-2">
                    <ActionRow actions={primaryActions} busy={busy} />
                    <ActionRow actions={mainActions} busy={busy} />
                    <ActionRow actions={destructiveActions} busy={busy} destructive />
                </div>
            ) : null}
        </section>
    );
}

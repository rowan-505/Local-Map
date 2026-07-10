"use client";

import type { ReviewMapNearbyCandidatesSearchStatus } from "./reviewMapNearbyCandidatesSearch";

const STATUS_WRAP_CLASS =
    "border-b border-purple-100 bg-purple-50/50 px-3 py-2 text-[11px] text-purple-950";
const STATUS_LINE_CLASS = "font-medium text-purple-950";
const STATUS_HINT_CLASS = "mt-0.5 text-purple-800";
const RETRY_BTN_CLASS =
    "ml-2 rounded border border-purple-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-purple-900 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-40";

function NearbyCandidatesSpinner() {
    return (
        <span
            className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-purple-200 border-t-purple-700"
            aria-hidden
        />
    );
}

export type ReviewMapNearbyCandidatesStatusProps = {
    readonly status: ReviewMapNearbyCandidatesSearchStatus;
    readonly count: number;
    readonly radiusMeters?: number;
    readonly retryDisabled?: boolean;
    readonly onRetry?: () => void;
};

export default function ReviewMapNearbyCandidatesStatus({
    status,
    count,
    radiusMeters = 100,
    retryDisabled = false,
    onRetry,
}: ReviewMapNearbyCandidatesStatusProps) {
    if (status === "idle") {
        return null;
    }

    if (status === "loading") {
        return (
            <div className={STATUS_WRAP_CLASS}>
                <div className="flex items-start gap-2">
                    <NearbyCandidatesSpinner />
                    <div>
                        <p className={STATUS_LINE_CLASS}>Nearby candidates</p>
                        <p className={STATUS_HINT_CLASS}>Loading...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (status === "error") {
        return (
            <div className={STATUS_WRAP_CLASS}>
                <p className={STATUS_LINE_CLASS}>
                    Nearby candidate search failed
                    {onRetry ? (
                        <button
                            type="button"
                            onClick={onRetry}
                            disabled={retryDisabled}
                            className={RETRY_BTN_CLASS}
                        >
                            Retry
                        </button>
                    ) : null}
                </p>
            </div>
        );
    }

    if (status === "success") {
        return (
            <div className={STATUS_WRAP_CLASS}>
                <p className={STATUS_LINE_CLASS}>Nearby candidates: {count}</p>
                <p className={STATUS_HINT_CLASS}>Click a purple point to inspect.</p>
            </div>
        );
    }

    return (
        <div className={STATUS_WRAP_CLASS}>
            <p className={STATUS_LINE_CLASS}>Nearby candidates: 0</p>
            <p className={STATUS_HINT_CLASS}>
                No nearby stops found within {radiusMeters} m.
            </p>
        </div>
    );
}

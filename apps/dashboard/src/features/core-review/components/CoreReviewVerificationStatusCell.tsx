"use client";

import {
    CORE_REVIEW_VERIFICATION_STATUS_LABELS,
    getVerificationStatusBadgeToneClasses,
    normalizeVerificationStatus,
} from "../config/verificationStatus";

export type CoreReviewVerificationStatusCellProps = {
    status?: string | null;
    isVerifiedFallback?: boolean | null;
};

export default function CoreReviewVerificationStatusCell({
    status,
    isVerifiedFallback,
}: CoreReviewVerificationStatusCellProps) {
    const normalized = normalizeVerificationStatus(status, isVerifiedFallback);
    const label = CORE_REVIEW_VERIFICATION_STATUS_LABELS[normalized];
    const tone = getVerificationStatusBadgeToneClasses(status, isVerifiedFallback);

    return (
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>
            {label}
        </span>
    );
}

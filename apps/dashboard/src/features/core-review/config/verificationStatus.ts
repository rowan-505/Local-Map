import type { ReviewStatusBadgeVariant } from "@/src/components/review/ReviewStatusBadge";

/**
 * Canonical verification_status values stored in core / core_transport tables.
 * Input alias "rejected" normalizes to rejected_after_core_review.
 */
export const CORE_REVIEW_VERIFICATION_STATUSES = [
    "unverified",
    "verified",
    "needs_fix",
    "questionable",
    "rejected_after_core_review",
] as const;

export type CoreReviewVerificationStatus = (typeof CORE_REVIEW_VERIFICATION_STATUSES)[number];

export const CORE_REVIEW_VERIFICATION_STATUS_LABELS: Record<CoreReviewVerificationStatus, string> = {
    unverified: "Unverified",
    verified: "Verified",
    needs_fix: "Needs fix",
    questionable: "Questionable",
    rejected_after_core_review: "Rejected",
};

/** Dropdown options — canonical stored values with display labels. */
export const verificationStatusOptions: ReadonlyArray<{
    value: CoreReviewVerificationStatus;
    label: string;
}> = CORE_REVIEW_VERIFICATION_STATUSES.map((value) => ({
    value,
    label: CORE_REVIEW_VERIFICATION_STATUS_LABELS[value],
}));

export function parseVerificationStatusInput(raw: unknown): CoreReviewVerificationStatus | undefined {
    if (typeof raw !== "string") {
        return undefined;
    }
    const value = raw.trim().toLowerCase();
    if (value === "rejected") {
        return "rejected_after_core_review";
    }
    if ((CORE_REVIEW_VERIFICATION_STATUSES as readonly string[]).includes(value)) {
        return value as CoreReviewVerificationStatus;
    }
    return undefined;
}

/**
 * Resolve canonical verification_status.
 * verification_status is authoritative; is_verified is legacy fallback only.
 */
export function normalizeVerificationStatus(
    value: string | null | undefined,
    isVerifiedFallback?: boolean | null,
): CoreReviewVerificationStatus {
    const parsed = parseVerificationStatusInput(value);
    if (parsed) {
        return parsed;
    }
    if (isVerifiedFallback === true) {
        return "verified";
    }
    return "unverified";
}

/** Derived compatibility flag — true only for verified status. */
export function isVerifiedFromStatus(
    status: string | null | undefined,
    isVerifiedFallback?: boolean | null,
): boolean {
    return normalizeVerificationStatus(status, isVerifiedFallback) === "verified";
}

export function formatVerificationStatusLabel(
    status: string | null | undefined,
    isVerifiedFallback?: boolean | null,
): string {
    const normalized = normalizeVerificationStatus(status, isVerifiedFallback);
    return CORE_REVIEW_VERIFICATION_STATUS_LABELS[normalized];
}

/** Map status to existing ReviewStatusBadge variants (CoreReviewStatusBadge). */
export function getVerificationStatusBadgeVariant(
    status: string | null | undefined,
    isVerifiedFallback?: boolean | null,
): ReviewStatusBadgeVariant {
    const normalized = normalizeVerificationStatus(status, isVerifiedFallback);
    switch (normalized) {
        case "verified":
            return "verified";
        case "needs_fix":
        case "questionable":
            return "confidence-medium";
        case "rejected_after_core_review":
            return "deleted";
        default:
            return "unverified";
    }
}

/** Pill-style classes aligned with TransportVerificationStatusCell tones. */
export function getVerificationStatusBadgeToneClasses(
    status: string | null | undefined,
    isVerifiedFallback?: boolean | null,
): string {
    const normalized = normalizeVerificationStatus(status, isVerifiedFallback);
    switch (normalized) {
        case "verified":
            return "border-emerald-200 bg-emerald-50 text-emerald-900";
        case "needs_fix":
        case "questionable":
            return "border-amber-200 bg-amber-50 text-amber-950";
        case "rejected_after_core_review":
            return "border-red-200 bg-red-50 text-red-900";
        default:
            return "border-slate-200 bg-slate-50 text-slate-700";
    }
}

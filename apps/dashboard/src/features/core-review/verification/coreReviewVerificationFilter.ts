export const CORE_REVIEW_VERIFICATION_STATUSES = [
    "unverified",
    "verified",
    "needs_fix",
    "questionable",
    "rejected_after_core_review",
] as const;

export type CoreReviewVerificationStatus = (typeof CORE_REVIEW_VERIFICATION_STATUSES)[number];

/** URL/list filter values; uses `rejected` alias instead of DB canonical value. */
export type CoreReviewVerificationStatusFilter =
    | "all"
    | "unverified"
    | "verified"
    | "needs_fix"
    | "questionable"
    | "rejected";

export const CORE_REVIEW_VERIFICATION_STATUS_FILTER_OPTIONS: {
    value: CoreReviewVerificationStatusFilter;
    label: string;
}[] = [
    { value: "all", label: "All" },
    { value: "unverified", label: "Unverified" },
    { value: "verified", label: "Verified" },
    { value: "needs_fix", label: "Needs fix" },
    { value: "questionable", label: "Questionable" },
    { value: "rejected", label: "Rejected" },
];

export function normalizeCoreReviewVerificationStatus(raw: string): CoreReviewVerificationStatus | undefined {
    const value = raw.trim().toLowerCase();
    if (value === "rejected") {
        return "rejected_after_core_review";
    }
    if ((CORE_REVIEW_VERIFICATION_STATUSES as readonly string[]).includes(value)) {
        return value as CoreReviewVerificationStatus;
    }
    return undefined;
}

export function verificationFilterToApiParam(
    filter: CoreReviewVerificationStatusFilter
): Exclude<CoreReviewVerificationStatusFilter, "all"> | undefined {
    return filter === "all" ? undefined : filter;
}

export function verificationStatusToFilterParam(
    status: CoreReviewVerificationStatus
): Exclude<CoreReviewVerificationStatusFilter, "all"> {
    return status === "rejected_after_core_review" ? "rejected" : status;
}

export function parseCoreReviewVerificationStatusFilter(
    verificationStatusRaw: string | null,
    legacyIsVerifiedRaw: string | null
): CoreReviewVerificationStatusFilter {
    const statusRaw = verificationStatusRaw?.trim();
    if (statusRaw) {
        if (statusRaw === "rejected" || statusRaw === "rejected_after_core_review") {
            return "rejected";
        }
        const normalized = normalizeCoreReviewVerificationStatus(statusRaw);
        if (normalized) {
            return verificationStatusToFilterParam(normalized);
        }
    }
    if (legacyIsVerifiedRaw === "true") {
        return "verified";
    }
    if (legacyIsVerifiedRaw === "false") {
        return "unverified";
    }
    return "all";
}

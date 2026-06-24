export const VERIFICATION_SUMMARY_STATUSES = [
    "unverified",
    "verified",
    "needs_fix",
    "questionable",
    "rejected_after_core_review",
] as const;

export type VerificationSummaryStatus = (typeof VERIFICATION_SUMMARY_STATUSES)[number];

export type VerificationSummaryCaps = {
    columns: ReadonlySet<string>;
    hasVerificationStatus: boolean;
    hasIsVerified: boolean;
    hasDeletedAt: boolean;
    hasColumn: (column: string) => boolean;
};

export type VerificationSummaryEntityConfig = {
    family: string;
    label: string;
    table: string;
    path: string;
    idColumns: readonly string[];
    /** Optional UI source label. */
    sourceLabel?: string;
};

export type VerificationSummarySupport = {
    table_exists: boolean;
    verification_supported: boolean;
    unsupported_reason: string | null;
    missing_verification_columns: string[];
};

export type VerificationSummaryFamilyRow = {
    family: string;
    label: string;
    table: string;
    path: string;
    source_label: string | null;
    total: number;
    unverified: number;
    verified: number;
    needs_fix: number;
    questionable: number;
    rejected_after_core_review: number;
    support: VerificationSummarySupport;
};

export type VerificationSummaryResponse = {
    statuses: readonly VerificationSummaryStatus[];
    families: VerificationSummaryFamilyRow[];
    totals: Record<string, number>;
};

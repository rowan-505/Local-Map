import type {
    ReportStatusCode,
    ReportTargetEntityType,
    ReportTypeCode,
    RewardReasonCode,
} from "./types";

export const REPORT_STATUS_OPTIONS: { value: ReportStatusCode; label: string }[] = [
    { value: "submitted", label: "Submitted" },
    { value: "in_review", label: "In review" },
    { value: "needs_more_info", label: "Needs more info" },
    { value: "accepted", label: "Accepted" },
    { value: "rejected", label: "Rejected" },
    { value: "duplicate", label: "Duplicate" },
];

export const REPORT_TYPE_OPTIONS: { value: ReportTypeCode; label: string }[] = [
    { value: "wrong_info", label: "Wrong information" },
    { value: "wrong_location", label: "Wrong location" },
    { value: "missing_item", label: "Missing item" },
    { value: "closed_or_removed", label: "Closed or removed" },
    { value: "duplicate_item", label: "Duplicate item" },
    { value: "transport_issue", label: "Transport issue" },
    { value: "community_info", label: "Community info" },
    { value: "other_map_issue", label: "Others" },
];

export const TARGET_ENTITY_TYPE_OPTIONS: { value: ReportTargetEntityType; label: string }[] = [
    { value: "place", label: "Place" },
    { value: "street", label: "Street" },
    { value: "building", label: "Building" },
    { value: "bus_stop", label: "Bus stop" },
    { value: "bus_route", label: "Bus route" },
    { value: "map_point", label: "Map point" },
];

/** Reward reason codes; the first two are the recommended choices for an accepted report. */
export const REWARD_REASON_OPTIONS: { value: RewardReasonCode; label: string }[] = [
    { value: "valid_report", label: "Valid report (recommended)" },
    { value: "useful_correction", label: "Useful correction (recommended)" },
    { value: "useful_photo", label: "Useful photo" },
    { value: "admin_adjustment", label: "Admin adjustment" },
    { value: "reversal", label: "Reversal" },
    { value: "spam_penalty", label: "Spam penalty" },
    { value: "false_report_penalty", label: "False report penalty" },
];

const STATUS_BADGE_CLASS: Record<string, string> = {
    submitted: "bg-sky-50 text-sky-800 ring-sky-100",
    in_review: "bg-indigo-50 text-indigo-800 ring-indigo-100",
    needs_more_info: "bg-amber-50 text-amber-900 ring-amber-100",
    accepted: "bg-emerald-50 text-emerald-800 ring-emerald-100",
    rejected: "bg-red-50 text-red-800 ring-red-100",
    duplicate: "bg-gray-100 text-gray-700 ring-gray-200",
};

export function statusBadgeClass(code: string): string {
    return STATUS_BADGE_CLASS[code] ?? "bg-gray-100 text-gray-600 ring-gray-200";
}

export function reportTypeLabel(code: string): string {
    return REPORT_TYPE_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

export function statusLabel(code: string): string {
    return REPORT_STATUS_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

export function targetTypeLabel(code: string | null): string {
    if (!code) return "—";
    return TARGET_ENTITY_TYPE_OPTIONS.find((o) => o.value === code)?.label ?? code;
}

export function formatDateTime(value: string | null): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

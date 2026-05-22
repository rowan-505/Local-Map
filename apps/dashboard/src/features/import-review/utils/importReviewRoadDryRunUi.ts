import type { RoadDryRunItemResult, RoadDryRunItemStatus } from "@/src/lib/api";

export const ROAD_DRY_RUN_STATUS_LABELS: Record<RoadDryRunItemStatus, string> = {
    safe_to_promote: "Safe to promote",
    promote_with_warning: "Promote with warning",
    needs_manual_review: "Needs manual review",
    blocked: "Blocked",
};

export function roadDryRunStatusBadgeClass(status: RoadDryRunItemStatus): string {
    switch (status) {
        case "safe_to_promote":
            return "border-emerald-200 bg-emerald-50 text-emerald-900";
        case "promote_with_warning":
            return "border-amber-200 bg-amber-50 text-amber-950";
        case "needs_manual_review":
            return "border-orange-200 bg-orange-50 text-orange-950";
        case "blocked":
        default:
            return "border-red-200 bg-red-50 text-red-900";
    }
}

export function topIssueCodes(codes: string[], limit = 2): string[] {
    return [...new Set(codes)].slice(0, limit);
}

export function validationIssueCodesFromRow(row: {
    validation_errors?: unknown;
    validation_warnings?: unknown;
}): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const pushCodes = (raw: unknown, bucket: string[]) => {
        if (!Array.isArray(raw)) {
            return;
        }
        for (const item of raw) {
            if (item && typeof item === "object" && !Array.isArray(item)) {
                const code = (item as { code?: unknown }).code;
                if (typeof code === "string" && code.trim()) {
                    bucket.push(code.trim());
                }
            }
        }
    };
    pushCodes(row.validation_errors, errors);
    pushCodes(row.validation_warnings, warnings);
    return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export function mergeDryRunItem(
    row: { id: string },
    itemsByCandidateId: Record<string, RoadDryRunItemResult> | undefined
): RoadDryRunItemResult | null {
    if (!itemsByCandidateId) {
        return null;
    }
    return itemsByCandidateId[row.id] ?? null;
}

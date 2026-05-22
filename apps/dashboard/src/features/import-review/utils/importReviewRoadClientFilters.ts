import type { ImportReviewBuildingListItem, RoadDryRunItemResult, RoadDryRunItemStatus } from "@/src/lib/api";
import {
    mergeDryRunItem,
    validationIssueCodesFromRow,
} from "@/src/features/import-review/utils/importReviewRoadDryRunUi";
import { deriveRoadListRoadClass } from "@/src/features/import-review/utils/importReviewRoadListDisplay";

export type ImportReviewRoadClientFilters = {
    dry_run_status: string;
    warning_code: string;
    error_code: string;
    road_class: string;
    promotion_status: string;
    class_code: string;
};

export const EMPTY_ROAD_CLIENT_FILTERS: ImportReviewRoadClientFilters = {
    dry_run_status: "",
    warning_code: "",
    error_code: "",
    road_class: "",
    promotion_status: "",
    class_code: "",
};

export function filterRoadListItems(args: {
    items: ImportReviewBuildingListItem[];
    clientFilters: ImportReviewRoadClientFilters;
    dryRunByCandidateId?: Record<string, RoadDryRunItemResult>;
    roadClassLabelById: Map<string, string>;
}): ImportReviewBuildingListItem[] {
    const { items, clientFilters, dryRunByCandidateId, roadClassLabelById } = args;

    return items.filter((row) => {
        const dryRun = mergeDryRunItem(row, dryRunByCandidateId);
        const issueCodes = validationIssueCodesFromRow(row);

        if (clientFilters.dry_run_status) {
            const status = dryRun?.dry_run_status ?? "";
            if (status !== clientFilters.dry_run_status) {
                return false;
            }
        }
        if (clientFilters.warning_code) {
            const codes = dryRun?.warning_codes ?? issueCodes.warnings;
            if (!codes.includes(clientFilters.warning_code)) {
                return false;
            }
        }
        if (clientFilters.error_code) {
            const codes = dryRun?.blocking_reasons ?? issueCodes.errors;
            if (!codes.includes(clientFilters.error_code)) {
                return false;
            }
        }
        if (clientFilters.road_class) {
            const label = deriveRoadListRoadClass(row, roadClassLabelById);
            if (label !== clientFilters.road_class) {
                return false;
            }
        }
        if (clientFilters.promotion_status) {
            const ps = (row.promotion_status ?? "").trim();
            if (clientFilters.promotion_status === "__unreviewed__") {
                if (ps !== "") {
                    return false;
                }
            } else if (ps !== clientFilters.promotion_status) {
                return false;
            }
        }
        if (clientFilters.class_code) {
            const cc = (row.class_code ?? "").trim();
            if (cc !== clientFilters.class_code) {
                return false;
            }
        }
        return true;
    });
}

export function collectDryRunStatusOptions(
    itemsByCandidateId: Record<string, RoadDryRunItemResult> | undefined
): RoadDryRunItemStatus[] {
    if (!itemsByCandidateId) {
        return [];
    }
    const set = new Set<RoadDryRunItemStatus>();
    for (const item of Object.values(itemsByCandidateId)) {
        set.add(item.dry_run_status);
    }
    return [...set].sort();
}

export function collectIssueCodeOptions(args: {
    items: ImportReviewBuildingListItem[];
    dryRunByCandidateId?: Record<string, RoadDryRunItemResult>;
    kind: "warning" | "error";
}): string[] {
    const codes = new Set<string>();
    for (const row of args.items) {
        const dryRun = mergeDryRunItem(row, args.dryRunByCandidateId);
        const issueCodes = validationIssueCodesFromRow(row);
        const list =
            args.kind === "warning"
                ? [...(dryRun?.warning_codes ?? []), ...issueCodes.warnings]
                : [...(dryRun?.blocking_reasons ?? []), ...issueCodes.errors];
        for (const code of list) {
            if (code.trim()) {
                codes.add(code.trim());
            }
        }
    }
    return [...codes].sort((a, b) => a.localeCompare(b));
}

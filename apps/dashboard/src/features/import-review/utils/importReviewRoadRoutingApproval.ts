import type {
    ImportReviewBuildingListItem,
    ImportReviewDecision,
    PatchImportReviewBuildingDecisionBody,
} from "@/src/lib/api";
import { validationMessagesFromReviewJson } from "@/src/lib/importReviewValidationMessages";

export type RoadDecisionPatchOptions = {
    force?: boolean;
    confirmDuplicate?: boolean;
    confirmMatchedAutoUpdate?: boolean;
    note?: string | null;
};

export function roadApprovalBlockingErrors(row: ImportReviewBuildingListItem): string[] {
    return validationMessagesFromReviewJson(row.validation_errors);
}

export function buildRoadDecisionPatchBody(args: {
    scopeBody: Pick<
        PatchImportReviewBuildingDecisionBody,
        "review_batch_id" | "source_snapshot_version" | "latest"
    >;
    row: ImportReviewBuildingListItem;
    decision: ImportReviewDecision;
    isRoadFamily: boolean;
    opts?: RoadDecisionPatchOptions;
}): PatchImportReviewBuildingDecisionBody {
    const note =
        args.opts?.note !== undefined ? args.opts.note : args.row.review_note ?? null;

    const body: PatchImportReviewBuildingDecisionBody = {
        ...args.scopeBody,
        review_decision: args.decision,
        review_note: note,
        force: args.opts?.force ?? false,
        confirm_duplicate_reviewed: args.opts?.confirmDuplicate ?? false,
    };

    if (args.isRoadFamily) {
        body.confirm_matched_auto_update = args.opts?.confirmMatchedAutoUpdate ?? false;
    }

    return body;
}

import type {
    RoadCandidatePromotionRow,
    RoadPublishItemRow,
} from "./import-review-promotion-road-dry-run.repo.js";
import type { ImportReviewRoadDryRunSampleError } from "./import-review-road-dry-run-summary.types.js";

const LINE_TYPES = new Set([
    "ST_LINESTRING",
    "ST_MULTILINESTRING",
    "LINESTRING",
    "MULTILINESTRING",
]);

export type RoadDryRunItemCheckInput = {
    item: RoadPublishItemRow;
    candidate: RoadCandidatePromotionRow | null;
    roadClassResolvable: boolean;
    duplicateExternalIdInCore: boolean;
    coreStreetExistsForUpdate: boolean;
};

export function collectRoadDryRunItemErrors(input: RoadDryRunItemCheckInput): string[] {
    const errors: string[] = [];
    const { item, candidate } = input;

    if (item.review_candidate_id == null || candidate == null) {
        errors.push("candidate_missing");
        return errors;
    }

    if (item.publish_action === "protect_manual") {
        errors.push("manual_protected");
    }
    if (candidate.auto_action === "protect_manual" || candidate.auto_action === "manual_protected") {
        errors.push("manual_protected");
    }

    if (!candidate.has_geom) {
        errors.push("geom_missing");
    } else {
        if (candidate.is_valid === false) {
            errors.push("invalid_geom");
        }
        if (candidate.srid != null && candidate.srid !== 4326) {
            errors.push("invalid_srid");
        }
        const gt = candidate.geom_type?.toUpperCase() ?? "";
        if (gt && !LINE_TYPES.has(gt)) {
            errors.push("invalid_geom_type");
        }
    }

    if (!candidate.external_id?.trim()) {
        errors.push("external_id_missing");
    }

    if (!input.roadClassResolvable) {
        errors.push("road_class_unresolved");
    }

    if (item.publish_action === "insert") {
        if (input.duplicateExternalIdInCore) {
            errors.push("duplicate_external_id_in_core");
        }
    } else if (item.publish_action === "update") {
        if (candidate.matched_core_id == null) {
            errors.push("update_target_missing");
        } else if (!input.coreStreetExistsForUpdate) {
            errors.push("update_target_not_in_core");
        }
    } else if (item.publish_action !== "merge") {
        errors.push("unsupported_publish_action");
    }

    return [...new Set(errors)];
}

export function roadDryRunErrorMessage(code: string): string {
    const messages: Record<string, string> = {
        candidate_missing: "Road candidate is missing for this publish item.",
        manual_protected: "Road candidate is manual protected.",
        geom_missing: "Road geometry is missing.",
        invalid_geom: "Road geometry is not valid (ST_IsValid).",
        invalid_srid: "Road geometry must use SRID 4326.",
        invalid_geom_type: "Road geometry must be LineString or MultiLineString.",
        external_id_missing: "external_id is required for promotion.",
        road_class_unresolved: "road_class_id or resolvable road class code is required.",
        duplicate_external_id_in_core: "external_id already exists on an active core street.",
        update_target_missing: "Update action requires matched_core_id on the candidate.",
        update_target_not_in_core: "Update target street was not found in core.core_streets.",
        unsupported_publish_action: "Publish action cannot be promoted.",
    };
    return messages[code] ?? `Road dry-run check failed (${code}).`;
}

export function toRoadDryRunSampleError(args: {
    item: RoadPublishItemRow;
    candidate: RoadCandidatePromotionRow | null;
    code: string;
}): ImportReviewRoadDryRunSampleError {
    return {
        publish_item_id: args.item.publish_item_id.toString(),
        review_candidate_id: args.item.review_candidate_id?.toString() ?? null,
        external_id: args.candidate?.external_id ?? null,
        code: args.code,
        message: roadDryRunErrorMessage(args.code),
    };
}

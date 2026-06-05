import type {
    RoadCandidatePromotionRow,
    RoadPublishItemRow,
} from "./import-review-promotion-road-dry-run.repo.js";
import type { ImportReviewRoadRoutingReadinessSampleIssue } from "./import-review-road-routing-readiness.types.js";

const LINE_TYPES = new Set([
    "ST_LINESTRING",
    "ST_MULTILINESTRING",
    "LINESTRING",
    "MULTILINESTRING",
]);

/** OSM-style access values commonly accepted by routing engines. */
const KNOWN_ACCESS_VALUES = new Set([
    "yes",
    "no",
    "private",
    "destination",
    "customers",
    "delivery",
    "agricultural",
    "forestry",
    "permissive",
    "designated",
    "official",
    "public",
    "restricted",
    "unknown",
]);

const MIN_SPEED_KPH = 1;
const MAX_SPEED_KPH = 250;

export type RoutingReadinessCheckInput = {
    item: RoadPublishItemRow;
    candidate: RoadCandidatePromotionRow | null;
    roadClassIdExists: boolean;
    duplicateExternalIdInCore: boolean;
    coreStreetExistsForUpdate: boolean;
};

export type RoutingReadinessIssueBuckets = {
    errors: string[];
    warnings: string[];
};

function isValidTriStateBool(value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "boolean") {
        return true;
    }
    if (value === 0 || value === 1) {
        return true;
    }
    if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        return v === "" || v === "true" || v === "false" || v === "yes" || v === "no" || v === "0" || v === "1";
    }
    return false;
}

function isValidOneway(value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    return typeof value === "boolean" || value === 0 || value === 1;
}

export function collectRoutingReadinessIssues(input: RoutingReadinessCheckInput): RoutingReadinessIssueBuckets {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { item, candidate } = input;

    if (item.review_candidate_id == null || candidate == null) {
        errors.push("candidate_missing");
        return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
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
        if (candidate.length_m != null && candidate.length_m <= 0) {
            errors.push("zero_length");
        }
    }

    if (!candidate.external_id?.trim()) {
        errors.push("external_id_missing");
    }

    if (candidate.road_class_id == null) {
        errors.push("road_class_id_missing");
    } else if (!input.roadClassIdExists) {
        errors.push("road_class_id_not_in_ref");
    }

    const access = candidate.access?.trim().toLowerCase() ?? "";
    if (access.length > 0 && !KNOWN_ACCESS_VALUES.has(access)) {
        errors.push("invalid_access");
    }

    if (!isValidOneway(candidate.is_oneway)) {
        errors.push("invalid_is_oneway");
    }

    if (candidate.speed_kph != null) {
        const speed = Number(candidate.speed_kph);
        if (!Number.isFinite(speed) || speed < MIN_SPEED_KPH || speed > MAX_SPEED_KPH) {
            errors.push("invalid_speed_kph");
        }
    }

    if (!isValidTriStateBool(candidate.bridge)) {
        errors.push("invalid_bridge");
    }
    if (!isValidTriStateBool(candidate.tunnel)) {
        errors.push("invalid_tunnel");
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

    if (candidate.speed_kph == null) {
        warnings.push("speed_kph_missing");
    }

    return {
        errors: [...new Set(errors)],
        warnings: [...new Set(warnings)],
    };
}

export function routingReadinessErrorMessage(code: string): string {
    const messages: Record<string, string> = {
        candidate_missing: "Road candidate is missing.",
        geom_missing: "Geometry is required for routing readiness.",
        invalid_geom: "Geometry must be valid (ST_IsValid).",
        invalid_srid: "Geometry SRID must be 4326.",
        invalid_geom_type: "Geometry must be LineString or MultiLineString.",
        zero_length: "Geometry length must be greater than zero.",
        external_id_missing: "external_id is required.",
        road_class_id_missing: "road_class_id is required for routing readiness.",
        road_class_id_not_in_ref: "road_class_id is not in ref.ref_road_classes.",
        invalid_access: "access value is not a known routing access tag.",
        invalid_is_oneway: "is_oneway must be boolean or null.",
        invalid_speed_kph: `speed_kph must be between ${MIN_SPEED_KPH} and ${MAX_SPEED_KPH} when set.`,
        invalid_bridge: "bridge must be boolean or a known yes/no value.",
        invalid_tunnel: "tunnel must be boolean or a known yes/no value.",
        duplicate_external_id_in_core: "external_id conflicts with an active core street.",
        update_target_missing: "Update requires matched_core_id.",
        update_target_not_in_core: "Update target not found in core.core_streets.",
        unsupported_publish_action: "Publish action is not supported.",
        speed_kph_missing: "speed_kph is not set (warning only).",
    };
    return messages[code] ?? `Routing readiness check failed (${code}).`;
}

export function toRoutingReadinessSampleIssue(args: {
    item: RoadPublishItemRow;
    candidate: RoadCandidatePromotionRow | null;
    code: string;
    severity: "error" | "warning";
}): ImportReviewRoadRoutingReadinessSampleIssue {
    return {
        publish_item_id: args.item.publish_item_id.toString(),
        review_candidate_id: args.item.review_candidate_id?.toString() ?? null,
        external_id: args.candidate?.external_id ?? null,
        code: args.code,
        message: routingReadinessErrorMessage(args.code),
    };
}

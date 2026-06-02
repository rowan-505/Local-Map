import { Prisma } from "@prisma/client";

/**
 * Error codes on import_review.road_candidates.validation_errors that block promotion eligibility.
 * Attribute gaps (name, surface, speed, lanes, admin, metadata) belong in validation_warnings only.
 */
export const ROAD_PROMOTION_BLOCKING_ERROR_CODES = [
    "GEOMETRY_MISSING",
    "GEOMETRY_INVALID",
    "GEOMETRY_EMPTY",
    "INVALID_GEOMETRY_TYPE",
    "INVALID_SRID",
    "INVALID_COORDINATES",
    "ROAD_CLASS_MISSING",
    "DUPLICATE_EXTERNAL_ID_IN_CORE",
] as const;

export type RoadPromotionBlockingErrorCode = (typeof ROAD_PROMOTION_BLOCKING_ERROR_CODES)[number];

const BLOCKING_CODE_SET = new Set<string>(ROAD_PROMOTION_BLOCKING_ERROR_CODES);

/** Codes that must never block promotion (stored in validation_errors historically). */
export const ROAD_PROMOTION_NON_BLOCKING_ERROR_CODES = [
    "ROAD_TOO_SHORT",
    "OUTSIDE_REVIEW_BOUNDARY",
    "INVALID_ROAD_CLASS_ID",
    "NAME_MISSING",
    "SURFACE_MISSING",
    "SPEED_KPH_MISSING",
    "ACCESS_MISSING",
    "LANES_MISSING",
    "MISSING_LINEAGE",
    "EMPTY_SOURCE_REFS",
    "EMPTY_NORMALIZED_DATA",
    "LOW_CONFIDENCE",
    "ADMIN_AREA_MISSING",
] as const;

export function isRoadPromotionBlockingErrorCode(code: string): boolean {
    return BLOCKING_CODE_SET.has(code.trim().toUpperCase());
}

export function roadStoredValidationHasPromotionBlockers(validationErrors: unknown): boolean {
    if (!Array.isArray(validationErrors)) {
        return false;
    }
    return validationErrors.some((issue) => isRoadPromotionBlockingStoredIssue(issue));
}

export function isRoadPromotionBlockingStoredIssue(issue: unknown): boolean {
    if (issue === null || issue === undefined) {
        return false;
    }
    if (typeof issue === "string") {
        const trimmed = issue.trim();
        return trimmed.length > 0 && isRoadPromotionBlockingErrorCode(trimmed);
    }
    if (typeof issue !== "object" || Array.isArray(issue)) {
        return false;
    }
    const row = issue as { code?: unknown; severity?: unknown };
    const severity = typeof row.severity === "string" ? row.severity.trim().toLowerCase() : "error";
    if (severity !== "error") {
        return false;
    }
    const code = typeof row.code === "string" ? row.code.trim().toUpperCase() : "";
    if (code === "") {
        return true;
    }
    return isRoadPromotionBlockingErrorCode(code);
}

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

/** True when validation_errors contains at least one promotion-blocking issue. */
export function hasRoadPromotionBlockingErrorsSql(alias: string): Prisma.Sql {
    const errors = col(alias, "validation_errors");
    const codes = ROAD_PROMOTION_BLOCKING_ERROR_CODES.map((c) => Prisma.sql`${c}`);
    return Prisma.sql`(
        EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(${errors}, '[]'::jsonb)) AS issue
            WHERE jsonb_typeof(issue) = 'object'
              AND coalesce(issue->>'severity', 'error') = 'error'
              AND upper(coalesce(issue->>'code', '')) IN (${Prisma.join(codes)})
        )
        OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(${errors}, '[]'::jsonb)) AS issue
            WHERE jsonb_typeof(issue) = 'string'
              AND upper(trim(both '"' from issue::text)) IN (${Prisma.join(codes)})
        )
    )`;
}

/** Insert candidates blocked when the same external_id already exists on core.core_streets. */
export function roadDuplicateCoreExternalIdSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "external_id")} IS NOT NULL
        AND trim(${col(alias, "external_id")}) <> ''
        AND ${col(alias, "matched_core_id")} IS NULL
        AND EXISTS (
            SELECT 1
            FROM core.core_streets AS cs
            WHERE cs.external_id = ${col(alias, "external_id")}
              AND coalesce(cs.is_active, true)
              AND cs.deleted_at IS NULL
        )
    )`;
}

/** No resolvable road class: missing road_class_id and no OSM highway / class_code fallback. */
export function roadClassMissingWithoutFallbackSql(alias: string): Prisma.Sql {
    return Prisma.sql`(
        ${col(alias, "road_class_id")} IS NULL
        AND nullif(trim(coalesce(${col(alias, "class_code")}, '')), '') IS NULL
        AND nullif(trim(coalesce(${col(alias, "normalized_data")}->>'highway', '')), '') IS NULL
    )`;
}

export function hasRoadCandidateValidationErrorsSql(alias: string): Prisma.Sql {
    const errors = col(alias, "validation_errors");
    return Prisma.sql`(
        ${errors} IS NOT NULL
        AND jsonb_typeof(${errors}) = 'array'
        AND jsonb_array_length(${errors}) > 0
    )`;
}

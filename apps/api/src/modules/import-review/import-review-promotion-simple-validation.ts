/**
 * Readable promotion validation using typed candidate columns only.
 *
 * @see docs/import-review/direct-edit-promotion-contract.md
 * @see import-review-promotion-simple-config.ts
 *
 * Not wired into live promotion yet — call {@link validateSimplePromotionCandidate} explicitly.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import {
    assertPromotableFamily,
    getPromotionFamilyConfig,
    type ImportReviewSimplePromotionFamily,
    type ImportReviewSimplePromotionFamilyConfig,
    type PromotionGeometrySpec,
    type PromotionGeometryType,
} from "./import-review-promotion-simple-config.js";
import {
    buildPromotionValidationGeometrySelectSql,
    listPromotionValidationScalarColumnNames,
    promotionValidationGeometryMetricsKind,
} from "./import-review-promotion-simple-validation-sql.js";

export type SimplePromotionValidationStatus = "ready" | "warning" | "blocked";

export type SimplePromotionValidationIssue = {
    code: string;
    message: string;
    field?: string;
};

export type SimplePromotionValidationResult = {
    status: SimplePromotionValidationStatus;
    errors: SimplePromotionValidationIssue[];
    warnings: SimplePromotionValidationIssue[];
};

export type SimplePromotionValidationInput = {
    family: string;
    candidateId: bigint;
    reviewBatchId: bigint;
};

/** Geometry diagnostics from PostGIS scalar projections (loader); never raw geometry. */
export type SimplePromotionGeometryDiagnostics = {
    present: boolean;
    valid: boolean | null;
    srid: number | null;
    type: string | null;
    empty: boolean | null;
    /** ST_Length(geography) for line families. */
    lengthM?: number | null;
    /** ST_Area(geography) for polygon families. */
    areaM2?: number | null;
};

export type SimplePromotionCandidateValidationRow = Record<string, unknown> & {
    id: bigint;
    review_batch_id: bigint;
    review_status: string | null;
    review_decision: string | null;
    promotion_status: string | null;
    promoted_core_id: bigint | null;
    match_status?: string | null;
    auto_action?: string | null;
    review_note?: string | null;
    confidence_score?: number | null;
    external_id?: string | null;
    local_staging_id?: string | null;
    source_refs?: unknown;
    geomDiagnostics?: SimplePromotionGeometryDiagnostics | null;
};

export type SimplePromotionValidationContext = {
    /** FK column → row exists in ref/core table. */
    fkExistsByColumn?: Readonly<Record<string, boolean>>;
    /** Routing barrier dry-run style counts (optional). */
    nearbyCoreRoads?: number | null;
    /** Insert action: active core row already exists for external_id. */
    insertTargetConflict?: boolean;
};

const GLOBAL_REVIEW_FIELDS = ["review_status", "review_decision"] as const;
const LINEAGE_FIELDS = ["external_id", "local_staging_id", "source_refs"] as const;

const LOW_CONFIDENCE_THRESHOLD = 40;

/** Matches legacy publish validation admin-area area guard (m²). */
const MIN_POLYGON_AREA_M2 = 100;
const MAX_POLYGON_AREA_M2 = 100_000_000_000;
const MIN_LINE_LENGTH_M = 1;
const MAX_LINE_LENGTH_M = 500_000;

const PROMOTABLE_ADDRESS_STRENGTHS = new Set(["partial", "strong", "full"]);

/** Common OSM surface values — warn when typed surface is non-empty but unrecognized. */
const KNOWN_ROAD_SURFACES = new Set([
    "paved",
    "unpaved",
    "asphalt",
    "concrete",
    "paving_stones",
    "sett",
    "cobblestone",
    "metal",
    "wood",
    "compacted",
    "fine_gravel",
    "gravel",
    "pebblestone",
    "ground",
    "dirt",
    "earth",
    "grass",
    "mud",
    "sand",
    "woodchips",
    "snow",
    "ice",
    "salt",
]);

const KNOWN_ROAD_ACCESS = new Set([
    "yes",
    "no",
    "private",
    "permissive",
    "destination",
    "customers",
    "delivery",
    "agricultural",
    "forestry",
    "discouraged",
    "unknown",
]);

const OPTIONAL_ADMIN_AREA_WARNING_FAMILIES = new Set<ImportReviewSimplePromotionFamily>([
    "buildings",
    "roads",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const t = value.trim();
    return t === "" ? null : t;
}

function bigintOrNull(value: unknown): bigint | null {
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        return BigInt(value.trim());
    }
    return null;
}

function numberOrNull(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return null;
}

function sourceRefsNonempty(sourceRefs: unknown): boolean {
    if (sourceRefs === null || sourceRefs === undefined) {
        return false;
    }
    if (typeof sourceRefs === "string") {
        const t = sourceRefs.trim();
        if (t === "" || t === "{}") {
            return false;
        }
        try {
            const parsed: unknown = JSON.parse(t);
            return sourceRefsNonempty(parsed);
        } catch {
            return true;
        }
    }
    if (Array.isArray(sourceRefs)) {
        return sourceRefs.length > 0;
    }
    if (isRecord(sourceRefs)) {
        return Object.keys(sourceRefs).length > 0;
    }
    return true;
}

function hasLineage(row: SimplePromotionCandidateValidationRow): boolean {
    if (trimString(row.external_id) !== null) {
        return true;
    }
    if (trimString(row.local_staging_id) !== null) {
        return true;
    }
    return sourceRefsNonempty(row.source_refs);
}

/** Source display names from source_refs only (no normalized_data). */
export function extractSourceDisplayNamesFromRefs(sourceRefs: unknown): {
    name: string | null;
    nameEn: string | null;
    nameMm: string | null;
} {
    if (!isRecord(sourceRefs)) {
        return { name: null, nameEn: null, nameMm: null };
    }
    const directName = trimString(sourceRefs.source_name);
    const tags = isRecord(sourceRefs.tags) ? sourceRefs.tags : null;
    const tagName = tags ? trimString(tags.name) : null;
    const tagEn = tags ? trimString(tags["name:en"]) : null;
    const tagMm =
        tags ?
            trimString(tags["name:my"]) ?? trimString(tags["name:mm"]) ?? trimString(tags["name:my-MM"])
        :   null;
    return {
        name: directName ?? tagName,
        nameEn: tagEn,
        nameMm: tagMm,
    };
}

function hasTypedDisplayName(row: SimplePromotionCandidateValidationRow, fields: readonly string[]): boolean {
    for (const field of fields) {
        if (trimString(row[field]) !== null) {
            return true;
        }
    }
    return false;
}

function isScalarEmpty(value: unknown): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "string") {
        return value.trim() === "";
    }
    return false;
}

function allowedGeometryTypes(spec: PromotionGeometrySpec): readonly PromotionGeometryType[] {
    return typeof spec.requiredType === "string" ? [spec.requiredType] : spec.requiredType;
}

function normalizeGeomType(type: string | null): string | null {
    if (type === null) {
        return null;
    }
    const t = type.trim();
    if (t.startsWith("ST_")) {
        return t.slice(3);
    }
    return t;
}

export function resolveSimplePromotionValidationStatus(
    errors: SimplePromotionValidationIssue[],
    warnings: SimplePromotionValidationIssue[]
): SimplePromotionValidationStatus {
    if (errors.length > 0) {
        return "blocked";
    }
    if (warnings.length > 0) {
        return "warning";
    }
    return "ready";
}

function pushError(
    errors: SimplePromotionValidationIssue[],
    code: string,
    message: string,
    field?: string
): void {
    errors.push({ code, message, ...(field !== undefined ? { field } : {}) });
}

function pushWarning(
    warnings: SimplePromotionValidationIssue[],
    code: string,
    message: string,
    field?: string
): void {
    warnings.push({ code, message, ...(field !== undefined ? { field } : {}) });
}

function validateReviewApproval(
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[]
): void {
    const status = trimString(row.review_status);
    const decision = trimString(row.review_decision);
    const writeOk =
        status === "approved" &&
        [
            "approved",
            "replace_existing",
            "merge_fields",
            "insert_separate",
            "confirm_soft_delete",
        ].includes(decision);
    const skipOk =
        ["ignored", "merged", "approved"].includes(status) &&
        ["keep_existing", "ignore_import", "mark_duplicate", "merged"].includes(decision);
    if (!writeOk && !skipOk) {
        pushError(
            errors,
            "review_not_approved",
            "Candidate must have an Apply-batch review_decision with matching review_status.",
            "review_status"
        );
    }
}

function validateAlreadyPromoted(
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[]
): void {
    if (trimString(row.promotion_status) === "promoted" || row.promoted_core_id !== null) {
        pushError(errors, "already_promoted", "Candidate is already promoted.", "promotion_status");
    }
}

function validateManualProtected(
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[]
): void {
    const matchStatus = trimString(row.match_status);
    const autoAction = trimString(row.auto_action);
    const decision = trimString(row.review_decision);
    if (
        (matchStatus === "manual_protected" || autoAction === "protect_manual") &&
        !decision
    ) {
        pushError(
            errors,
            "manual_protected",
            "Candidate is manual protected and cannot be promoted.",
            "match_status"
        );
    }
}

function validateInsertTargetConflict(
    ctx: SimplePromotionValidationContext,
    errors: SimplePromotionValidationIssue[]
): void {
    if (ctx.insertTargetConflict === true) {
        pushError(
            errors,
            "target_conflict",
            "An active core row already exists for this external_id (insert action).",
            "external_id"
        );
    }
}

function validateConfidenceScore(
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[],
    warnings: SimplePromotionValidationIssue[]
): void {
    const score = numberOrNull(row.confidence_score);
    if (score === null) {
        return;
    }
    if (score < 0 || score > 100) {
        pushError(
            errors,
            "invalid_confidence",
            "confidence_score must be between 0 and 100 when set.",
            "confidence_score"
        );
        return;
    }
    if (score < LOW_CONFIDENCE_THRESHOLD) {
        pushWarning(
            warnings,
            "low_confidence",
            `confidence_score is below ${LOW_CONFIDENCE_THRESHOLD}.`,
            "confidence_score"
        );
    }
}

function validateLineage(
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[],
    warnings: SimplePromotionValidationIssue[]
): void {
    if (!hasLineage(row)) {
        pushError(
            errors,
            "missing_lineage",
            "Candidate must have external_id, local_staging_id, or non-empty source_refs.",
            "source_refs"
        );
        return;
    }
    if (trimString(row.external_id) !== null && !sourceRefsNonempty(row.source_refs)) {
        pushWarning(
            warnings,
            "weak_lineage",
            "external_id is set but source_refs is empty.",
            "source_refs"
        );
    }
}

function validateScalarRequiredFields(
    config: ImportReviewSimplePromotionFamilyConfig,
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[]
): void {
    const skip = new Set<string>([
        ...GLOBAL_REVIEW_FIELDS,
        ...LINEAGE_FIELDS,
        ...(config.geometry ? [config.geometry.column] : []),
    ]);

    for (const field of config.requiredFields) {
        if (skip.has(field)) {
            continue;
        }
        if (isScalarEmpty(row[field])) {
            pushError(
                errors,
                "required_field_missing",
                `Typed column ${field} is required for promotion.`,
                field
            );
        }
    }
}

function validateGeometry(
    config: ImportReviewSimplePromotionFamilyConfig,
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[]
): void {
    const spec = config.geometry;
    if (!spec) {
        return;
    }
    const diag = row.geomDiagnostics;
    const field = spec.column;

    if (!diag?.present) {
        pushError(errors, "geometry_missing", `Typed ${field} is required for promotion.`, field);
        return;
    }
    if (diag.empty === true) {
        pushError(errors, "geometry_empty", `Typed ${field} must not be empty.`, field);
    }
    if (diag.valid === false) {
        pushError(errors, "geometry_invalid", `Typed ${field} is not valid PostGIS geometry.`, field);
    }
    if (diag.srid !== null && diag.srid !== spec.srid) {
        pushError(
            errors,
            "invalid_srid",
            `Typed ${field} must use SRID ${spec.srid}.`,
            field
        );
    }
    const actualType = normalizeGeomType(diag.type);
    const allowed = allowedGeometryTypes(spec);
    if (actualType !== null && !allowed.includes(actualType as PromotionGeometryType)) {
        pushError(
            errors,
            "invalid_geometry_type",
            `Typed ${field} must be ${allowed.join(" or ")}.`,
            field
        );
    }
}

function validateGeometryMetrics(
    config: ImportReviewSimplePromotionFamilyConfig,
    row: SimplePromotionCandidateValidationRow,
    warnings: SimplePromotionValidationIssue[]
): void {
    const spec = config.geometry;
    const diag = row.geomDiagnostics;
    if (!spec || !diag?.present) {
        return;
    }

    const field = spec.column;
    const kind = promotionValidationGeometryMetricsKind(spec);

    if (kind === "line" && diag.lengthM !== null && diag.lengthM !== undefined) {
        if (diag.lengthM < MIN_LINE_LENGTH_M) {
            pushWarning(
                warnings,
                "line_too_short",
                `Geometry length is very short (< ${MIN_LINE_LENGTH_M} m).`,
                field
            );
        } else if (diag.lengthM > MAX_LINE_LENGTH_M) {
            pushWarning(
                warnings,
                "line_very_long",
                `Geometry length is unusually long (> ${MAX_LINE_LENGTH_M} m).`,
                field
            );
        }
    }

    if (kind === "polygon" && diag.areaM2 !== null && diag.areaM2 !== undefined) {
        const unusual = diag.areaM2 < MIN_POLYGON_AREA_M2 || diag.areaM2 > MAX_POLYGON_AREA_M2;
        if (!unusual) {
            return;
        }
        if (config.family === "admin_areas") {
            pushWarning(
                warnings,
                "geometry_area_unusual_for_admin_level",
                "Admin area geometry area is unusually small or large for its admin level.",
                field
            );
            return;
        }
        pushWarning(
            warnings,
            "geometry_area_unusual",
            "Geometry area is unusually small or large for promotion.",
            field
        );
    }
}

function validateForeignKeys(
    config: ImportReviewSimplePromotionFamilyConfig,
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[],
    ctx: SimplePromotionValidationContext
): void {
    const fkMap = ctx.fkExistsByColumn ?? {};

    for (const check of config.fkChecks) {
        const raw = row[check.column];
        if (isScalarEmpty(raw)) {
            continue;
        }
        const id = bigintOrNull(raw);
        if (id === null) {
            pushError(
                errors,
                "invalid_fk_value",
                `${check.column} must be a numeric id.`,
                check.column
            );
            continue;
        }
        const exists = fkMap[check.column];
        if (exists === false) {
            pushError(
                errors,
                "fk_not_found",
                `${check.column}=${id.toString()} was not found in ${check.refSchema}.${check.refTable}.`,
                check.column
            );
        }
    }
}

function validateOptionalAdminAreaWarning(
    family: ImportReviewSimplePromotionFamily,
    row: SimplePromotionCandidateValidationRow,
    warnings: SimplePromotionValidationIssue[]
): void {
    if (!OPTIONAL_ADMIN_AREA_WARNING_FAMILIES.has(family)) {
        return;
    }
    if (family === "places") {
        return;
    }
    if (isScalarEmpty(row.admin_area_id)) {
        pushWarning(
            warnings,
            "admin_area_id_missing",
            "admin_area_id is not set on typed columns.",
            "admin_area_id"
        );
    }
}

function validateDisplayNameWarnings(
    config: ImportReviewSimplePromotionFamilyConfig,
    row: SimplePromotionCandidateValidationRow,
    warnings: SimplePromotionValidationIssue[]
): void {
    const nameFields = config.warningFields.filter((f) =>
        ["name_en", "name_mm", "primary_name", "display_name", "canonical_name", "full_address"].includes(f)
    );
    if (nameFields.length === 0) {
        return;
    }
    if (hasTypedDisplayName(row, nameFields)) {
        return;
    }
    pushWarning(
        warnings,
        "missing_display_name",
        "No typed display name is set on candidate columns.",
        nameFields[0]
    );

    if (config.allowSourceNameFallback) {
        const source = extractSourceDisplayNamesFromRefs(row.source_refs);
        if (source.name !== null || source.nameEn !== null || source.nameMm !== null) {
            pushWarning(
                warnings,
                "source_fallback_name_available",
                "Source name exists in source_refs but typed display names are empty.",
                nameFields[0]
            );
        }
    }
}

function validateRoadSurfaceAccess(
    family: ImportReviewSimplePromotionFamily,
    row: SimplePromotionCandidateValidationRow,
    warnings: SimplePromotionValidationIssue[]
): void {
    if (family !== "roads") {
        return;
    }
    const surface = trimString(row.surface);
    if (surface !== null) {
        const normalized = surface.toLowerCase();
        if (!KNOWN_ROAD_SURFACES.has(normalized)) {
            pushWarning(
                warnings,
                "unknown_road_surface",
                `Typed surface value "${surface}" is not a known surface.`,
                "surface"
            );
        }
    }
    const access = trimString(row.access);
    if (access !== null) {
        const normalized = access.toLowerCase();
        if (!KNOWN_ROAD_ACCESS.has(normalized)) {
            pushWarning(
                warnings,
                "unknown_road_access",
                `Typed access value "${access}" is not a known access.`,
                "access"
            );
        }
    }
}

function validateBarrierNearRoad(
    family: ImportReviewSimplePromotionFamily,
    ctx: SimplePromotionValidationContext,
    warnings: SimplePromotionValidationIssue[]
): void {
    if (family !== "routing_barriers") {
        return;
    }
    if (ctx.nearbyCoreRoads === null || ctx.nearbyCoreRoads === undefined) {
        return;
    }
    if (ctx.nearbyCoreRoads <= 0) {
        pushWarning(
            warnings,
            "barrier_not_near_road",
            "Barrier point is not within threshold of a core street.",
            "point_geom"
        );
    }
}

function validateFamilySpecific(
    family: ImportReviewSimplePromotionFamily,
    row: SimplePromotionCandidateValidationRow,
    errors: SimplePromotionValidationIssue[],
    warnings: SimplePromotionValidationIssue[]
): void {
    if (family === "admin_areas") {
        const hasName =
            hasTypedDisplayName(row, ["name_mm", "name_en", "canonical_name"]);
        if (!hasName) {
            pushError(
                errors,
                "missing_admin_name",
                "At least one typed name (name_mm, name_en, or canonical_name) is required.",
                "name_en"
            );
        }
        if (!sourceRefsNonempty(row.source_refs)) {
            pushError(
                errors,
                "empty_source_refs",
                "source_refs must be non-empty for admin area promotion.",
                "source_refs"
            );
        }
    }

    if (family === "addresses") {
        const validationStatus = trimString(row.validation_status);
        if (validationStatus === "blocked" || validationStatus === "failed") {
            pushError(
                errors,
                "validation_blocked",
                "Address validation_status blocks promotion.",
                "validation_status"
            );
        }
        const strength = trimString(row.address_strength);
        if (strength === null || !PROMOTABLE_ADDRESS_STRENGTHS.has(strength)) {
            pushError(
                errors,
                "address_strength_not_promotable",
                "address_strength must be partial, strong, or full.",
                "address_strength"
            );
        }
        const blockers = row.promotion_blockers;
        if (Array.isArray(blockers) && blockers.length > 0) {
            pushError(
                errors,
                "promotion_blockers_present",
                "promotion_blockers must be empty before promotion.",
                "promotion_blockers"
            );
        }
    }
}

/**
 * Pure validation against a loaded candidate row (unit-test friendly).
 */
export function validateSimplePromotionCandidateRow(
    config: ImportReviewSimplePromotionFamilyConfig,
    row: SimplePromotionCandidateValidationRow,
    ctx: SimplePromotionValidationContext = {}
): SimplePromotionValidationResult {
    const errors: SimplePromotionValidationIssue[] = [];
    const warnings: SimplePromotionValidationIssue[] = [];

    validateReviewApproval(row, errors);
    validateAlreadyPromoted(row, errors);
    validateManualProtected(row, errors);

    const decision = trimString(row.review_decision);
    const isSkipDecision =
        decision === "keep_existing" ||
        decision === "ignore_import" ||
        decision === "mark_duplicate" ||
        decision === "merged";

    if (isSkipDecision) {
        // Skip Apply: no core typed-field / geometry write requirements.
        return {
            status: resolveSimplePromotionValidationStatus(errors, warnings),
            errors,
            warnings,
        };
    }

    validateInsertTargetConflict(ctx, errors);
    validateConfidenceScore(row, errors, warnings);
    validateLineage(row, errors, warnings);
    validateScalarRequiredFields(config, row, errors);
    validateGeometry(config, row, errors);
    validateGeometryMetrics(config, row, warnings);
    validateForeignKeys(config, row, errors, ctx);
    validateOptionalAdminAreaWarning(config.family, row, warnings);
    validateDisplayNameWarnings(config, row, warnings);
    validateRoadSurfaceAccess(config.family, row, warnings);
    validateBarrierNearRoad(config.family, ctx, warnings);
    validateFamilySpecific(config.family, row, errors, warnings);

    return {
        status: resolveSimplePromotionValidationStatus(errors, warnings),
        errors,
        warnings,
    };
}

function candidateTableParts(qualified: string): { schema: string; table: string } {
    const dot = qualified.indexOf(".");
    if (dot <= 0) {
        throw new Error(`Invalid candidate table: ${qualified}`);
    }
    return {
        schema: qualified.slice(0, dot),
        table: qualified.slice(dot + 1),
    };
}

type LoadedCandidateDbRow = Record<string, unknown> & {
    has_geom: boolean;
    geom_is_valid: boolean | null;
    geom_srid: number | null;
    geom_type: string | null;
    geom_is_empty: boolean | null;
    geom_length_m: number | null;
    geom_area_m2: number | null;
};

export function mapLoadedCandidateDbRow(
    raw: LoadedCandidateDbRow,
    fallbackId: bigint,
    fallbackReviewBatchId: bigint
): SimplePromotionCandidateValidationRow {
    const {
        has_geom,
        geom_is_valid,
        geom_srid,
        geom_type,
        geom_is_empty,
        geom_length_m,
        geom_area_m2,
        ...rest
    } = raw;

    return {
        ...rest,
        id: bigintOrNull(rest.id) ?? fallbackId,
        review_batch_id: bigintOrNull(rest.review_batch_id) ?? fallbackReviewBatchId,
        review_status: trimString(rest.review_status),
        review_decision: trimString(rest.review_decision),
        promotion_status: trimString(rest.promotion_status),
        promoted_core_id: bigintOrNull(rest.promoted_core_id),
        match_status: trimString(rest.match_status),
        auto_action: trimString(rest.auto_action),
        review_note: trimString(rest.review_note),
        confidence_score: numberOrNull(rest.confidence_score),
        external_id: trimString(rest.external_id),
        local_staging_id: trimString(rest.local_staging_id),
        geomDiagnostics: {
            present: Boolean(has_geom),
            valid: geom_is_valid === null ? null : Boolean(geom_is_valid),
            srid: geom_srid === null ? null : Number(geom_srid),
            type: geom_type === null ? null : String(geom_type),
            empty: geom_is_empty === null ? null : Boolean(geom_is_empty),
            lengthM: numberOrNull(geom_length_m),
            areaM2: numberOrNull(geom_area_m2),
        },
    };
}

export class ImportReviewSimplePromotionValidationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async loadCandidateRow(
        config: ImportReviewSimplePromotionFamilyConfig,
        candidateId: bigint,
        reviewBatchId: bigint
    ): Promise<SimplePromotionCandidateValidationRow | null> {
        const { schema, table } = candidateTableParts(config.candidateTable);
        const tableIdent = Prisma.raw(`${schema}.${table}`);
        const scalarColumns = listPromotionValidationScalarColumnNames(config);
        const selectCols = scalarColumns.map((c) => Prisma.raw(c));
        const geomSql = buildPromotionValidationGeometrySelectSql(config);

        const rows = await this.prisma.$queryRaw<LoadedCandidateDbRow[]>`
            SELECT
                ${Prisma.join(selectCols.map((c) => Prisma.sql`${tableIdent}.${c}`), ", ")},
                ${geomSql}
            FROM ${tableIdent}
            WHERE ${tableIdent}.id = ${candidateId}
              AND ${tableIdent}.review_batch_id = ${reviewBatchId}
            LIMIT 1
        `;
        const raw = rows[0];
        if (!raw) {
            return null;
        }

        return mapLoadedCandidateDbRow(raw, candidateId, reviewBatchId);
    }

    async loadCandidateRowsBatch(
        config: ImportReviewSimplePromotionFamilyConfig,
        candidateIds: readonly bigint[],
        reviewBatchId: bigint
    ): Promise<Map<string, SimplePromotionCandidateValidationRow>> {
        const map = new Map<string, SimplePromotionCandidateValidationRow>();
        if (candidateIds.length === 0) {
            return map;
        }

        const { schema, table } = candidateTableParts(config.candidateTable);
        const tableIdent = Prisma.raw(`${schema}.${table}`);
        const scalarColumns = listPromotionValidationScalarColumnNames(config);
        const selectCols = scalarColumns.map((c) => Prisma.raw(c));
        const geomSql = buildPromotionValidationGeometrySelectSql(config);

        const rows = await this.prisma.$queryRaw<LoadedCandidateDbRow[]>`
            SELECT
                ${Prisma.join(selectCols.map((c) => Prisma.sql`${tableIdent}.${c}`), ", ")},
                ${geomSql}
            FROM ${tableIdent}
            WHERE ${tableIdent}.review_batch_id = ${reviewBatchId}
              AND ${tableIdent}.id IN (${Prisma.join(candidateIds)})
        `;

        for (const raw of rows) {
            const id = bigintOrNull(raw.id);
            if (id === null) {
                continue;
            }
            map.set(id.toString(), mapLoadedCandidateDbRow(raw, id, reviewBatchId));
        }
        return map;
    }

    async resolveFkExistence(
        config: ImportReviewSimplePromotionFamilyConfig,
        row: SimplePromotionCandidateValidationRow
    ): Promise<Record<string, boolean>> {
        const out: Record<string, boolean> = {};
        for (const check of config.fkChecks) {
            const raw = row[check.column];
            if (isScalarEmpty(raw)) {
                continue;
            }
            const id = bigintOrNull(raw);
            if (id === null) {
                out[check.column] = false;
                continue;
            }
            const refCol = check.refColumn ?? "id";
            const refTable = Prisma.raw(`${check.refSchema}.${check.refTable}`);
            const refColumn = Prisma.raw(refCol);
            const fkRows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
                SELECT EXISTS (
                    SELECT 1
                    FROM ${refTable}
                    WHERE ${refTable}.${refColumn} = ${id}
                ) AS exists
            `;
            out[check.column] = Boolean(fkRows[0]?.exists);
        }
        return out;
    }

    /**
     * Batch FK existence for many rows: one IN query per FK column (not per row).
     */
    async resolveFkExistenceBatch(
        config: ImportReviewSimplePromotionFamilyConfig,
        rows: readonly SimplePromotionCandidateValidationRow[]
    ): Promise<Map<string, Record<string, boolean>>> {
        const perRow = new Map<string, Record<string, boolean>>();
        for (const row of rows) {
            perRow.set(row.id.toString(), {});
        }

        for (const check of config.fkChecks) {
            const ids = new Set<bigint>();
            for (const row of rows) {
                const raw = row[check.column];
                if (isScalarEmpty(raw)) {
                    continue;
                }
                const id = bigintOrNull(raw);
                if (id !== null) {
                    ids.add(id);
                }
            }
            if (ids.size === 0) {
                continue;
            }

            const refCol = check.refColumn ?? "id";
            const refTable = Prisma.raw(`${check.refSchema}.${check.refTable}`);
            const refColumn = Prisma.raw(refCol);
            const idList = [...ids];
            const existingRows = await this.prisma.$queryRaw<{ ref_id: bigint }[]>`
                SELECT ${refTable}.${refColumn} AS ref_id
                FROM ${refTable}
                WHERE ${refTable}.${refColumn} IN (${Prisma.join(idList)})
            `;
            const existing = new Set(existingRows.map((r) => r.ref_id.toString()));

            for (const row of rows) {
                const raw = row[check.column];
                if (isScalarEmpty(raw)) {
                    continue;
                }
                const id = bigintOrNull(raw);
                if (id === null) {
                    const entry = perRow.get(row.id.toString())!;
                    entry[check.column] = false;
                    continue;
                }
                const entry = perRow.get(row.id.toString())!;
                entry[check.column] = existing.has(id.toString());
            }
        }

        return perRow;
    }

    async countNearbyCoreRoadsForBarrier(
        row: SimplePromotionCandidateValidationRow,
        thresholdM = 30
    ): Promise<number | null> {
        const map = await this.countNearbyCoreRoadsForBarriersBatch([row.id], thresholdM);
        const count = map.get(row.id.toString());
        return count === undefined ? null : count;
    }

    /** One query per chunk: candidate_id → nearby core street count (scalar count only). */
    async countNearbyCoreRoadsForBarriersBatch(
        candidateIds: readonly bigint[],
        thresholdM = 30
    ): Promise<Map<string, number>> {
        const out = new Map<string, number>();
        if (candidateIds.length === 0) {
            return out;
        }

        const rows = await this.prisma.$queryRaw<{ candidate_id: bigint; nearby_count: bigint }[]>`
            SELECT
                c.id AS candidate_id,
                count(r.id)::bigint AS nearby_count
            FROM import_review.routing_barrier_candidates AS c
            LEFT JOIN core.core_streets AS r
              ON r.geom IS NOT NULL
             AND c.point_geom IS NOT NULL
             AND ST_DWithin(
                 r.geom::geography,
                 c.point_geom::geography,
                 ${thresholdM}::double precision
             )
            WHERE c.id IN (${Prisma.join(candidateIds)})
            GROUP BY c.id
        `;

        for (const row of rows) {
            out.set(row.candidate_id.toString(), Number(row.nearby_count ?? 0n));
        }
        for (const id of candidateIds) {
            const key = id.toString();
            if (!out.has(key)) {
                out.set(key, 0);
            }
        }
        return out;
    }

    /**
     * Batch insert-action conflict: external_id already exists on active core target row.
     */
    async resolveInsertTargetConflictsBatch(
        config: ImportReviewSimplePromotionFamilyConfig,
        rows: readonly SimplePromotionCandidateValidationRow[],
        targets: readonly { review_candidate_id: bigint; publish_action?: string | null }[]
    ): Promise<Map<string, boolean>> {
        const out = new Map<string, boolean>();
        const targetByCandidate = new Map(
            targets.map((t) => [t.review_candidate_id.toString(), t] as const)
        );

        const externalIds: string[] = [];
        const candidateKeys: string[] = [];

        for (const row of rows) {
            const target = targetByCandidate.get(row.id.toString());
            const action = trimString(target?.publish_action);
            const externalId = trimString(row.external_id);
            if (action !== "insert" || externalId === null) {
                continue;
            }
            externalIds.push(externalId);
            candidateKeys.push(row.id.toString());
        }

        if (externalIds.length === 0) {
            return out;
        }

        const coreTable = Prisma.raw(`${config.targetSchema}.${config.targetTable}`);
        const existing = await this.prisma.$queryRaw<{ external_id: string }[]>`
            SELECT DISTINCT external_id
            FROM ${coreTable}
            WHERE external_id IN (${Prisma.join(externalIds)})
        `;
        const existingSet = new Set(existing.map((r) => r.external_id));

        for (const row of rows) {
            const key = row.id.toString();
            const target = targetByCandidate.get(key);
            const action = trimString(target?.publish_action);
            const externalId = trimString(row.external_id);
            if (action !== "insert" || externalId === null) {
                continue;
            }
            out.set(key, existingSet.has(externalId));
        }

        return out;
    }
}

export async function validateSimplePromotionCandidate(
    input: SimplePromotionValidationInput,
    prisma: PrismaClient
): Promise<SimplePromotionValidationResult> {
    assertPromotableFamily(input.family);
    const config = getPromotionFamilyConfig(input.family);
    if (!config) {
        return {
            status: "blocked",
            errors: [
                {
                    code: "unknown_family",
                    message: `Unknown promotion family: ${input.family}`,
                },
            ],
            warnings: [],
        };
    }

    const repo = new ImportReviewSimplePromotionValidationRepository(prisma);
    const row = await repo.loadCandidateRow(config, input.candidateId, input.reviewBatchId);
    if (!row) {
        return {
            status: "blocked",
            errors: [
                {
                    code: "missing_candidate",
                    message: "Candidate was not found in the specified review batch.",
                    field: "id",
                },
            ],
            warnings: [],
        };
    }

    const fkExistsByColumn = await repo.resolveFkExistence(config, row);
    let nearbyCoreRoads: number | null = null;
    if (config.family === "routing_barriers" && row.geomDiagnostics?.present) {
        nearbyCoreRoads = await repo.countNearbyCoreRoadsForBarrier(row);
    }

    return validateSimplePromotionCandidateRow(config, row, {
        fkExistsByColumn,
        nearbyCoreRoads,
    });
}

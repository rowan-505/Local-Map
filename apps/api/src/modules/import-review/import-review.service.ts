import { getImportReviewPrisma } from "../../lib/import-review-prisma.js";
import type { JwtUser } from "../../plugins/auth.js";
import { StreetsRepository } from "../streets/streets.repo.js";
import type {
    BuildingListRowDb,
    CandidateReviewGuardContext,
    CandidateReviewRoadDecisionContext,
    ImportReviewDataRepository,
    ImportReviewScopeQuery,
    ImportReviewScopeResolved,
    ReviewActor,
} from "./import-review-data-repository.js";
import {
    ImportReviewBatchAmbiguousError,
    ImportReviewBatchNotFoundError,
    ImportReviewBuildingNotFoundError,
    ImportReviewCandidateNotFoundError,
    ImportReviewDecisionRuleError,
    ImportReviewInvalidScopeError,
    ImportReviewPlaceNotFoundError,
    ImportReviewRoadNotFoundError,
    ImportReviewRoadOverridesValidationFailedError,
    ImportReviewRoadOverridesWarningsPendingError,
} from "./import-review-errors.js";
import {
    applyImportReviewEffectiveFields,
    type EffectiveValuesRawRow,
} from "./import-review-effective-values.js";
import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { getImportReviewEntityConfig, IMPORT_REVIEW_ENTITY_FAMILIES } from "./import-review-config.js";
import { AdminAreasRepository } from "../admin-areas/admin-areas.repo.js";
import { ImportReviewReferenceOptionsRepository } from "./import-review-reference-options.repo.js";
import type {
    ImportReviewBuildingOverridesLeaf,
    ImportReviewCandidateOverridesLeaf,
} from "./import-review.schema.js";
import type {
    BulkImportReviewBuildingDecisionBody,
    ImportReviewBuildingsQuery,
    ImportReviewCandidatesListQuery,
    ImportReviewDecisionValue,
    ImportReviewPlacesQuery,
    ImportReviewRoadsQuery,
    PatchImportReviewBuildingDecisionBody,
    PatchImportReviewBuildingOverridesBody,
    PatchImportReviewCandidateOverridesBody,
    PatchImportReviewRoadOverridesBody,
    PostImportReviewRoadValidateRoutingBody,
} from "./import-review.schema.js";
import type {
    ImportReviewBuildingListItem,
    ImportReviewBuildingsFilterOptionsResponse,
    ImportReviewBuildingsListResponse,
    ImportReviewBulkDecisionResponse,
    ImportReviewFilterOptionsResponse,
    ImportReviewGeoJson,
    ImportReviewSummaryEnvelope,
    ImportReviewSummaryResponse,
} from "./import-review.types.js";
import { buildImportReviewRoadOverrideOutcome } from "./import-review-road-overrides-validator.js";
import type { ImportReviewRoadOverridesPatchNormalized } from "./import-review-road-overrides.types.js";
import {
    issuesToStoredJson,
    runImportReviewRoadRoutingValidation,
} from "./import-review-road-routing-validation.js";
import type { ImportReviewRoadRoutingValidationResult } from "./import-review-road-routing-validation.types.js";
import {
    mapFamilySummaryMetricsDb,
    rollupFamilySummaries,
    type ImportReviewFamilySummaryMetrics,
} from "./import-review-summary-counts.js";

export {
    ImportReviewBatchAmbiguousError,
    ImportReviewBatchNotFoundError,
    ImportReviewBuildingNotFoundError,
    ImportReviewDecisionRuleError,
    ImportReviewInvalidScopeError,
    ImportReviewPlaceNotFoundError,
    ImportReviewRoadNotFoundError,
    ImportReviewRoadOverridesValidationFailedError,
    ImportReviewRoadOverridesWarningsPendingError,
} from "./import-review-errors.js";

function toIso(d: Date | null): string | null {
    return d ? d.toISOString() : null;
}

function bigStr(v: bigint | null | undefined): string | null {
    if (v === null || v === undefined) {
        return null;
    }
    return v.toString();
}

function numOrNull(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const n =
        typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value as never);
    return Number.isFinite(n) ? n : null;
}

function toEffectiveRawRow(row: BuildingListRowDb): EffectiveValuesRawRow {
    return {
        name: row.name,
        canonical_name: row.canonical_name,
        class_code: row.class_code,
        admin_area_id: row.admin_area_id,
        levels: row.levels,
        height_m: row.height_m,
        normalized_data: row.normalized_data,
        review_overrides: row.review_overrides,
        effective_admin_area_name: row.effective_admin_area_name ?? null,
        name_local: row.name_local ?? null,
        stop_code: row.stop_code ?? null,
    };
}

function mapBuildingRow(
    row: BuildingListRowDb,
    family: ImportReviewEntityFamilySlug = "buildings"
): ImportReviewBuildingListItem {
    const geom = (row.geometry as ImportReviewGeoJson | null) ?? null;
    const centroid = (row.centroid as ImportReviewGeoJson | null) ?? null;

    const base: ImportReviewBuildingListItem = {
        id: row.id.toString(),
        public_id: row.public_id,
        review_batch_id: row.review_batch_id.toString(),
        source_snapshot_version: row.source_snapshot_version,
        local_staging_id: row.local_staging_id.toString(),
        source_snapshot_id_local:
            row.source_snapshot_id_local !== null ? row.source_snapshot_id_local.toString() : null,
        external_id: row.external_id,
        canonical_name: row.canonical_name,
        name: row.name,
        class_code: row.class_code,
        building_type: row.building_type,
        building_type_id: bigStr(row.building_type_id),
        building_type_code: row.building_type_code ?? null,
        building_type_name: row.building_type_name ?? null,
        admin_area_id: bigStr(row.admin_area_id),
        levels: row.levels,
        height_m: numOrNull(row.height_m),
        area_m2: numOrNull(row.area_m2),
        confidence_score: numOrNull(row.confidence_score),
        match_status: row.match_status,
        auto_action: row.auto_action,
        review_status: row.review_status,
        review_decision: row.review_decision,
        reviewed_by: row.reviewed_by,
        reviewed_at: toIso(row.reviewed_at),
        review_note: row.review_note,
        normalized_data: row.normalized_data,
        source_refs: row.source_refs,
        review_overrides: row.review_overrides,
        matched_core_id: bigStr(row.matched_core_id),
        matched_core_table: row.matched_core_table,
        matched_core_data: row.matched_core_data,
        f2_comparison: row.f2_comparison,
        validation_warnings: row.validation_warnings,
        validation_errors: row.validation_errors,
        promotion_status: row.promotion_status,
        promoted_core_id: bigStr(row.promoted_core_id),
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        geometry: geom,
        geom,
        centroid,
        road_candidate_road_class_id:
            row.road_candidate_road_class_id !== undefined && row.road_candidate_road_class_id !== null
                ? row.road_candidate_road_class_id.toString()
                : null,
        road_candidate_class_label: row.road_candidate_class_label ?? null,
        road_candidate_surface: row.road_candidate_surface ?? null,
        road_candidate_is_oneway: row.road_candidate_is_oneway ?? null,
    };

    return applyImportReviewEffectiveFields(family, base, toEffectiveRawRow(row));
}

function reviewStatusForDecision(decision: ImportReviewDecisionValue): string {
    const map: Record<ImportReviewDecisionValue, string> = {
        approved: "approved",
        rejected: "rejected",
        needs_more_review: "needs_review",
        ignored: "ignored",
        merged: "merged",
    };
    return map[decision];
}

function formatReviewer(user: JwtUser): string {
    const v = user.id ?? user.sub ?? user.email;
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : "local_admin";
}

function reviewedByUserId(user: JwtUser): bigint | null {
    const c = user.id ?? user.sub;
    if (typeof c === "string" && /^\d+$/.test(c)) {
        return BigInt(c);
    }
    return null;
}

function buildActor(user: JwtUser): ReviewActor {
    return {
        reviewedByText: formatReviewer(user),
        reviewedByUserId: reviewedByUserId(user),
    };
}

function n(v: bigint): number {
    return Number(v);
}

function scopeQueryFromBuildings(q: ImportReviewBuildingsQuery): ImportReviewScopeQuery {
    return {
        source_snapshot_version: q.source_snapshot_version,
        review_batch_id: q.review_batch_id,
        latest: q.latest,
    };
}

function scopeQueryFromPlaces(q: ImportReviewPlacesQuery): ImportReviewScopeQuery {
    return {
        source_snapshot_version: q.source_snapshot_version,
        review_batch_id: q.review_batch_id,
        latest: q.latest,
    };
}

function scopeQueryFromRoads(q: ImportReviewRoadsQuery): ImportReviewScopeQuery {
    return {
        source_snapshot_version: q.source_snapshot_version,
        review_batch_id: q.review_batch_id,
        latest: q.latest,
    };
}

function scopeQueryFromDecisionBody(body: PatchImportReviewBuildingDecisionBody): ImportReviewScopeQuery {
    return {
        source_snapshot_version: body.source_snapshot_version,
        review_batch_id: body.review_batch_id,
    };
}

function scopeQueryFromBulkBody(body: BulkImportReviewBuildingDecisionBody): ImportReviewScopeQuery {
    return {
        source_snapshot_version: body.source_snapshot_version,
        review_batch_id: body.review_batch_id,
    };
}

function scopeQueryFromOverridesBody(body: PatchImportReviewBuildingOverridesBody): ImportReviewScopeQuery {
    return {
        source_snapshot_version: body.source_snapshot_version,
        review_batch_id: body.review_batch_id,
    };
}

function stringsFromStoredJsonArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    const out: string[] = [];
    for (const item of raw) {
        if (typeof item === "string") {
            const t = item.trim();
            if (t.length > 0) {
                out.push(t);
            }
            continue;
        }
        if (item && typeof item === "object" && !Array.isArray(item)) {
            const o = item as Record<string, unknown>;
            const code = typeof o.code === "string" ? o.code.trim() : "";
            const message = typeof o.message === "string" ? o.message.trim() : "";
            if (message.length > 0) {
                out.push(code.length > 0 ? `[${code}] ${message}` : message);
            }
        }
    }
    return out;
}

function scopeQueryFromValidateRoutingBody(body: PostImportReviewRoadValidateRoutingBody): ImportReviewScopeQuery {
    return {
        source_snapshot_version: body.source_snapshot_version,
        review_batch_id: body.review_batch_id,
    };
}

function reviewStatusAfterRoutingValidation(
    currentStatus: string | null,
    currentDecision: string | null,
    errorCount: number,
    warningCount: number
): string {
    if (currentDecision === "approved") {
        return currentStatus ?? "approved";
    }
    if (errorCount > 0 || warningCount > 0) {
        return "needs_review";
    }
    return currentStatus && currentStatus.trim() !== "" ? currentStatus : "pending";
}

/** Human-readable scope bucket for not-found diagnostics. */
function scopeHintFromResolved(scope: ImportReviewScopeResolved): string {
    return `source_snapshot_version=${scope.snapshotVersion} review_batch_id=${scope.reviewBatchId}`;
}

function mapCandidateRow(
    row: BuildingListRowDb,
    family: ImportReviewEntityFamilySlug
): ImportReviewBuildingListItem {
    return mapBuildingRow(row, family);
}

function scopeQueryFromCandidatesList(q: ImportReviewCandidatesListQuery): ImportReviewScopeQuery {
    return {
        source_snapshot_version: q.source_snapshot_version,
        review_batch_id: q.review_batch_id,
        latest: q.latest,
    };
}

function throwCandidateNotFound(
    family: ImportReviewEntityFamilySlug,
    id: bigint,
    scope: ImportReviewScopeResolved
): never {
    const hint = scopeHintFromResolved(scope);
    const idStr = id.toString();
    if (family === "buildings") {
        throw new ImportReviewBuildingNotFoundError(idStr, hint);
    }
    if (family === "places") {
        throw new ImportReviewPlaceNotFoundError(idStr, hint);
    }
    if (family === "roads") {
        throw new ImportReviewRoadNotFoundError(idStr, hint);
    }
    throw new ImportReviewCandidateNotFoundError(family, idStr, hint);
}

function assertGenericCandidateDecisionAllowed(args: {
    family: ImportReviewEntityFamilySlug;
    body: PatchImportReviewBuildingDecisionBody;
    existing: CandidateReviewGuardContext;
    roadContext?: CandidateReviewRoadDecisionContext | null;
}): void {
    const matchStatus = args.existing.match_status ?? "";
    const autoAction = args.existing.auto_action ?? "";
    const promotionStatus = args.existing.promotion_status ?? "";

    if (promotionStatus === "promoted") {
        const note = args.body.review_note;
        const hasNote = note !== undefined && note !== null && note.trim() !== "";
        if (!args.body.force || !hasNote) {
            throw new ImportReviewDecisionRuleError(
                "Cannot change review decision while promotion_status is promoted without force=true and a non-empty review_note"
            );
        }
    }

    if (
        matchStatus === "duplicate_candidate" &&
        args.body.review_decision === "approved" &&
        !args.body.force &&
        !args.body.confirm_duplicate_reviewed
    ) {
        throw new ImportReviewDecisionRuleError(
            "Cannot approve a duplicate_candidate without force=true or confirm_duplicate_reviewed=true"
        );
    }

    if (
        args.body.review_decision === "approved" &&
        (matchStatus === "manual_protected" || autoAction === "protect_manual")
    ) {
        const note = args.body.review_note;
        const hasNote = note !== undefined && note !== null && note.trim() !== "";
        if (!args.body.force || !hasNote) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a manual_protected / protect_manual candidate without force=true and a non-empty review_note"
            );
        }
    }

    if (args.body.review_decision === "approved" && args.roadContext) {
        if (
            matchStatus === "matched_auto_update" &&
            !args.body.force &&
            !args.body.confirm_matched_auto_update
        ) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a matched_auto_update road without force=true or confirm_matched_auto_update=true"
            );
        }

        const valErr = stringsFromStoredJsonArray(args.roadContext.validation_errors);
        if (valErr.length > 0 && !args.body.force) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve while validation_errors persist on this road candidate — resolve overrides geometry/attributes first."
            );
        }

        const valWarn = stringsFromStoredJsonArray(args.roadContext.validation_warnings);
        if (valWarn.length > 0 && !args.body.force && !args.body.confirm_routing_warnings) {
            throw new ImportReviewDecisionRuleError(
                "Unresolved routing_validation warnings on this candidate; send confirm_routing_warnings=true (or force=true) after review."
            );
        }
    }

    if (args.body.review_decision === "approved" && !args.body.force && args.roadContext === undefined) {
        const config = getImportReviewEntityConfig(args.family);
        if (config.validationRequiredBeforePromotion) {
            const ctx = args.existing as CandidateReviewGuardContext & {
                validation_errors?: unknown;
                validation_warnings?: unknown;
            };
            const valErr = stringsFromStoredJsonArray(ctx.validation_errors);
            if (valErr.length > 0) {
                throw new ImportReviewDecisionRuleError(
                    `Cannot approve while validation_errors persist on this ${args.family} candidate without force=true`
                );
            }
            const valWarn = stringsFromStoredJsonArray(ctx.validation_warnings);
            if (valWarn.length > 0) {
                const note = args.body.review_note;
                const hasNote = note !== undefined && note !== null && note.trim() !== "";
                if (!hasNote) {
                    throw new ImportReviewDecisionRuleError(
                        "Cannot approve while validation_warnings persist without a non-empty review_note"
                    );
                }
            }
        }
    }
}

export class ImportReviewService {
    private readonly routingStreets = new StreetsRepository(getImportReviewPrisma());

    constructor(private readonly repo: ImportReviewDataRepository) {}

    private async resolveScopeChecked(q: ImportReviewScopeQuery): Promise<ImportReviewScopeResolved> {
        try {
            return await this.repo.resolveScope(q);
        } catch (e) {
            if (
                e instanceof ImportReviewBatchAmbiguousError ||
                e instanceof ImportReviewBatchNotFoundError ||
                e instanceof ImportReviewInvalidScopeError
            ) {
                throw e;
            }
            throw e;
        }
    }

    private envelopeSummary(scope: ImportReviewScopeResolved): ImportReviewSummaryEnvelope {
        return {
            source_snapshot_version: scope.snapshotVersion,
            review_batch_id: scope.reviewBatchId.toString(),
            source_snapshot_id_local:
                scope.sourceSnapshotIdLocal != null ? scope.sourceSnapshotIdLocal.toString() : null,
            batch_name: scope.batchName,
            selected_by: scope.selectedBy,
            status: scope.status,
            uploaded_at: scope.uploadedAt.toISOString(),
            total_candidate_count: scope.totalCandidateCount,
            entity_families: [...scope.entityFamilies],
        };
    }

    private envelopeLists(scope: ImportReviewScopeResolved): ImportReviewSummaryEnvelope {
        return this.envelopeSummary(scope);
    }

    async getSummary(q: ImportReviewScopeQuery): Promise<ImportReviewSummaryResponse> {
        const scope = await this.resolveScopeChecked(q);
        const [{ rows: buckets, warnings: bucketWarnings }, { rows: familyRows, warnings: familyWarnings }] =
            await Promise.all([
                this.repo.fetchSummaryBuckets(scope),
                this.repo.fetchFamilySummaryMetrics(scope),
            ]);

        const warnings = [...bucketWarnings, ...familyWarnings];

        const entitySummaries = buckets.map((row) => ({
            entity_family: row.entity_family,
            review_batch_id: row.review_batch_id.toString(),
            source_snapshot_version: row.source_snapshot_version,
            match_status: row.match_status,
            auto_action: row.auto_action,
            review_status: row.review_status,
            review_decision: row.review_decision,
            promotion_status: row.promotion_status,
            row_count: n(row.row_count),
        }));

        const familyOrder = [...IMPORT_REVIEW_ENTITY_FAMILIES];
        entitySummaries.sort((a, b) => {
            const fa = familyOrder.indexOf(a.entity_family as (typeof familyOrder)[number]);
            const fb = familyOrder.indexOf(b.entity_family as (typeof familyOrder)[number]);
            if (fa !== fb) {
                return (fa === -1 ? 99 : fa) - (fb === -1 ? 99 : fb);
            }
            const key = (v: string | null) => v ?? "";
            return (
                key(a.source_snapshot_version).localeCompare(key(b.source_snapshot_version)) ||
                key(a.review_batch_id).localeCompare(key(b.review_batch_id)) ||
                key(a.match_status).localeCompare(key(b.match_status)) ||
                key(a.auto_action).localeCompare(key(b.auto_action)) ||
                key(a.review_status).localeCompare(key(b.review_status)) ||
                key(a.review_decision).localeCompare(key(b.review_decision)) ||
                key(a.promotion_status).localeCompare(key(b.promotion_status))
            );
        });

        const familySummaries: ImportReviewFamilySummaryMetrics[] = familyRows
            .map(mapFamilySummaryMetricsDb)
            .filter((row) => row.batch_total > 0)
            .sort((a, b) => {
                const fa = familyOrder.indexOf(a.entity_family as (typeof familyOrder)[number]);
                const fb = familyOrder.indexOf(b.entity_family as (typeof familyOrder)[number]);
                return (fa === -1 ? 99 : fa) - (fb === -1 ? 99 : fb);
            });

        const rollup = rollupFamilySummaries(familySummaries);

        return {
            ...this.envelopeSummary(scope),
            ...(warnings.length > 0 ? { warnings } : {}),
            entity_summaries: entitySummaries,
            family_summaries: familySummaries,
            rollup,
            total_pending_review_count: rollup.pending_review_candidates,
            total_approved_count: rollup.approved_candidates,
            total_rejected_count: rollup.rejected_candidates,
        };
    }

    async getBuildingFilterOptions(q: ImportReviewScopeQuery): Promise<ImportReviewBuildingsFilterOptionsResponse> {
        const scope = await this.resolveScopeChecked(q);
        const opts = await this.repo.fetchBuildingFilterOptions(scope);
        return {
            ...this.envelopeSummary(scope),
            ...opts,
        };
    }

    async listBuildings(query: ImportReviewBuildingsQuery): Promise<ImportReviewBuildingsListResponse> {
        const scope = await this.resolveScopeChecked(scopeQueryFromBuildings(query));

        const filterSlice = {
            match_status: query.match_status,
            auto_action: query.auto_action,
            review_status: query.review_status,
            review_decision: query.review_decision,
            class_code: query.class_code,
            promotion_status: query.promotion_status,
            include_promoted: query.include_promoted,
            q: query.q,
        };

        const listFilters = {
            ...filterSlice,
            limit: query.limit,
            offset: query.offset,
            sort: query.sort,
            include_geometry: query.include_geometry,
        };

        const [total, rows] = await Promise.all([
            this.repo.countBuildingCandidates(scope, filterSlice),
            this.repo.listBuildingCandidates(scope, listFilters),
        ]);

        return {
            ...this.envelopeLists(scope),
            items: rows.map((r) => mapBuildingRow(r, "buildings")),
            total: Number(total),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getBuildingById(params: {
        id: bigint;
        source_snapshot_version?: string | undefined;
        review_batch_id?: bigint | undefined;
        include_geometry: boolean;
    }): Promise<ImportReviewBuildingListItem> {
        const scope = await this.resolveScopeChecked({
            source_snapshot_version: params.source_snapshot_version,
            review_batch_id: params.review_batch_id,
        });

        const row = await this.repo.getBuildingById(scope, params.id, params.include_geometry);
        if (row === null) {
            throw new ImportReviewBuildingNotFoundError(params.id.toString(), scopeHintFromResolved(scope));
        }
        return mapBuildingRow(row, "buildings");
    }

    async patchBuildingReviewOverrides(
        buildingId: bigint,
        body: PatchImportReviewBuildingOverridesBody,
        user: JwtUser
    ): Promise<ImportReviewBuildingListItem> {
        const scope = await this.resolveScopeChecked(scopeQueryFromOverridesBody(body));

        const ctx = await this.repo.findBuildingCandidateReviewContext(scope, buildingId);

        if (ctx === null) {
            throw new ImportReviewBuildingNotFoundError(buildingId.toString(), scopeHintFromResolved(scope));
        }

        if ((ctx.promotion_status ?? "") === "promoted") {
            throw new ImportReviewDecisionRuleError(
                "Cannot update review_overrides once promotion_status is promoted"
            );
        }

        const overridesPatch = await this.prepareValidatedOverridesPatch(body.review_overrides);

        const row = await this.repo.patchBuildingReviewOverrides({
            scope,
            id: buildingId,
            overridesPatch,
            editedByUserId: reviewedByUserId(user),
            reviewNote: body.review_note,
        });

        if (row === null) {
            throw new ImportReviewBuildingNotFoundError(buildingId.toString(), scopeHintFromResolved(scope));
        }

        return mapBuildingRow(row, "buildings");
    }

    async patchRoadReviewOverrides(
        roadId: bigint,
        body: PatchImportReviewRoadOverridesBody,
        user: JwtUser
    ): Promise<ImportReviewBuildingListItem> {
        const prisma = getImportReviewPrisma();
        const scope = await this.resolveScopeChecked(scopeQueryFromOverridesBody(body));

        const baseline = await this.repo.fetchRoadCandidatePatchBaseline(scope, roadId);

        if (baseline === null) {
            throw new ImportReviewRoadNotFoundError(roadId.toString(), scopeHintFromResolved(scope));
        }

        if ((baseline.promotion_status ?? "") === "promoted") {
            throw new ImportReviewDecisionRuleError(
                "Cannot update review_overrides once promotion_status is promoted"
            );
        }

        const leaf = body.review_overrides;

        const hardErrors: string[] = [];

        let effectiveRc: bigint | null = baseline.road_class_id ?? null;

        let label: string | null = baseline.road_class;

        const patchProvided = new Set(Object.keys(leaf as Record<string, unknown>));

        if (leaf.road_class_id !== undefined) {
            if (leaf.road_class_id === null) {
                effectiveRc = null;
                label = null;
            } else {
                const refRow = await this.repo.lookupRefRoadClassById(leaf.road_class_id);
                if (refRow === null) {
                    hardErrors.push(
                        `Unknown road_class_id=${leaf.road_class_id.toString()} (missing from ref.ref_road_classes).`
                    );
                } else {
                    effectiveRc = refRow.id;
                    label = refRow.code;
                }
            }
        } else if (leaf.road_class_code !== undefined) {
            const rawCode = leaf.road_class_code;
            if (rawCode === null) {
                effectiveRc = null;
                label = null;
            } else {
                const lc = rawCode.trim().toLowerCase();
                const refRow = await this.repo.lookupRefRoadClassByCode(lc);
                if (refRow === null) {
                    hardErrors.push(
                        `Unknown or ambiguous road_class_code=${rawCode} (must match exactly one ref.ref_road_classes row).`
                    );
                } else {
                    effectiveRc = refRow.id;
                    label = refRow.code;
                }
            }
        }

        if (hardErrors.length > 0) {
            throw new ImportReviewRoadOverridesValidationFailedError(hardErrors, []);
        }

        const baselineNoteProvided = !!(baseline.review_note && baseline.review_note.trim() !== "");

        const patchForValidator: ImportReviewRoadOverridesPatchNormalized = {};
        if (leaf.canonical_name !== undefined) {
            patchForValidator.canonical_name = leaf.canonical_name;
        }
        if (leaf.is_oneway !== undefined) {
            patchForValidator.is_oneway = leaf.is_oneway;
        }
        if (leaf.surface !== undefined) {
            patchForValidator.surface = leaf.surface;
        }
        if (leaf.geom !== undefined) {
            patchForValidator.geom =
                leaf.geom === null ? null : (leaf.geom as unknown as Record<string, unknown>);
        }

        const baselineGeom =
            baseline.geom_geojson && typeof baseline.geom_geojson === "object"
                ? (baseline.geom_geojson as Record<string, unknown>)
                : null;

        const outcome = await buildImportReviewRoadOverrideOutcome({
            prisma,
            streetsRepo: this.routingStreets,
            reviewBatchId: scope.reviewBatchId,
            roadId,
            baseline_review_overrides: baseline.review_overrides,
            baseline_canonical_name: baseline.canonical_name,
            baseline_road_class_id: baseline.road_class_id ?? null,
            baseline_is_oneway: baseline.is_oneway,
            baseline_surface: baseline.surface,
            baseline_geom_geojson: baselineGeom,
            normalized_data: baseline.normalized_data,
            class_code: baseline.class_code,
            matched_core_table: baseline.matched_core_table,
            matched_core_id: baseline.matched_core_id,
            patch: patchForValidator,
            routingToleranceMeters: body.routing_validation_tolerance_meters,
            effective_road_class_id: effectiveRc,
            effective_road_class_label: label,
            baselineNoteProvided,
            patchProvidedKeys: patchProvided,
            patchReviewNote: body.review_note,
        });

        if (outcome.errors.length > 0) {
            throw new ImportReviewRoadOverridesValidationFailedError(outcome.errors, outcome.warnings);
        }

        if (outcome.warnings.length > 0 && !body.confirm_acknowledge_routing_warnings) {
            throw new ImportReviewRoadOverridesWarningsPendingError(outcome.warnings);
        }

        const normalizedGeomString =
            patchProvided.has("geom") && outcome.normalizedPatchForJson.geom !== undefined
                ? JSON.stringify(outcome.normalizedPatchForJson.geom)
                : null;

        const row = await this.repo.patchRoadCandidateReviewOverrides({
            scope,
            id: roadId,
            merged_review_overrides: outcome.mergedOverridesJson,
            canonical_name: outcome.effectiveState.canonical_name,
            road_class_id: outcome.effectiveState.road_class_id,
            road_class_label: outcome.effectiveState.road_class_label,
            surface: outcome.effectiveState.surface,
            is_oneway: outcome.effectiveState.is_oneway,
            normalized_geom_geojson: normalizedGeomString,
            validation_warnings_json: outcome.warnings,
            validation_errors_json: [],
            editedByUserId: reviewedByUserId(user),
            reviewNote: body.review_note,
        });

        if (row === null) {
            throw new ImportReviewRoadNotFoundError(roadId.toString(), scopeHintFromResolved(scope));
        }

        return mapBuildingRow(row, "roads");
    }

    async validateRoadRouting(
        roadId: bigint,
        body: PostImportReviewRoadValidateRoutingBody,
        _user: JwtUser
    ): Promise<ImportReviewRoadRoutingValidationResult> {
        const prisma = getImportReviewPrisma();
        const scope = await this.resolveScopeChecked(scopeQueryFromValidateRoutingBody(body));

        const row = await this.repo.fetchRoadCandidateRoutingValidationRow(scope, roadId);
        if (row === null) {
            throw new ImportReviewRoadNotFoundError(roadId.toString(), scopeHintFromResolved(scope));
        }

        const result = await runImportReviewRoadRoutingValidation({
            prisma,
            streetsRepo: this.routingStreets,
            row,
            useReviewOverrides: body.use_review_overrides,
            connectivityThresholdM: body.connectivity_threshold_m,
            duplicateThresholdM: body.duplicate_threshold_m,
            confirmWarnings: body.confirm_warnings,
        });

        const nextReviewStatus = reviewStatusAfterRoutingValidation(
            row.review_status,
            row.review_decision,
            result.errors.length,
            result.warnings.length
        );

        const validation_summary: Record<string, unknown> = {
            validated_at: new Date().toISOString(),
            validation_mode: result.validation_mode,
            can_save: result.can_save,
            can_approve: result.can_approve,
            stats: result.stats,
            error_codes: result.errors.map((e) => e.code),
            warning_codes: result.warnings.map((w) => w.code),
        };

        const persisted = await this.repo.persistRoadRoutingValidation({
            scope,
            id: roadId,
            validation_errors_json: issuesToStoredJson(result.errors),
            validation_warnings_json: issuesToStoredJson([...result.warnings, ...result.info]),
            review_status: nextReviewStatus,
            validation_summary,
        });

        if (persisted === null) {
            throw new ImportReviewRoadNotFoundError(roadId.toString(), scopeHintFromResolved(scope));
        }

        return result;
    }

    async patchBuildingDecision(
        buildingId: bigint,
        body: PatchImportReviewBuildingDecisionBody,
        user: JwtUser
    ): Promise<ImportReviewBuildingListItem> {
        const scope = await this.resolveScopeChecked(scopeQueryFromDecisionBody(body));

        const existing = await this.repo.findBuildingCandidateReviewContext(scope, buildingId);
        if (existing === null) {
            throw new ImportReviewBuildingNotFoundError(buildingId.toString(), scopeHintFromResolved(scope));
        }

        const matchStatus = existing.match_status ?? "";
        const autoAction = existing.auto_action ?? "";
        const promotionStatus = existing.promotion_status ?? "";

        if (promotionStatus === "promoted" && !body.force) {
            throw new ImportReviewDecisionRuleError(
                "Cannot change review decision while promotion_status is promoted without force=true"
            );
        }

        if (
            matchStatus === "duplicate_candidate" &&
            body.review_decision === "approved" &&
            !body.force &&
            !body.confirm_duplicate_reviewed
        ) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a duplicate_candidate without force=true or confirm_duplicate_reviewed=true"
            );
        }

        if (
            body.review_decision === "approved" &&
            !body.force &&
            (matchStatus === "manual_protected" || autoAction === "protect_manual")
        ) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a manual_protected / protect_manual candidate without force=true"
            );
        }

        const updated = await this.repo.updateBuildingReviewDecision({
            scope,
            id: buildingId,
            reviewDecision: body.review_decision,
            reviewStatus: reviewStatusForDecision(body.review_decision),
            actor: buildActor(user),
            reviewNote: body.review_note,
        });

        if (updated === null) {
            throw new ImportReviewBuildingNotFoundError(buildingId.toString(), scopeHintFromResolved(scope));
        }

        return mapBuildingRow(updated, "buildings");
    }

    async bulkBuildingsDecision(
        body: BulkImportReviewBuildingDecisionBody,
        user: JwtUser
    ): Promise<ImportReviewBulkDecisionResponse> {
        const scope = await this.resolveScopeChecked(scopeQueryFromBulkBody(body));
        const mode = body.ids !== undefined ? "ids" : "filters";

        const res = await this.repo.bulkBuildingDecisions({
            scope,
            mode,
            ids: body.ids,
            filters: body.filters,
            reviewDecision: body.review_decision,
            reviewStatus: reviewStatusForDecision(body.review_decision),
            actor: buildActor(user),
            reviewNote: body.review_note,
            force: body.force,
            dryRun: body.dry_run,
        });

        return { ...this.envelopeLists(scope), ...res };
    }

    async listPlaces(query: ImportReviewPlacesQuery): Promise<ImportReviewBuildingsListResponse> {
        const scope = await this.resolveScopeChecked(scopeQueryFromPlaces(query));

        const filterSlice = {
            match_status: query.match_status,
            auto_action: query.auto_action,
            review_status: query.review_status,
            review_decision: query.review_decision,
            q: query.q,
        };

        const listFilters = {
            ...filterSlice,
            limit: query.limit,
            offset: query.offset,
            sort: query.sort,
            include_geometry: query.include_geometry,
        };

        const [total, rows] = await Promise.all([
            this.repo.countPlaceCandidates(scope, filterSlice),
            this.repo.listPlaceCandidates(scope, listFilters),
        ]);

        return {
            ...this.envelopeLists(scope),
            items: rows.map((r) => mapBuildingRow(r, "places")),
            total: Number(total),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async listRoads(query: ImportReviewRoadsQuery): Promise<ImportReviewBuildingsListResponse> {
        const scope = await this.resolveScopeChecked(scopeQueryFromRoads(query));

        const filterSlice = {
            match_status: query.match_status,
            auto_action: query.auto_action,
            review_status: query.review_status,
            review_decision: query.review_decision,
            q: query.q,
        };

        const listFilters = {
            ...filterSlice,
            limit: query.limit,
            offset: query.offset,
            sort: query.sort,
            include_geometry: query.include_geometry,
        };

        const [total, rows] = await Promise.all([
            this.repo.countRoadCandidates(scope, filterSlice),
            this.repo.listRoadCandidates(scope, listFilters),
        ]);

        return {
            ...this.envelopeLists(scope),
            items: rows.map((r) => mapBuildingRow(r, "roads")),
            total: Number(total),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async patchPlaceDecision(
        placeId: bigint,
        body: PatchImportReviewBuildingDecisionBody,
        user: JwtUser
    ): Promise<ImportReviewBuildingListItem> {
        const scope = await this.resolveScopeChecked(scopeQueryFromDecisionBody(body));

        const existing = await this.repo.findPlaceCandidateReviewContext(scope, placeId);
        if (existing === null) {
            throw new ImportReviewPlaceNotFoundError(placeId.toString(), scopeHintFromResolved(scope));
        }

        const matchStatus = existing.match_status ?? "";
        const autoAction = existing.auto_action ?? "";
        const promotionStatus = existing.promotion_status ?? "";

        if (promotionStatus === "promoted" && !body.force) {
            throw new ImportReviewDecisionRuleError(
                "Cannot change review decision while promotion_status is promoted without force=true"
            );
        }

        if (
            matchStatus === "duplicate_candidate" &&
            body.review_decision === "approved" &&
            !body.force &&
            !body.confirm_duplicate_reviewed
        ) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a duplicate_candidate without force=true or confirm_duplicate_reviewed=true"
            );
        }

        if (
            body.review_decision === "approved" &&
            !body.force &&
            (matchStatus === "manual_protected" || autoAction === "protect_manual")
        ) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a manual_protected / protect_manual candidate without force=true"
            );
        }

        const updated = await this.repo.updatePlaceReviewDecision({
            scope,
            id: placeId,
            reviewDecision: body.review_decision,
            reviewStatus: reviewStatusForDecision(body.review_decision),
            actor: buildActor(user),
            reviewNote: body.review_note,
        });

        if (updated === null) {
            throw new ImportReviewPlaceNotFoundError(placeId.toString(), scopeHintFromResolved(scope));
        }

        return mapBuildingRow(updated, "places");
    }

    async patchRoadDecision(
        roadId: bigint,
        body: PatchImportReviewBuildingDecisionBody,
        user: JwtUser
    ): Promise<ImportReviewBuildingListItem> {
        const scope = await this.resolveScopeChecked(scopeQueryFromDecisionBody(body));

        const existing = await this.repo.findRoadCandidateReviewContext(scope, roadId);
        if (existing === null) {
            throw new ImportReviewRoadNotFoundError(roadId.toString(), scopeHintFromResolved(scope));
        }

        const matchStatus = existing.match_status ?? "";
        const autoAction = existing.auto_action ?? "";
        const promotionStatus = existing.promotion_status ?? "";

        if (promotionStatus === "promoted" && !body.force) {
            throw new ImportReviewDecisionRuleError(
                "Cannot change review decision while promotion_status is promoted without force=true"
            );
        }

        if (
            matchStatus === "duplicate_candidate" &&
            body.review_decision === "approved" &&
            !body.force &&
            !body.confirm_duplicate_reviewed
        ) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a duplicate_candidate without force=true or confirm_duplicate_reviewed=true"
            );
        }

        if (
            body.review_decision === "approved" &&
            !body.force &&
            (matchStatus === "manual_protected" || autoAction === "protect_manual")
        ) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a manual_protected / protect_manual candidate without force=true"
            );
        }

        if (
            matchStatus === "matched_auto_update" &&
            body.review_decision === "approved" &&
            !body.force &&
            !body.confirm_matched_auto_update
        ) {
            throw new ImportReviewDecisionRuleError(
                "Cannot approve a matched_auto_update road without force=true or confirm_matched_auto_update=true"
            );
        }

        if (body.review_decision === "approved") {
            const valErr = stringsFromStoredJsonArray(existing.validation_errors);
            if (valErr.length > 0) {
                throw new ImportReviewDecisionRuleError(
                    "Cannot approve while validation_errors persist on this road candidate — resolve overrides geometry/attributes first."
                );
            }

            const valWarn = stringsFromStoredJsonArray(existing.validation_warnings);
            if (valWarn.length > 0 && !body.force && !body.confirm_routing_warnings) {
                throw new ImportReviewDecisionRuleError(
                    "Unresolved routing_validation warnings on this candidate; send confirm_routing_warnings=true (or force=true) after review."
                );
            }
        }

        const updated = await this.repo.updateRoadReviewDecision({
            scope,
            id: roadId,
            reviewDecision: body.review_decision,
            reviewStatus: reviewStatusForDecision(body.review_decision),
            actor: buildActor(user),
            reviewNote: body.review_note,
        });

        if (updated === null) {
            throw new ImportReviewRoadNotFoundError(roadId.toString(), scopeHintFromResolved(scope));
        }

        return mapBuildingRow(updated, "roads");
    }

    async bulkPlacesDecision(
        body: BulkImportReviewBuildingDecisionBody,
        user: JwtUser
    ): Promise<ImportReviewBulkDecisionResponse> {
        const scope = await this.resolveScopeChecked(scopeQueryFromBulkBody(body));
        const mode = body.ids !== undefined ? "ids" : "filters";

        const res = await this.repo.bulkPlaceDecisions({
            scope,
            mode,
            ids: body.ids,
            filters: body.filters,
            reviewDecision: body.review_decision,
            reviewStatus: reviewStatusForDecision(body.review_decision),
            actor: buildActor(user),
            reviewNote: body.review_note,
            force: body.force,
            dryRun: body.dry_run,
        });

        return { ...this.envelopeLists(scope), ...res };
    }

    async bulkRoadsDecision(
        body: BulkImportReviewBuildingDecisionBody,
        user: JwtUser
    ): Promise<ImportReviewBulkDecisionResponse> {
        const scope = await this.resolveScopeChecked(scopeQueryFromBulkBody(body));
        const mode = body.ids !== undefined ? "ids" : "filters";

        const res = await this.repo.bulkRoadDecisions({
            scope,
            mode,
            ids: body.ids,
            filters: body.filters,
            reviewDecision: body.review_decision,
            reviewStatus: reviewStatusForDecision(body.review_decision),
            actor: buildActor(user),
            reviewNote: body.review_note,
            force: body.force,
            dryRun: body.dry_run,
        });

        return { ...this.envelopeLists(scope), ...res };
    }

    async listCandidates(
        family: ImportReviewEntityFamilySlug,
        query: ImportReviewCandidatesListQuery
    ): Promise<ImportReviewBuildingsListResponse> {
        const scope = await this.resolveScopeChecked(scopeQueryFromCandidatesList(query));

        const filterSlice = {
            match_status: query.match_status,
            auto_action: query.auto_action,
            review_status: query.review_status,
            review_decision: query.review_decision,
            class_code: query.class_code,
            promotion_status: query.promotion_status,
            include_promoted: query.include_promoted,
            q: query.q,
        };

        const listFilters = {
            ...filterSlice,
            limit: query.limit,
            offset: query.offset,
            sort: query.sort,
            include_geometry: query.include_geometry,
        };

        const [total, rows] = await Promise.all([
            this.repo.countCandidates(family, scope, filterSlice),
            this.repo.listCandidates(family, scope, listFilters),
        ]);

        return {
            ...this.envelopeLists(scope),
            items: rows.map((r) => mapCandidateRow(r, family)),
            total: Number(total),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getCandidateById(
        family: ImportReviewEntityFamilySlug,
        params: {
            id: bigint;
            source_snapshot_version?: string | undefined;
            review_batch_id?: bigint | undefined;
            include_geometry: boolean;
        }
    ): Promise<ImportReviewBuildingListItem> {
        const scope = await this.resolveScopeChecked({
            source_snapshot_version: params.source_snapshot_version,
            review_batch_id: params.review_batch_id,
        });

        const row = await this.repo.getCandidateById(family, scope, params.id, params.include_geometry);
        if (row === null) {
            throwCandidateNotFound(family, params.id, scope);
        }
        return mapCandidateRow(row, family);
    }

    async getFilterOptions(
        family: ImportReviewEntityFamilySlug,
        q: ImportReviewScopeQuery
    ): Promise<ImportReviewFilterOptionsResponse> {
        const scope = await this.resolveScopeChecked(q);
        const opts = await this.repo.fetchCandidateFilterOptions(family, scope);
        return {
            ...this.envelopeSummary(scope),
            ...opts,
        };
    }

    async patchCandidateDecision(
        family: ImportReviewEntityFamilySlug,
        candidateId: bigint,
        body: PatchImportReviewBuildingDecisionBody,
        user: JwtUser
    ): Promise<ImportReviewBuildingListItem> {
        const scope = await this.resolveScopeChecked(scopeQueryFromDecisionBody(body));

        if (family === "roads") {
            return this.patchRoadDecision(candidateId, body, user);
        }

        const existing = await this.repo.findCandidateReviewContext(family, scope, candidateId);
        if (existing === null) {
            throwCandidateNotFound(family, candidateId, scope);
        }

        assertGenericCandidateDecisionAllowed({ family, body, existing });

        const updated = await this.repo.updateCandidateReviewDecision({
            family,
            scope,
            id: candidateId,
            reviewDecision: body.review_decision,
            reviewStatus: reviewStatusForDecision(body.review_decision),
            actor: buildActor(user),
            reviewNote: body.review_note,
        });

        if (updated === null) {
            throwCandidateNotFound(family, candidateId, scope);
        }

        return mapCandidateRow(updated, family);
    }

    async bulkCandidateDecision(
        family: ImportReviewEntityFamilySlug,
        body: BulkImportReviewBuildingDecisionBody,
        user: JwtUser
    ): Promise<ImportReviewBulkDecisionResponse> {
        const config = getImportReviewEntityConfig(family);
        if (!config.bulkApprovalAllowed) {
            throw new ImportReviewDecisionRuleError(
                `Bulk review decisions are not allowed for entity family ${family}`
            );
        }

        const scope = await this.resolveScopeChecked(scopeQueryFromBulkBody(body));
        const mode = body.ids !== undefined ? "ids" : "filters";

        const res = await this.repo.bulkCandidateDecisions({
            family,
            scope,
            mode,
            ids: body.ids,
            filters: body.filters,
            reviewDecision: body.review_decision,
            reviewStatus: reviewStatusForDecision(body.review_decision),
            actor: buildActor(user),
            reviewNote: body.review_note,
            force: body.force,
            dryRun: body.dry_run,
        });

        return { ...this.envelopeLists(scope), ...res };
    }

    private async prepareValidatedOverridesPatch(
        leaf: ImportReviewBuildingOverridesLeaf | ImportReviewCandidateOverridesLeaf
    ): Promise<Record<string, unknown>> {
        const prisma = getImportReviewPrisma();
        const refRepo = new ImportReviewReferenceOptionsRepository(prisma);
        const adminRepo = new AdminAreasRepository(prisma);

        if (leaf.building_type_id !== undefined && leaf.building_type_id !== null) {
            const refRow = await refRepo.getActiveBuildingTypeById(leaf.building_type_id);
            if (refRow === null) {
                throw new ImportReviewDecisionRuleError(
                    `Unknown or inactive building_type_id=${leaf.building_type_id.toString()} (must match ref.ref_building_types where is_active = true).`
                );
            }
        }

        if (leaf.admin_area_id !== undefined && leaf.admin_area_id !== null) {
            const has = await adminRepo.hasActiveAdminArea(leaf.admin_area_id);
            if (!has) {
                throw new ImportReviewDecisionRuleError(
                    `Unknown or inactive admin_area_id=${leaf.admin_area_id.toString()} (must match core.core_admin_areas where is_active = true).`
                );
            }
        }

        const overridesPatch: Record<string, unknown> = { ...leaf };
        if (leaf.building_type_id !== undefined) {
            overridesPatch.building_type_id =
                leaf.building_type_id === null ? null : leaf.building_type_id.toString();
        }
        if (leaf.admin_area_id !== undefined) {
            overridesPatch.admin_area_id =
                leaf.admin_area_id === null ? null : leaf.admin_area_id.toString();
        }
        const candidateLeaf = leaf as ImportReviewCandidateOverridesLeaf;
        if (candidateLeaf.poi_category_id !== undefined) {
            overridesPatch.poi_category_id =
                candidateLeaf.poi_category_id === null ? null : candidateLeaf.poi_category_id.toString();
        }
        if (candidateLeaf.category_id !== undefined) {
            overridesPatch.poi_category_id =
                candidateLeaf.category_id === null ? null : candidateLeaf.category_id.toString();
        }
        return overridesPatch;
    }

    async patchCandidateOverrides(
        family: ImportReviewEntityFamilySlug,
        candidateId: bigint,
        body: PatchImportReviewCandidateOverridesBody,
        user: JwtUser
    ): Promise<ImportReviewBuildingListItem> {
        const config = getImportReviewEntityConfig(family);
        if (!config.supportsOverrides) {
            throw new ImportReviewDecisionRuleError(
                `Review overrides are not supported for entity family ${family}`
            );
        }

        if (family === "roads") {
            throw new ImportReviewDecisionRuleError(
                "Use PATCH /api/import-review/roads/:id/overrides for road candidates"
            );
        }

        const scope = await this.resolveScopeChecked(scopeQueryFromOverridesBody(body));
        const ctx = await this.repo.findCandidateReviewContext(family, scope, candidateId);
        if (ctx === null) {
            throwCandidateNotFound(family, candidateId, scope);
        }

        if ((ctx.promotion_status ?? "") === "promoted") {
            throw new ImportReviewDecisionRuleError(
                "Cannot update review_overrides once promotion_status is promoted"
            );
        }

        const overridesPatch = await this.prepareValidatedOverridesPatch(body.review_overrides);

        const row = await this.repo.patchCandidateReviewOverrides({
            family,
            scope,
            id: candidateId,
            overridesPatch,
            editedByUserId: reviewedByUserId(user),
            reviewNote: body.review_note,
        });

        if (row === null) {
            throwCandidateNotFound(family, candidateId, scope);
        }

        return family === "buildings" ? mapBuildingRow(row, "buildings") : mapCandidateRow(row, family);
    }

    async getReferenceOptions() {
        const repo = new ImportReviewReferenceOptionsRepository(getImportReviewPrisma());
        return repo.fetchAll();
    }
}

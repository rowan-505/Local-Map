import { Prisma, type PrismaClient } from "@prisma/client";

import { coreVerificationExistsUnionSql } from "./import-review-publish-batch-core-verification.js";

const BUILDING_CANDIDATE_TABLE = "import_review.building_candidates";
const PLACE_CANDIDATE_TABLE = "import_review.place_candidates";
const LANDUSE_CANDIDATE_TABLE = "import_review.landuse_candidates";
const WATER_LINE_CANDIDATE_TABLE = "import_review.water_line_candidates";
const WATER_POLYGON_CANDIDATE_TABLE = "import_review.water_polygon_candidates";
const ROAD_CANDIDATE_TABLE = "import_review.road_candidates";
const ADMIN_AREA_CANDIDATE_TABLE = "import_review.admin_area_candidates";
const ROUTING_BARRIER_CANDIDATE_TABLE = "import_review.routing_barrier_candidates";

export type PublishBatchDerivedStatus =
    | "draft"
    | "validating"
    | "promoting"
    | "blocked"
    | "partial"
    | "ready"
    | "promoted"
    | "failed"
    | "invalid_empty_promoted"
    | "archived";

export type PublishBatchItemCounts = {
    pending: number;
    success: number;
    failed: number;
    skipped: number;
    rolled_back: number;
    total: number;
};

export type PublishBatchActionCounts = {
    inserted: number;
    updated: number;
    merged: number;
};

export type PublishBatchEntityFamilyCounts = {
    entity_family: string;
    pending: number;
    success: number;
    failed: number;
    skipped: number;
    total: number;
};

export type PublishBatchStoredStatus =
    | "draft"
    | "validating"
    | "ready"
    | "partial"
    | "promoting"
    | "promoted"
    | "failed"
    | "blocked"
    | "archived";

export type PublishBatchSummaryInput = {
    stored_status: string;
    validated_at: Date | null;
    promoted_at: Date | null;
    dry_run: boolean;
    validation_outcome: "passed" | "partial" | "blocked" | null;
    can_promote: boolean;
    item_counts: PublishBatchItemCounts;
    action_counts: PublishBatchActionCounts;
    core_verified_count: number;
    import_review_marked_promoted_count: number;
    promotion_result_total: number | null;
    promotion_result_success_count: number | null;
    promotion_result_core_verified_count: number | null;
    promotion_result_marked_promoted_count: number | null;
    /** When true, skip workflow-only statuses (promoting) and evaluate promotion outcome. */
    evaluate_promotion_outcome?: boolean;
    /** Last promotion run outcome from summary.promotion_status (separate from validation_result). */
    promotion_status?: string | null;
};

const PROMOTION_FAILED_RETRY_MESSAGE =
    "Promotion failed. Create a new retry batch after fixing the error.";

/** True when a promotion run finished with no successes and publish items failed. */
export function isPromotionFailedBatchState(input: PublishBatchSummaryInput): boolean {
    const promo = (input.promotion_status ?? "").trim();
    if (promo === "promotion_failed") {
        return true;
    }
    const { success, failed, pending, total } = input.item_counts;
    if (total === 0 || success > 0) {
        return false;
    }
    if (failed === 0) {
        return false;
    }
    if (pending > 0) {
        return false;
    }
    if (input.promotion_result_success_count != null && input.promotion_result_success_count === 0) {
        return true;
    }
    return false;
}

export type PublishBatchDerivedCounts = PublishBatchItemCounts & {
    core_verified_count: number;
    import_review_marked_promoted_count: number;
    promotion_result_total: number | null;
};

export type PublishBatchDerivedResult = {
    stored_status_recommendation: PublishBatchStoredStatus;
    derived_status: PublishBatchDerivedStatus;
    derived_status_reason: string | null;
    /** @deprecated Use derived_status_reason */
    status_note: string | null;
    counts: PublishBatchDerivedCounts;
};

export type PublishBatchComputedSummary = PublishBatchSummaryInput & {
    derived_status: PublishBatchDerivedStatus;
    derived_status_reason: string | null;
    stored_status_recommendation: PublishBatchStoredStatus;
    status_note: string | null;
    inserted_count: number;
    updated_count: number;
    by_entity_family: PublishBatchEntityFamilyCounts[];
};

function n(v: bigint | number): number {
    return typeof v === "bigint" ? Number(v) : v;
}

export function parseEntityFamiliesFromBatchSummary(summary: unknown): string[] {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return [];
    }
    const root = summary as Record<string, unknown>;
    const fromRoot = root.entity_families;
    if (Array.isArray(fromRoot)) {
        return fromRoot.filter((v): v is string => typeof v === "string");
    }
    const creation = root.creation_result;
    if (creation && typeof creation === "object" && !Array.isArray(creation)) {
        const fromCreation = (creation as Record<string, unknown>).entity_families;
        if (Array.isArray(fromCreation)) {
            return fromCreation.filter((v): v is string => typeof v === "string");
        }
    }
    const validation = root.validation_result;
    if (validation && typeof validation === "object" && !Array.isArray(validation)) {
        const fromValidation = (validation as Record<string, unknown>).selected_entity_families;
        if (Array.isArray(fromValidation)) {
            return fromValidation.filter((v): v is string => typeof v === "string");
        }
    }
    return [];
}

export function parseValidationOutcomeFromSummary(
    summary: unknown
): "passed" | "partial" | "blocked" | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const vr = (summary as Record<string, unknown>).validation_result;
    if (!vr || typeof vr !== "object" || Array.isArray(vr)) {
        return null;
    }
    const outcome = (vr as Record<string, unknown>).outcome;
    if (outcome === "blocked") {
        return "blocked";
    }
    if (outcome === "partial") {
        return "partial";
    }
    if (outcome === "passed") {
        return "passed";
    }
    return null;
}

export function parseDryRunFromSummary(summary: unknown): boolean {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return false;
    }
    const cr = (summary as Record<string, unknown>).creation_result;
    if (!cr || typeof cr !== "object" || Array.isArray(cr)) {
        return false;
    }
    return (cr as Record<string, unknown>).dry_run === true;
}

export function parseCanPromoteFromSummary(summary: unknown): boolean {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return false;
    }
    const vr = (summary as Record<string, unknown>).validation_result;
    if (!vr || typeof vr !== "object" || Array.isArray(vr)) {
        return false;
    }
    return (vr as Record<string, unknown>).can_promote !== false;
}

export function parsePromotionResultTotalFromSummary(summary: unknown): number | null {
    return parsePromotionResultFieldsFromSummary(summary)?.total ?? null;
}

export function parsePromotionStatusFromSummary(summary: unknown): string | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const root = summary as Record<string, unknown>;
    const direct = root.promotion_status;
    if (typeof direct === "string" && direct.trim()) {
        return direct.trim();
    }
    const pr = root.promotion_result;
    if (pr && typeof pr === "object" && !Array.isArray(pr)) {
        const status = (pr as Record<string, unknown>).status;
        if (status === "promoted" || status === "partial") {
            return status;
        }
        if (status === "failed" || status === "promotion_failed") {
            return "promotion_failed";
        }
    }
    return null;
}

export type PromotionResultSummaryFields = {
    total: number | null;
    success_count: number | null;
    core_verified_count: number | null;
    import_review_marked_promoted_count: number | null;
};

export function parsePromotionResultFieldsFromSummary(
    summary: unknown
): PromotionResultSummaryFields | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const pr = (summary as Record<string, unknown>).promotion_result;
    if (!pr || typeof pr !== "object" || Array.isArray(pr)) {
        return null;
    }
    const o = pr as Record<string, unknown>;
    const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
    return {
        total: num(o.total),
        success_count: num(o.success_count),
        core_verified_count: num(o.core_verified_count),
        import_review_marked_promoted_count: num(o.import_review_marked_promoted_count),
    };
}

export type PersistedPublishBatchRepair = {
    derived_status: PublishBatchDerivedStatus;
    derived_status_reason: string;
    repair_note: string | null;
    repaired_at: string | null;
};

export function parsePersistedPublishBatchRepair(summary: unknown): PersistedPublishBatchRepair | null {
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
        return null;
    }
    const o = summary as Record<string, unknown>;
    if (o.derived_status !== "invalid_empty_promoted") {
        return null;
    }
    const reason =
        typeof o.derived_status_reason === "string"
            ? o.derived_status_reason
            : INVALID_EMPTY_PROMOTED_REASON;
    return {
        derived_status: "invalid_empty_promoted",
        derived_status_reason: reason,
        repair_note: typeof o.repair_note === "string" ? o.repair_note : null,
        repaired_at: typeof o.repaired_at === "string" ? o.repaired_at : null,
    };
}

const INVALID_EMPTY_PROMOTED_REASON =
    "Batch was stored as promoted but no publish items were successfully promoted/verified.";

const INVALID_EMPTY_PROMOTED_REPAIR_NOTE =
    "Repair changed invalid promoted batch to failed/blocked because no successful publish items existed.";

function asStoredStatus(status: string): PublishBatchStoredStatus {
    const allowed: PublishBatchStoredStatus[] = [
        "draft",
        "validating",
        "ready",
        "partial",
        "promoting",
        "promoted",
        "failed",
        "blocked",
        "archived",
    ];
    if (allowed.includes(status as PublishBatchStoredStatus)) {
        return status as PublishBatchStoredStatus;
    }
    return "failed";
}

function buildDerivedResult(
    input: PublishBatchSummaryInput,
    derived_status: PublishBatchDerivedStatus,
    stored_status_recommendation: PublishBatchStoredStatus,
    derived_status_reason: string | null
): PublishBatchDerivedResult {
    const counts: PublishBatchDerivedCounts = {
        ...input.item_counts,
        core_verified_count: input.core_verified_count,
        import_review_marked_promoted_count: input.import_review_marked_promoted_count,
        promotion_result_total: input.promotion_result_total,
    };
    return {
        stored_status_recommendation,
        derived_status,
        derived_status_reason,
        status_note: derived_status_reason,
        counts,
    };
}

function isInvalidEmptyPromoted(input: PublishBatchSummaryInput): boolean {
    if (input.stored_status !== "promoted" || input.dry_run) {
        return false;
    }
    const { total, success } = input.item_counts;

    if (total === 0 || success === 0) {
        return true;
    }
    if (input.core_verified_count === 0 || input.import_review_marked_promoted_count === 0) {
        return true;
    }

    const promoTotal = input.promotion_result_total;
    const promoSuccess = input.promotion_result_success_count;
    const promoCore = input.promotion_result_core_verified_count;
    const promoMarked = input.promotion_result_marked_promoted_count;

    if (promoTotal != null && promoTotal === 0) {
        return true;
    }
    if (promoSuccess != null && promoSuccess === 0) {
        return true;
    }
    if (promoCore != null && promoCore === 0) {
        return true;
    }
    if (promoMarked != null && promoMarked === 0) {
        return true;
    }

    return false;
}

export function isGenuinelyPromotedBatch(input: PublishBatchSummaryInput): boolean {
    const { total, success, failed } = input.item_counts;
    return (
        total > 0 &&
        success === total &&
        failed === 0 &&
        input.core_verified_count === success &&
        input.import_review_marked_promoted_count === success
    );
}

function batchHasPromotablePendingItems(input: PublishBatchSummaryInput): boolean {
    return input.can_promote !== false && input.item_counts.pending > 0;
}

function validationBlockedWithNoPromotable(input: PublishBatchSummaryInput): boolean {
    return (
        (input.stored_status === "blocked" || input.validation_outcome === "blocked") &&
        input.can_promote === false
    );
}

function failedRecommendation(input: PublishBatchSummaryInput): PublishBatchStoredStatus {
    if (validationBlockedWithNoPromotable(input)) {
        return "blocked";
    }
    return "failed";
}

export function derivePublishBatchStatus(input: PublishBatchSummaryInput): PublishBatchDerivedResult {
    const { stored_status, item_counts, core_verified_count, import_review_marked_promoted_count } =
        input;
    const { total, success, failed, pending } = item_counts;
    const storedRec = asStoredStatus(stored_status);

    if (stored_status === "archived") {
        return buildDerivedResult(input, "archived", "archived", null);
    }
    if (stored_status === "draft") {
        const validationComplete =
            input.can_promote !== false &&
            (input.validation_outcome === "passed" || input.validation_outcome === "partial");
        if (!validationComplete) {
            return buildDerivedResult(input, "draft", "draft", null);
        }
        if (input.validation_outcome === "partial") {
            return buildDerivedResult(
                input,
                "partial",
                "partial",
                input.item_counts.pending > 0
                    ? "Some items are promotable; blocked items remain pending."
                    : null
            );
        }
        return buildDerivedResult(input, "ready", "ready", null);
    }
    if (stored_status === "validating") {
        return buildDerivedResult(input, "validating", "validating", null);
    }
    if (stored_status === "promoting" && !input.evaluate_promotion_outcome) {
        return buildDerivedResult(input, "promoting", "promoting", null);
    }

    // Rule A: stored promoted but no successful promotion/verification
    if (isInvalidEmptyPromoted(input)) {
        return buildDerivedResult(
            input,
            "invalid_empty_promoted",
            failedRecommendation(input),
            INVALID_EMPTY_PROMOTED_REASON
        );
    }

    if (batchHasPromotablePendingItems(input)) {
        const partialNote =
            input.item_counts.pending > 0
                ? "Some items are promotable; blocked items remain pending."
                : null;
        if (
            stored_status === "partial" ||
            input.validation_outcome === "partial" ||
            stored_status === "blocked" ||
            input.validation_outcome === "blocked"
        ) {
            return buildDerivedResult(input, "partial", "partial", partialNote);
        }
    }

    if (validationBlockedWithNoPromotable(input)) {
        return buildDerivedResult(input, "blocked", "blocked", null);
    }

    if (isPromotionFailedBatchState(input)) {
        return buildDerivedResult(
            input,
            "failed",
            "failed",
            PROMOTION_FAILED_RETRY_MESSAGE
        );
    }

    if (stored_status === "partial" || input.validation_outcome === "partial") {
        return buildDerivedResult(
            input,
            "partial",
            "partial",
            input.can_promote ? "Some items are promotable; blocked items remain pending." : null
        );
    }

    if (stored_status === "partial") {
        return buildDerivedResult(
            input,
            "partial",
            "partial",
            input.item_counts.pending > 0
                ? `${input.item_counts.success} promoted; ${input.item_counts.pending} still pending.`
                : null
        );
    }

    // Rule B: fully promoted
    if (
        total > 0 &&
        success === total &&
        failed === 0 &&
        core_verified_count === success &&
        import_review_marked_promoted_count === success
    ) {
        return buildDerivedResult(input, "promoted", "promoted", null);
    }

    // Rule C: partially promoted
    if (success > 0 && failed > 0) {
        return buildDerivedResult(
            input,
            "partial",
            failedRecommendation(input),
            `${success} succeeded, ${failed} failed.`
        );
    }

    if (success > 0 && (core_verified_count < success || import_review_marked_promoted_count < success)) {
        return buildDerivedResult(
            input,
            "partial",
            failedRecommendation(input),
            "Some successful items lack core verification or import_review promotion marking."
        );
    }

    // Rule D: failed/blocked
    if (failed > 0 && success === 0) {
        return buildDerivedResult(input, "failed", failedRecommendation(input), null);
    }

    if (total === 0 && !input.dry_run) {
        return buildDerivedResult(
            input,
            "failed",
            failedRecommendation(input),
            "Publish batch has no items."
        );
    }

    // Rule E: ready — validated, can promote, no promotion attempted
    if (
        input.validated_at != null &&
        input.promoted_at == null &&
        input.can_promote &&
        pending === total &&
        total > 0
    ) {
        const derivedStatus: PublishBatchDerivedStatus =
            stored_status === "partial" ||
            stored_status === "blocked" ||
            input.validation_outcome === "blocked"
                ? "partial"
                : "ready";
        return buildDerivedResult(input, derivedStatus, derivedStatus, null);
    }

    if (stored_status === "ready" || stored_status === "partial" || stored_status === "blocked") {
        const recommendation: PublishBatchStoredStatus =
            stored_status === "blocked" && batchHasPromotablePendingItems(input)
                ? "partial"
                : stored_status;
        const derived: PublishBatchDerivedStatus =
            recommendation === "partial" ? "partial" : stored_status === "blocked" ? "blocked" : stored_status;
        return buildDerivedResult(input, derived, recommendation, null);
    }

    if (stored_status === "failed") {
        return buildDerivedResult(input, "failed", "failed", null);
    }

    return buildDerivedResult(
        input,
        stored_status === "promoted" ? "partial" : "ready",
        storedRec,
        null
    );
}

export class ImportReviewPublishBatchSummaryRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async computePublishBatchSummary(batchId: bigint): Promise<PublishBatchComputedSummary | null> {
        const batchRows = await this.prisma.$queryRaw<
            {
                status: string;
                validated_at: Date | null;
                promoted_at: Date | null;
                summary: unknown;
            }[]
        >`
            SELECT status, validated_at, promoted_at, summary
            FROM system.system_publish_batches
            WHERE id = ${batchId}
            LIMIT 1
        `;
        const batch = batchRows[0];
        if (!batch) {
            return null;
        }

        const itemCountRows = await this.prisma.$queryRaw<
            {
                pending: bigint;
                success: bigint;
                failed: bigint;
                skipped: bigint;
                rolled_back: bigint;
                total: bigint;
            }[]
        >`
            SELECT
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*) FILTER (WHERE publish_status = 'rolled_back')::bigint AS rolled_back,
                count(*)::bigint AS total
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        const ic = itemCountRows[0] ?? {
            pending: 0n,
            success: 0n,
            failed: 0n,
            skipped: 0n,
            rolled_back: 0n,
            total: 0n,
        };

        const actionRows = await this.prisma.$queryRaw<
            { inserted: bigint; updated: bigint; merged: bigint }[]
        >`
            SELECT
                count(*) FILTER (
                    WHERE publish_status = 'success' AND publish_action = 'insert'
                )::bigint AS inserted,
                count(*) FILTER (
                    WHERE publish_status = 'success' AND publish_action = 'update'
                )::bigint AS updated,
                count(*) FILTER (
                    WHERE publish_status = 'success' AND publish_action = 'merge'
                )::bigint AS merged
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
        `;
        const ac = actionRows[0] ?? { inserted: 0n, updated: 0n, merged: 0n };

        const familyRows = await this.prisma.$queryRaw<
            {
                entity_family: string;
                pending: bigint;
                success: bigint;
                failed: bigint;
                skipped: bigint;
                total: bigint;
            }[]
        >`
            SELECT
                entity_family,
                count(*) FILTER (WHERE publish_status = 'pending')::bigint AS pending,
                count(*) FILTER (WHERE publish_status = 'success')::bigint AS success,
                count(*) FILTER (WHERE publish_status = 'failed')::bigint AS failed,
                count(*) FILTER (WHERE publish_status = 'skipped')::bigint AS skipped,
                count(*)::bigint AS total
            FROM system.system_publish_items
            WHERE publish_batch_id = ${batchId}
            GROUP BY entity_family
            ORDER BY entity_family
        `;

        const coreVerified = await this.countCoreVerified(batchId);
        const markedPromoted = await this.countMarkedPromoted(batchId);

        const item_counts: PublishBatchItemCounts = {
            pending: n(ic.pending),
            success: n(ic.success),
            failed: n(ic.failed),
            skipped: n(ic.skipped),
            rolled_back: n(ic.rolled_back),
            total: n(ic.total),
        };
        const action_counts: PublishBatchActionCounts = {
            inserted: n(ac.inserted),
            updated: n(ac.updated),
            merged: n(ac.merged),
        };

        const promoFields = parsePromotionResultFieldsFromSummary(batch.summary);

        const input: PublishBatchSummaryInput = {
            stored_status: batch.status,
            validated_at: batch.validated_at,
            promoted_at: batch.promoted_at,
            dry_run: parseDryRunFromSummary(batch.summary),
            validation_outcome: parseValidationOutcomeFromSummary(batch.summary),
            can_promote: parseCanPromoteFromSummary(batch.summary),
            promotion_status: parsePromotionStatusFromSummary(batch.summary),
            item_counts,
            action_counts,
            core_verified_count: coreVerified,
            import_review_marked_promoted_count: markedPromoted,
            promotion_result_total: promoFields?.total ?? null,
            promotion_result_success_count: promoFields?.success_count ?? null,
            promotion_result_core_verified_count: promoFields?.core_verified_count ?? null,
            promotion_result_marked_promoted_count:
                promoFields?.import_review_marked_promoted_count ?? null,
        };

        const persistedRepair = parsePersistedPublishBatchRepair(batch.summary);
        const derived =
            persistedRepair && batch.status !== "promoted"
                ? buildDerivedResult(
                      input,
                      persistedRepair.derived_status,
                      asStoredStatus(batch.status),
                      persistedRepair.derived_status_reason
                  )
                : derivePublishBatchStatus(input);

        return {
            ...input,
            derived_status: derived.derived_status,
            derived_status_reason: derived.derived_status_reason,
            stored_status_recommendation: derived.stored_status_recommendation,
            status_note: derived.derived_status_reason,
            inserted_count: action_counts.inserted,
            updated_count: action_counts.updated,
            by_entity_family: familyRows.map((row) => ({
                entity_family: row.entity_family,
                pending: n(row.pending),
                success: n(row.success),
                failed: n(row.failed),
                skipped: n(row.skipped),
                total: n(row.total),
            })),
        };
    }

    async countCoreVerified(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM system.system_publish_items AS spi
            WHERE spi.publish_batch_id = ${batchId}
              AND spi.publish_status = 'success'
              AND spi.target_id IS NOT NULL
              AND (${coreVerificationExistsUnionSql()})
        `;
        return n(rows[0]?.count ?? 0n);
    }

    async countMarkedPromoted(batchId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM (
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.building_candidates AS b
                    ON b.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${BUILDING_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND b.promotion_status = 'promoted'
                  AND b.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.place_candidates AS p
                    ON p.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${PLACE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND p.promotion_status = 'promoted'
                  AND p.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.landuse_candidates AS lu
                    ON lu.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${LANDUSE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND lu.promotion_status = 'promoted'
                  AND lu.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_line_candidates AS wl
                    ON wl.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_LINE_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND wl.promotion_status = 'promoted'
                  AND wl.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.water_polygon_candidates AS wp
                    ON wp.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${WATER_POLYGON_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND wp.promotion_status = 'promoted'
                  AND wp.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.road_candidates AS r
                    ON r.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ROAD_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND r.promotion_status = 'promoted'
                  AND r.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.admin_area_candidates AS aa
                    ON aa.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ADMIN_AREA_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND aa.promotion_status = 'promoted'
                  AND aa.promoted_core_id IS NOT NULL
                UNION ALL
                SELECT spi.id
                FROM system.system_publish_items AS spi
                INNER JOIN import_review.routing_barrier_candidates AS rb
                    ON rb.id = spi.review_candidate_id
                   AND spi.review_candidate_table = ${ROUTING_BARRIER_CANDIDATE_TABLE}
                WHERE spi.publish_batch_id = ${batchId}
                  AND spi.publish_status = 'success'
                  AND rb.promotion_status = 'promoted'
                  AND rb.promoted_core_id IS NOT NULL
            ) AS marked
        `;
        return n(rows[0]?.count ?? 0n);
    }

    async syncPublishBatchSummary(batchId: bigint): Promise<PublishBatchComputedSummary | null> {
        const computed = await this.computePublishBatchSummary(batchId);
        if (!computed) {
            return null;
        }

        const { item_counts, derived_status, derived_status_reason, stored_status_recommendation } =
            computed;
        let storedStatus = computed.stored_status;
        const summaryRows = await this.prisma.$queryRaw<{ summary: unknown }[]>`
            SELECT summary FROM system.system_publish_batches WHERE id = ${batchId} LIMIT 1
        `;
        const promotionStatus = parsePromotionStatusFromSummary(summaryRows[0]?.summary);

        if (
            derived_status === "invalid_empty_promoted" ||
            (storedStatus === "promoted" && stored_status_recommendation !== "promoted")
        ) {
            storedStatus = stored_status_recommendation;
        } else if (derived_status === "promoted" && stored_status_recommendation === "promoted") {
            storedStatus = "promoted";
        } else if (derived_status === "failed" || derived_status === "blocked") {
            if (
                storedStatus === "promoted" ||
                storedStatus === "promoting" ||
                storedStatus === "partial" ||
                promotionStatus === "promotion_failed"
            ) {
                storedStatus = stored_status_recommendation;
            }
        }

        const repairNote =
            derived_status === "invalid_empty_promoted" ? INVALID_EMPTY_PROMOTED_REPAIR_NOTE : null;
        const repairedAt = repairNote ? new Date().toISOString() : null;
        const clearPromotedAt =
            (derived_status === "invalid_empty_promoted" && item_counts.success === 0) ||
            (promotionStatus === "promotion_failed" && item_counts.success === 0);

        const summaryPatch = JSON.stringify({
            recomputed_at: new Date().toISOString(),
            recomputed_counts: {
                total_item_count: item_counts.total,
                success_count: item_counts.success,
                failed_count: item_counts.failed,
                skipped_count: item_counts.skipped,
                core_verified_count: computed.core_verified_count,
                import_review_marked_promoted_count: computed.import_review_marked_promoted_count,
                inserted_count: computed.inserted_count,
                updated_count: computed.updated_count,
            },
            derived_status,
            derived_status_reason,
            empty_promoted_invalid: derived_status === "invalid_empty_promoted",
            status_note: derived_status_reason,
            ...(repairNote
                ? {
                      repair_note: repairNote,
                      repaired_at: repairedAt,
                  }
                : {}),
        });

        await this.prisma.$executeRaw`
            UPDATE system.system_publish_batches
            SET
                total_item_count = ${item_counts.total},
                success_count = ${item_counts.success},
                failed_count = ${item_counts.failed},
                skipped_count = ${item_counts.skipped},
                status = ${storedStatus},
                promoted_at = CASE
                    WHEN ${clearPromotedAt} THEN NULL
                    ELSE promoted_at
                END,
                summary = coalesce(summary, '{}'::jsonb) || ${summaryPatch}::jsonb,
                note = CASE
                    WHEN ${derived_status} = 'invalid_empty_promoted'
                        THEN coalesce(note, '') || ' [repaired: invalid empty promoted batch]'
                    ELSE note
                END
            WHERE id = ${batchId}
        `;

        return { ...computed, stored_status: storedStatus };
    }

    async repairInvalidEmptyPromotedBatches(options: {
        batchId?: bigint;
        reviewBatchId?: bigint;
    } = {}): Promise<{
        scanned: number;
        repaired: number;
        skipped: number;
        batches: Array<{
            id: string;
            previous_status: string;
            new_status: string;
            derived_status: PublishBatchDerivedStatus;
        }>;
    }> {
        const batchRows = await this.prisma.$queryRaw<
            { id: bigint; status: string }[]
        >`
            SELECT id, status
            FROM system.system_publish_batches AS pb
            WHERE pb.status = 'promoted'
              AND coalesce(pb.summary->'creation_result'->>'dry_run', 'false') <> 'true'
              AND (${options.batchId ?? null}::bigint IS NULL OR pb.id = ${options.batchId ?? null})
              AND (${options.reviewBatchId ?? null}::bigint IS NULL OR pb.source_review_batch_id = ${options.reviewBatchId ?? null})
            ORDER BY pb.id ASC
        `;

        let repaired = 0;
        let skipped = 0;
        const batches: Array<{
            id: string;
            previous_status: string;
            new_status: string;
            derived_status: PublishBatchDerivedStatus;
        }> = [];

        for (const row of batchRows) {
            const computed = await this.computePublishBatchSummary(row.id);
            if (!computed || computed.derived_status !== "invalid_empty_promoted") {
                skipped += 1;
                continue;
            }
            if (isGenuinelyPromotedBatch(computed)) {
                skipped += 1;
                continue;
            }

            const previousStatus = row.status;
            const synced = await this.syncPublishBatchSummary(row.id);
            if (!synced) {
                skipped += 1;
                continue;
            }

            repaired += 1;
            batches.push({
                id: row.id.toString(),
                previous_status: previousStatus,
                new_status: synced.stored_status,
                derived_status: synced.derived_status,
            });
        }

        return {
            scanned: batchRows.length,
            repaired,
            skipped,
            batches,
        };
    }
}

export function applyComputedCountsToBatchSummary<
    T extends {
        total_item_count: number;
        success_count: number;
        failed_count: number;
        skipped_count: number;
        status: string;
    },
>(
    batch: T,
    computed: PublishBatchComputedSummary | null
): T & {
    derived_status: PublishBatchDerivedStatus;
    derived_status_reason: string | null;
    stored_status_recommendation: PublishBatchStoredStatus;
    status_note: string | null;
    core_verified_count: number;
    import_review_marked_promoted_count: number;
    inserted_count: number;
    updated_count: number;
} {
    if (!computed) {
        return {
            ...batch,
            derived_status: batch.status as PublishBatchDerivedStatus,
            derived_status_reason: null,
            stored_status_recommendation: asStoredStatus(batch.status),
            status_note: null,
            core_verified_count: 0,
            import_review_marked_promoted_count: 0,
            inserted_count: 0,
            updated_count: 0,
        };
    }
    return {
        ...batch,
        status: computed.stored_status,
        total_item_count: computed.item_counts.total,
        success_count: computed.item_counts.success,
        failed_count: computed.item_counts.failed,
        skipped_count: computed.item_counts.skipped,
        derived_status: computed.derived_status,
        derived_status_reason: computed.derived_status_reason,
        stored_status_recommendation: computed.stored_status_recommendation,
        status_note: computed.derived_status_reason,
        core_verified_count: computed.core_verified_count,
        import_review_marked_promoted_count: computed.import_review_marked_promoted_count,
        inserted_count: computed.inserted_count,
        updated_count: computed.updated_count,
    };
}

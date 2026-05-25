import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    ImportReviewAddressLinkedPlaceSummary,
    ImportReviewAddressMatchedCorePlaceSummary,
    ImportReviewAddressPlaceAddressLinkSummary,
} from "./import-review-address-responses.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";

export type AddressPlaceWorkflowContextRow = {
    id: bigint;
    review_batch_id: bigint;
    source_snapshot_version: string;
    source_snapshot_id_local: bigint | null;
    local_staging_id: bigint;
    external_id: string | null;
    canonical_name: string | null;
    class_code: string | null;
    confidence_score: unknown;
    normalized_data: unknown;
    source_refs: unknown;
    source_tags: unknown;
    source_classification: string | null;
    has_place_evidence: boolean | null;
    address_strength: string | null;
    place_candidate_status: string | null;
    linked_place_candidate_id: bigint | null;
    matched_core_place_id: bigint | null;
};

type PlaceCandidateSummaryRow = {
    id: bigint;
    external_id: string | null;
    canonical_name: string | null;
    display_name: string | null;
    class_code: string | null;
    review_status: string | null;
    promotion_status: string | null;
    validation_status: string | null;
    validation_errors: unknown;
    validation_warnings: unknown;
};

type CorePlaceSummaryRow = {
    id: bigint;
    display_name: string | null;
    canonical_name: string | null;
    category_name: string | null;
};

type PlaceAddressLinkSummaryRow = {
    id: bigint;
    place_candidate_id: bigint | null;
    address_candidate_id: bigint;
    relation_type: string | null;
    is_primary: boolean | null;
    confidence_score: unknown;
    match_status: string | null;
    review_status: string | null;
    validation_status: string | null;
    promotion_status: string | null;
    validation_errors: unknown;
    validation_warnings: unknown;
};

export type AddressPlaceWorkflowSummary = {
    linked_place_candidate: ImportReviewAddressLinkedPlaceSummary | null;
    matched_core_place: ImportReviewAddressMatchedCorePlaceSummary | null;
    place_address_link: ImportReviewAddressPlaceAddressLinkSummary | null;
};

export type CreatePlaceCandidateResult = AddressPlaceWorkflowSummary & {
    address_candidate_id: string;
    linked_place_candidate_id: string | null;
    matched_core_place_id: string | null;
    place_candidate_status: string | null;
};

export type PatchPlaceStatusResult = AddressPlaceWorkflowSummary & {
    address_candidate_id: string;
    linked_place_candidate_id: string | null;
    matched_core_place_id: string | null;
    place_candidate_status: string | null;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

function bigStr(v: bigint | null | undefined): string | null {
    return v === null || v === undefined ? null : v.toString();
}

function numOrNull(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const n = typeof value === "bigint" ? Number(value) : Number(value);
    return Number.isFinite(n) ? n : null;
}

function toLinkedPlaceSummary(row: PlaceCandidateSummaryRow | null): ImportReviewAddressLinkedPlaceSummary | null {
    if (row === null) {
        return null;
    }
    return {
        id: row.id.toString(),
        external_id: row.external_id,
        canonical_name: row.canonical_name,
        display_name: row.display_name,
        class_code: row.class_code,
        review_status: row.review_status,
        promotion_status: row.promotion_status,
        validation_status: row.validation_status,
        validation_errors: row.validation_errors ?? [],
        validation_warnings: row.validation_warnings ?? [],
    };
}

function toCorePlaceSummary(row: CorePlaceSummaryRow | null): ImportReviewAddressMatchedCorePlaceSummary | null {
    if (row === null) {
        return null;
    }
    return {
        id: row.id.toString(),
        display_name: row.display_name,
        canonical_name: row.canonical_name,
        category_name: row.category_name,
    };
}

function toLinkSummary(row: PlaceAddressLinkSummaryRow | null): ImportReviewAddressPlaceAddressLinkSummary | null {
    if (row === null) {
        return null;
    }
    return {
        id: row.id.toString(),
        place_candidate_id: bigStr(row.place_candidate_id),
        address_candidate_id: row.address_candidate_id.toString(),
        relation_type: row.relation_type,
        is_primary: row.is_primary,
        confidence_score: numOrNull(row.confidence_score),
        match_status: row.match_status,
        review_status: row.review_status,
        validation_status: row.validation_status,
        promotion_status: row.promotion_status,
        validation_errors: row.validation_errors ?? [],
        validation_warnings: row.validation_warnings ?? [],
    };
}

export class ImportReviewAddressPlaceWorkflowRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async getAddressContext(candidateId: bigint, tx: DbClient = this.prisma): Promise<AddressPlaceWorkflowContextRow | null> {
        const rows = await tx.$queryRaw<AddressPlaceWorkflowContextRow[]>`
            SELECT
                c.id,
                c.review_batch_id,
                c.source_snapshot_version,
                c.source_snapshot_id_local,
                c.local_staging_id,
                c.external_id,
                c.canonical_name,
                c.class_code,
                c.confidence_score,
                COALESCE(to_jsonb(c.normalized_data), '{}'::jsonb) AS normalized_data,
                COALESCE(to_jsonb(c.source_refs), '{}'::jsonb) AS source_refs,
                COALESCE(to_jsonb(c.source_tags), '{}'::jsonb) AS source_tags,
                c.source_classification,
                c.has_place_evidence,
                c.address_strength,
                c.place_candidate_status,
                c.linked_place_candidate_id,
                c.matched_core_place_id
            FROM import_review.address_candidates AS c
            WHERE c.id = ${candidateId}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async getSummary(candidateId: bigint, tx: DbClient = this.prisma): Promise<AddressPlaceWorkflowSummary> {
        const addressRows = await tx.$queryRaw<
            Array<{
                linked_place_candidate_id: bigint | null;
                matched_core_place_id: bigint | null;
            }>
        >`
            SELECT linked_place_candidate_id, matched_core_place_id
            FROM import_review.address_candidates
            WHERE id = ${candidateId}
            LIMIT 1
        `;
        const address = addressRows[0];
        if (address === undefined) {
            return {
                linked_place_candidate: null,
                matched_core_place: null,
                place_address_link: null,
            };
        }

        const [place, corePlace, link] = await Promise.all([
            address.linked_place_candidate_id === null
                ? Promise.resolve(null)
                : this.getPlaceCandidateSummary(address.linked_place_candidate_id, tx),
            address.matched_core_place_id === null
                ? Promise.resolve(null)
                : this.getCorePlaceSummary(address.matched_core_place_id, tx),
            this.getPrimaryLinkSummary(candidateId, tx),
        ]);

        return {
            linked_place_candidate: place,
            matched_core_place: corePlace,
            place_address_link: link,
        };
    }

    async createOrLinkPlaceCandidate(args: {
        candidateId: bigint;
        sourceName: string;
        sourceTypeHint: string | null;
        normalizedData: Record<string, unknown>;
        sourceRefs: Record<string, unknown>;
        linkConfidenceScore: number | null;
    }): Promise<CreatePlaceCandidateResult | null> {
        return this.prisma.$transaction(async (tx) => {
            const lockedRows = await tx.$queryRaw<AddressPlaceWorkflowContextRow[]>`
                SELECT
                    c.id,
                    c.review_batch_id,
                    c.source_snapshot_version,
                    c.source_snapshot_id_local,
                    c.local_staging_id,
                    c.external_id,
                    c.canonical_name,
                    c.class_code,
                    c.confidence_score,
                    COALESCE(to_jsonb(c.normalized_data), '{}'::jsonb) AS normalized_data,
                    COALESCE(to_jsonb(c.source_refs), '{}'::jsonb) AS source_refs,
                    COALESCE(to_jsonb(c.source_tags), '{}'::jsonb) AS source_tags,
                    c.source_classification,
                    c.has_place_evidence,
                    c.address_strength,
                    c.place_candidate_status,
                    c.linked_place_candidate_id,
                    c.matched_core_place_id
                FROM import_review.address_candidates AS c
                WHERE c.id = ${args.candidateId}
                FOR UPDATE
            `;
            const candidate = lockedRows[0];
            if (candidate === undefined) {
                return null;
            }

            let placeId = candidate.linked_place_candidate_id;
            if (placeId === null) {
                const existingRows = await tx.$queryRaw<Array<{ id: bigint }>>`
                    SELECT p.id
                    FROM import_review.place_candidates AS p
                    WHERE p.review_batch_id = ${candidate.review_batch_id}
                      AND p.entity_family = 'places'
                      AND (
                          p.local_staging_id = ${-candidate.id}
                          OR (
                              ${candidate.external_id} IS NOT NULL
                              AND p.external_id = ${candidate.external_id}
                          )
                      )
                    ORDER BY
                        CASE WHEN p.local_staging_id = ${-candidate.id} THEN 0 ELSE 1 END,
                        p.id ASC
                    LIMIT 1
                `;
                placeId = existingRows[0]?.id ?? null;
            }

            if (placeId === null) {
                const normalizedJson = JSON.stringify(args.normalizedData);
                const sourceRefsJson = JSON.stringify(args.sourceRefs);
                const insertedRows = await tx.$queryRaw<Array<{ id: bigint }>>`
                    INSERT INTO import_review.place_candidates (
                        review_batch_id,
                        source_snapshot_version,
                        source_snapshot_id_local,
                        local_staging_id,
                        entity_family,
                        external_id,
                        canonical_name,
                        class_code,
                        confidence_score,
                        match_status,
                        auto_action,
                        review_status,
                        review_decision,
                        normalized_data,
                        source_refs,
                        matched_core_id,
                        matched_core_table,
                        matched_core_data,
                        f2_comparison,
                        primary_name,
                        display_name,
                        category_id,
                        place_class_id,
                        admin_area_id,
                        point_geom,
                        lat,
                        lng,
                        promotion_status,
                        updated_at
                    )
                    SELECT
                        c.review_batch_id,
                        c.source_snapshot_version,
                        c.source_snapshot_id_local,
                        -c.id,
                        'places',
                        c.external_id,
                        ${args.sourceName},
                        ${args.sourceTypeHint},
                        COALESCE(c.confidence_score, 75),
                        'new_auto',
                        'insert_candidate',
                        'pending',
                        NULL,
                        ${normalizedJson}::jsonb,
                        ${sourceRefsJson}::jsonb,
                        NULL,
                        NULL,
                        NULL,
                        NULL,
                        ${args.sourceName},
                        ${args.sourceName},
                        NULL,
                        NULL,
                        NULL,
                        c.point_geom,
                        CASE
                            WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                                THEN ST_Y(c.point_geom)::double precision
                            ELSE NULL
                        END,
                        CASE
                            WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                                THEN ST_X(c.point_geom)::double precision
                            ELSE NULL
                        END,
                        'not_ready',
                        now()
                    FROM import_review.address_candidates AS c
                    WHERE c.id = ${candidate.id}
                    RETURNING id
                `;
                placeId = insertedRows[0]?.id ?? null;
            }

            if (placeId === null) {
                return null;
            }

            await tx.$executeRaw`
                UPDATE import_review.address_candidates
                SET
                    linked_place_candidate_id = ${placeId},
                    place_candidate_status = 'place_candidate_created',
                    updated_at = now()
                WHERE id = ${candidate.id}
            `;

            if (args.linkConfidenceScore !== null) {
                await tx.$executeRaw`
                    INSERT INTO import_review.place_address_links (
                        review_batch_id,
                        source_snapshot_id,
                        external_id,
                        place_candidate_id,
                        address_candidate_id,
                        relation_type,
                        is_primary,
                        confidence_score,
                        match_status,
                        review_status,
                        validation_status,
                        promotion_status,
                        source_refs,
                        normalized_data,
                        updated_at
                    )
                    SELECT
                        c.review_batch_id,
                        c.source_snapshot_id_local,
                        c.external_id,
                        ${placeId},
                        c.id,
                        'primary',
                        true,
                        ${args.linkConfidenceScore},
                        'new_auto',
                        'pending',
                        'not_checked',
                        'not_ready',
                        jsonb_build_object(
                            'created_by', 'import-review-address-api',
                            'address_candidate_id', c.id,
                            'place_candidate_id', ${placeId}
                        ),
                        jsonb_build_object(
                            'source', 'address_place_workflow',
                            'address_strength', c.address_strength,
                            'source_classification', c.source_classification
                        ),
                        now()
                    FROM import_review.address_candidates AS c
                    WHERE c.id = ${candidate.id}
                      AND NOT EXISTS (
                          SELECT 1
                          FROM import_review.place_address_links AS pal
                          WHERE pal.review_batch_id = c.review_batch_id
                            AND pal.place_candidate_id = ${placeId}
                            AND pal.address_candidate_id = c.id
                            AND pal.relation_type = 'primary'
                      )
                `;
            }

            const summary = await this.getSummary(candidate.id, tx);
            return {
                address_candidate_id: candidate.id.toString(),
                linked_place_candidate_id: placeId.toString(),
                matched_core_place_id: bigStr(candidate.matched_core_place_id),
                place_candidate_status: "place_candidate_created",
                ...summary,
            };
        });
    }

    async patchPlaceStatus(args: {
        candidateId: bigint;
        placeCandidateStatus?: "ignored";
        matchedCorePlaceId?: bigint | null;
        clearLinkedPlaceCandidate?: boolean;
    }): Promise<PatchPlaceStatusResult | null> {
        return this.prisma.$transaction(async (tx) => {
            const lockedRows = await tx.$queryRaw<AddressPlaceWorkflowContextRow[]>`
                SELECT
                    c.id,
                    c.review_batch_id,
                    c.source_snapshot_version,
                    c.source_snapshot_id_local,
                    c.local_staging_id,
                    c.external_id,
                    c.canonical_name,
                    c.class_code,
                    c.confidence_score,
                    COALESCE(to_jsonb(c.normalized_data), '{}'::jsonb) AS normalized_data,
                    COALESCE(to_jsonb(c.source_refs), '{}'::jsonb) AS source_refs,
                    COALESCE(to_jsonb(c.source_tags), '{}'::jsonb) AS source_tags,
                    c.source_classification,
                    c.has_place_evidence,
                    c.address_strength,
                    c.place_candidate_status,
                    c.linked_place_candidate_id,
                    c.matched_core_place_id
                FROM import_review.address_candidates AS c
                WHERE c.id = ${args.candidateId}
                FOR UPDATE
            `;
            const candidate = lockedRows[0];
            if (candidate === undefined) {
                return null;
            }

            if (args.clearLinkedPlaceCandidate === true) {
                const unsafeRows = await tx.$queryRaw<Array<{ count: bigint }>>`
                    SELECT count(*)::bigint AS count
                    FROM import_review.place_address_links AS pal
                    WHERE pal.address_candidate_id = ${candidate.id}
                      AND (
                          pal.promotion_status NOT IN ('not_ready', 'failed', 'skipped')
                          OR pal.review_status = 'promoted'
                      )
                `;
                if ((unsafeRows[0]?.count ?? 0n) > 0n) {
                    throw new ImportReviewDecisionRuleError(
                        "Cannot clear linked place candidate because a non-clearable place/address link exists."
                    );
                }

                await tx.$executeRaw`
                    DELETE FROM import_review.place_address_links AS pal
                    WHERE pal.address_candidate_id = ${candidate.id}
                      AND pal.promotion_status IN ('not_ready', 'failed', 'skipped')
                `;
            }

            const setParts: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];
            if (args.clearLinkedPlaceCandidate === true) {
                setParts.push(Prisma.sql`linked_place_candidate_id = NULL`);
            }
            if (args.matchedCorePlaceId !== undefined) {
                setParts.push(Prisma.sql`matched_core_place_id = ${args.matchedCorePlaceId}`);
                if (args.matchedCorePlaceId !== null) {
                    setParts.push(Prisma.sql`place_candidate_status = 'matched_core_place'`);
                }
            }
            if (args.placeCandidateStatus === "ignored") {
                setParts.push(Prisma.sql`place_candidate_status = 'ignored'`);
            } else if (
                args.clearLinkedPlaceCandidate === true &&
                args.matchedCorePlaceId === undefined
            ) {
                setParts.push(
                    Prisma.sql`place_candidate_status = CASE WHEN has_place_evidence THEN 'needs_place_candidate' ELSE 'not_applicable' END`
                );
            }

            const updatedRows = await tx.$queryRaw<
                Array<{
                    linked_place_candidate_id: bigint | null;
                    matched_core_place_id: bigint | null;
                    place_candidate_status: string | null;
                }>
            >`
                UPDATE import_review.address_candidates
                SET ${Prisma.join(setParts, ", ")}
                WHERE id = ${candidate.id}
                RETURNING linked_place_candidate_id, matched_core_place_id, place_candidate_status
            `;
            const updated = updatedRows[0];
            if (updated === undefined) {
                return null;
            }

            const summary = await this.getSummary(candidate.id, tx);
            return {
                address_candidate_id: candidate.id.toString(),
                linked_place_candidate_id: bigStr(updated.linked_place_candidate_id),
                matched_core_place_id: bigStr(updated.matched_core_place_id),
                place_candidate_status: updated.place_candidate_status,
                ...summary,
            };
        });
    }

    async getCorePlaceSummary(placeId: bigint, tx: DbClient = this.prisma): Promise<ImportReviewAddressMatchedCorePlaceSummary | null> {
        const rows = await tx.$queryRaw<CorePlaceSummaryRow[]>`
            SELECT
                p.id,
                p.display_name,
                p.primary_name AS canonical_name,
                pc.name AS category_name
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS pc ON pc.id = p.category_id
            WHERE p.id = ${placeId}
              AND p.deleted_at IS NULL
            LIMIT 1
        `;
        return toCorePlaceSummary(rows[0] ?? null);
    }

    private async getPlaceCandidateSummary(
        placeId: bigint,
        tx: DbClient = this.prisma
    ): Promise<ImportReviewAddressLinkedPlaceSummary | null> {
        const rows = await tx.$queryRaw<PlaceCandidateSummaryRow[]>`
            SELECT
                p.id,
                p.external_id,
                p.canonical_name,
                p.display_name,
                p.class_code,
                p.review_status,
                p.promotion_status,
                CASE
                    WHEN jsonb_array_length(COALESCE(to_jsonb(p.validation_errors), '[]'::jsonb)) > 0 THEN 'blocked'
                    WHEN jsonb_array_length(COALESCE(to_jsonb(p.validation_warnings), '[]'::jsonb)) > 0 THEN 'valid_with_warnings'
                    ELSE 'valid'
                END AS validation_status,
                COALESCE(to_jsonb(p.validation_errors), '[]'::jsonb) AS validation_errors,
                COALESCE(to_jsonb(p.validation_warnings), '[]'::jsonb) AS validation_warnings
            FROM import_review.place_candidates AS p
            WHERE p.id = ${placeId}
            LIMIT 1
        `;
        return toLinkedPlaceSummary(rows[0] ?? null);
    }

    private async getPrimaryLinkSummary(
        candidateId: bigint,
        tx: DbClient = this.prisma
    ): Promise<ImportReviewAddressPlaceAddressLinkSummary | null> {
        const rows = await tx.$queryRaw<PlaceAddressLinkSummaryRow[]>`
            SELECT
                pal.id,
                pal.place_candidate_id,
                pal.address_candidate_id,
                pal.relation_type,
                pal.is_primary,
                pal.confidence_score,
                pal.match_status,
                pal.review_status,
                pal.validation_status,
                pal.promotion_status,
                COALESCE(to_jsonb(pal.validation_errors), '[]'::jsonb) AS validation_errors,
                COALESCE(to_jsonb(pal.validation_warnings), '[]'::jsonb) AS validation_warnings
            FROM import_review.place_address_links AS pal
            WHERE pal.address_candidate_id = ${candidateId}
            ORDER BY pal.is_primary DESC NULLS LAST, pal.updated_at DESC, pal.id DESC
            LIMIT 1
        `;
        return toLinkSummary(rows[0] ?? null);
    }
}

import { Prisma, type PrismaClient } from "@prisma/client";

import type { AddressValidationIssue } from "./import-review-address-validation.types.js";

export type AddressCandidateValidationRowDb = {
    id: bigint;
    review_batch_id: bigint;
    point_geom_present: boolean;
    entrance_geom_present: boolean;
    matched_admin_area_id: bigint | null;
    matched_street_id: bigint | null;
    review_status: string | null;
    promotion_status: string | null;
    promoted_core_address_id: bigint | null;
    point_wkt: string | null;
};

export type AddressComponentValidationRowDb = {
    id: bigint;
    address_candidate_id: bigint;
    component_type_code: string;
    component_value: string;
    language_code: string;
    confidence_score: unknown;
    match_type: string | null;
    source_admin_area_id: bigint | null;
    boundary_status: string | null;
    address_usage: string | null;
    is_deleted: boolean;
};

export type CoreAddressDuplicateRowDb = {
    address_candidate_id: bigint;
    core_address_id: bigint;
    distance_m: number;
};

export class ImportReviewAddressValidationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async reviewBatchExists(reviewBatchId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ exists: boolean }>>`
            SELECT EXISTS (
                SELECT 1 FROM import_review.review_batches WHERE id = ${reviewBatchId}
            ) AS exists
        `;
        return rows[0]?.exists === true;
    }

    async listValidComponentTypeCodes(): Promise<Set<string>> {
        const rows = await this.prisma.$queryRaw<Array<{ code: string }>>`
            SELECT code
            FROM ref.ref_address_component_types
        `;
        return new Set(rows.map((r) => r.code));
    }

    async listCandidatesForValidation(args: {
        reviewBatchId?: bigint | undefined;
        candidateIds?: readonly bigint[] | undefined;
    }): Promise<AddressCandidateValidationRowDb[]> {
        if (args.candidateIds && args.candidateIds.length > 0) {
            return this.prisma.$queryRaw<AddressCandidateValidationRowDb[]>`
                SELECT
                    c.id,
                    c.review_batch_id,
                    (c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)) AS point_geom_present,
                    (c.entrance_geom IS NOT NULL AND NOT ST_IsEmpty(c.entrance_geom)) AS entrance_geom_present,
                    c.matched_admin_area_id,
                    c.matched_street_id,
                    c.review_status,
                    c.promotion_status,
                    c.promoted_core_address_id,
                    CASE
                        WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                            THEN ST_AsText(c.point_geom)
                        ELSE NULL
                    END AS point_wkt
                FROM import_review.address_candidates AS c
                WHERE c.id = ANY(${args.candidateIds}::bigint[])
                ORDER BY c.id ASC
            `;
        }

        if (args.reviewBatchId === undefined) {
            return [];
        }

        return this.prisma.$queryRaw<AddressCandidateValidationRowDb[]>`
            SELECT
                c.id,
                c.review_batch_id,
                (c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)) AS point_geom_present,
                (c.entrance_geom IS NOT NULL AND NOT ST_IsEmpty(c.entrance_geom)) AS entrance_geom_present,
                c.matched_admin_area_id,
                c.matched_street_id,
                c.review_status,
                c.promotion_status,
                c.promoted_core_address_id,
                CASE
                    WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                        THEN ST_AsText(c.point_geom)
                    ELSE NULL
                END AS point_wkt
            FROM import_review.address_candidates AS c
            WHERE c.review_batch_id = ${args.reviewBatchId}
            ORDER BY c.id ASC
        `;
    }

    async listComponentsForCandidates(
        candidateIds: readonly bigint[]
    ): Promise<AddressComponentValidationRowDb[]> {
        if (candidateIds.length === 0) {
            return [];
        }
        return this.prisma.$queryRaw<AddressComponentValidationRowDb[]>`
            SELECT
                ac.id,
                ac.address_candidate_id,
                ac.component_type_code,
                ac.component_value,
                ac.language_code,
                ac.confidence_score,
                ac.match_type,
                ac.source_admin_area_id,
                ac.boundary_status,
                ac.address_usage,
                ac.is_deleted
            FROM import_review.address_components AS ac
            WHERE ac.address_candidate_id = ANY(${candidateIds}::bigint[])
            ORDER BY ac.address_candidate_id ASC, ac.id ASC
        `;
    }

    async findCoreAddressDuplicates(args: {
        candidates: readonly AddressCandidateValidationRowDb[];
        houseNumberByCandidate: ReadonlyMap<bigint, string | null>;
        postcodeByCandidate: ReadonlyMap<bigint, string | null>;
        maxDistanceM: number;
        closeDistanceM: number;
    }): Promise<CoreAddressDuplicateRowDb[]> {
        const withPoint = args.candidates.filter((c) => c.point_wkt !== null);
        if (withPoint.length === 0) {
            return [];
        }

        if (!(await this.tableExists("core.core_addresses"))) {
            return [];
        }

        return this.prisma.$queryRaw<CoreAddressDuplicateRowDb[]>`
            WITH candidates AS (
                SELECT *
                FROM jsonb_to_recordset(${JSON.stringify(
                    withPoint.map((c) => ({
                        address_candidate_id: c.id.toString(),
                        point_wkt: c.point_wkt,
                        matched_street_id: c.matched_street_id?.toString() ?? null,
                        matched_admin_area_id: c.matched_admin_area_id?.toString() ?? null,
                        house_number: args.houseNumberByCandidate.get(c.id) ?? null,
                        postcode: args.postcodeByCandidate.get(c.id) ?? null,
                        promoted_core_address_id: c.promoted_core_address_id?.toString() ?? null,
                    }))
                )}::jsonb) AS x(
                    address_candidate_id text,
                    point_wkt text,
                    matched_street_id text,
                    matched_admin_area_id text,
                    house_number text,
                    postcode text,
                    promoted_core_address_id text
                )
            )
            SELECT
                c.address_candidate_id::bigint,
                a.id AS core_address_id,
                ST_Distance(
                    a.point_geom::geography,
                    ST_GeomFromText(c.point_wkt, 4326)::geography
                ) AS distance_m
            FROM candidates AS c
            INNER JOIN core.core_addresses AS a
                ON a.deleted_at IS NULL
               AND a.point_geom IS NOT NULL
               AND NOT ST_IsEmpty(a.point_geom)
               AND ST_DWithin(
                   a.point_geom::geography,
                   ST_GeomFromText(c.point_wkt, 4326)::geography,
                   ${args.maxDistanceM}
               )
               AND (
                   c.promoted_core_address_id IS NULL
                   OR a.id <> c.promoted_core_address_id::bigint
               )
            WHERE
                (
                    ST_DWithin(
                        a.point_geom::geography,
                        ST_GeomFromText(c.point_wkt, 4326)::geography,
                        ${args.closeDistanceM}
                    )
                    AND c.house_number IS NOT NULL
                    AND btrim(c.house_number) <> ''
                    AND a.house_number IS NOT NULL
                    AND btrim(a.house_number) = btrim(c.house_number)
                    AND c.matched_street_id IS NOT NULL
                    AND a.street_id = c.matched_street_id::bigint
                    AND c.matched_admin_area_id IS NOT NULL
                    AND a.admin_area_id = c.matched_admin_area_id::bigint
                )
                OR (
                    c.matched_street_id IS NOT NULL
                    AND a.street_id = c.matched_street_id::bigint
                    AND c.matched_admin_area_id IS NOT NULL
                    AND a.admin_area_id = c.matched_admin_area_id::bigint
                    AND (
                        (c.postcode IS NOT NULL AND btrim(c.postcode) <> '' AND a.postcode = c.postcode)
                        OR (c.postcode IS NOT NULL AND btrim(c.postcode) <> '' AND a.postal_code = c.postcode)
                    )
                    AND (
                        c.house_number IS NULL
                        OR btrim(c.house_number) = ''
                        OR a.house_number IS NULL
                        OR btrim(a.house_number) = btrim(c.house_number)
                    )
                )
            ORDER BY c.address_candidate_id, distance_m ASC
        `;
    }

    async persistValidationResult(args: {
        candidateId: bigint;
        validationStatus: string;
        promotionBlockers: AddressValidationIssue[];
        promotionWarnings: AddressValidationIssue[];
    }): Promise<void> {
        const blockersJson = JSON.stringify(args.promotionBlockers);
        const warningsJson = JSON.stringify(args.promotionWarnings);

        await this.prisma.$executeRaw`
            UPDATE import_review.address_candidates
            SET
                validation_status = ${args.validationStatus},
                promotion_blockers = ${blockersJson}::jsonb,
                promotion_warnings = ${warningsJson}::jsonb,
                validation_errors = ${blockersJson}::jsonb,
                validation_warnings = ${warningsJson}::jsonb,
                validated_at = now(),
                updated_at = now()
            WHERE id = ${args.candidateId}
        `;
    }

    private async tableExists(qualified: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
            SELECT to_regclass(${qualified}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }
}

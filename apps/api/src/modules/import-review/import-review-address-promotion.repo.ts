import { Prisma, type PrismaClient } from "@prisma/client";

export type ImportReviewAddressPromotionDb = PrismaClient | Prisma.TransactionClient;

import type { AddressValidationIssue } from "./import-review-address-validation.types.js";
import type {
    CoreAddressDuplicateRowDb,
    AddressCandidateValidationRowDb,
    AddressComponentValidationRowDb,
} from "./import-review-address-validation.repo.js";
import { ImportReviewAddressValidationRepository } from "./import-review-address-validation.repo.js";

export type AddressPromotionCandidateRowDb = AddressCandidateValidationRowDb & {
    external_id: string | null;
    review_decision: string | null;
    validation_status: string | null;
    promotion_blockers: unknown;
    promotion_warnings: unknown;
    matched_building_id: bigint | null;
    matched_place_id: bigint | null;
    confidence_score: unknown;
    source_refs: unknown;
    entrance_geom_present: boolean;
    entrance_wkt: string | null;
};

export type CoreAddressColumnCaps = {
    hasStreetId: boolean;
    hasAdminAreaId: boolean;
    hasUnitNumber: boolean;
    hasEntranceGeom: boolean;
    hasPostalCode: boolean;
    hasPostcode: boolean;
    hasIsPublic: boolean;
    hasConfidenceScore: boolean;
    hasNormalizedData: boolean;
};

export type CoreAddressComponentColumnCaps = {
    hasComponentTypeCode: boolean;
    hasSourceRefs: boolean;
    hasConfidenceScore: boolean;
    hasMatchType: boolean;
    hasSourceAdminAreaId: boolean;
    hasBoundaryStatus: boolean;
    hasAddressUsage: boolean;
    hasUpdatedAt: boolean;
};

export class ImportReviewAddressPromotionRepository {
    private readonly validationRepo: ImportReviewAddressValidationRepository;

    constructor(private readonly prisma: ImportReviewAddressPromotionDb) {
        this.validationRepo = new ImportReviewAddressValidationRepository(
            prisma as PrismaClient
        );
    }

    async reviewBatchExists(reviewBatchId: bigint): Promise<boolean> {
        return this.validationRepo.reviewBatchExists(reviewBatchId);
    }

    async listCandidates(args: {
        reviewBatchId?: bigint | undefined;
        candidateIds?: readonly bigint[] | undefined;
    }): Promise<AddressPromotionCandidateRowDb[]> {
        if (args.candidateIds && args.candidateIds.length > 0) {
            return this.prisma.$queryRaw<AddressPromotionCandidateRowDb[]>`
                SELECT
                    c.id,
                    c.review_batch_id,
                    c.external_id,
                    c.review_status,
                    c.review_decision,
                    c.validation_status,
                    c.promotion_status,
                    c.promotion_blockers,
                    c.promotion_warnings,
                    c.promoted_core_address_id,
                    c.matched_admin_area_id,
                    c.matched_street_id,
                    c.matched_building_id,
                    c.matched_place_id,
                    c.confidence_score,
                    c.source_refs,
                    (c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)) AS point_geom_present,
                    (c.entrance_geom IS NOT NULL AND NOT ST_IsEmpty(c.entrance_geom)) AS entrance_geom_present,
                    CASE
                        WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                            THEN ST_AsText(c.point_geom)
                        ELSE NULL
                    END AS point_wkt,
                    CASE
                        WHEN c.entrance_geom IS NOT NULL AND NOT ST_IsEmpty(c.entrance_geom)
                            THEN ST_AsText(c.entrance_geom)
                        ELSE NULL
                    END AS entrance_wkt
                FROM import_review.address_candidates AS c
                WHERE c.id = ANY(${args.candidateIds}::bigint[])
                ORDER BY c.id ASC
            `;
        }

        if (args.reviewBatchId === undefined) {
            return [];
        }

        return this.prisma.$queryRaw<AddressPromotionCandidateRowDb[]>`
            SELECT
                c.id,
                c.review_batch_id,
                c.external_id,
                c.review_status,
                c.review_decision,
                c.validation_status,
                c.promotion_status,
                c.promotion_blockers,
                c.promotion_warnings,
                c.promoted_core_address_id,
                c.matched_admin_area_id,
                c.matched_street_id,
                c.matched_building_id,
                c.matched_place_id,
                c.confidence_score,
                c.source_refs,
                (c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)) AS point_geom_present,
                (c.entrance_geom IS NOT NULL AND NOT ST_IsEmpty(c.entrance_geom)) AS entrance_geom_present,
                CASE
                    WHEN c.point_geom IS NOT NULL AND NOT ST_IsEmpty(c.point_geom)
                        THEN ST_AsText(c.point_geom)
                    ELSE NULL
                END AS point_wkt,
                CASE
                    WHEN c.entrance_geom IS NOT NULL AND NOT ST_IsEmpty(c.entrance_geom)
                        THEN ST_AsText(c.entrance_geom)
                END AS entrance_wkt
            FROM import_review.address_candidates AS c
            WHERE c.review_batch_id = ${args.reviewBatchId}
            ORDER BY c.id ASC
        `;
    }

    listComponentsForCandidates(
        candidateIds: readonly bigint[]
    ): Promise<AddressComponentValidationRowDb[]> {
        return this.validationRepo.listComponentsForCandidates(candidateIds);
    }

    findCoreAddressDuplicates(args: {
        candidates: readonly AddressPromotionCandidateRowDb[];
        houseNumberByCandidate: ReadonlyMap<bigint, string | null>;
        postcodeByCandidate: ReadonlyMap<bigint, string | null>;
    }): Promise<CoreAddressDuplicateRowDb[]> {
        return this.validationRepo.findCoreAddressDuplicates({
            candidates: args.candidates,
            houseNumberByCandidate: args.houseNumberByCandidate,
            postcodeByCandidate: args.postcodeByCandidate,
            maxDistanceM: 30,
            closeDistanceM: 10,
        });
    }

    async loadCoreAddressColumnCaps(): Promise<CoreAddressColumnCaps> {
        const rows = await this.prisma.$queryRaw<
            Array<{ column_name: string }>
        >`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'core'
              AND table_name = 'core_addresses'
        `;
        const cols = new Set(rows.map((r) => r.column_name));
        return {
            hasStreetId: cols.has("street_id"),
            hasAdminAreaId: cols.has("admin_area_id"),
            hasUnitNumber: cols.has("unit_number"),
            hasEntranceGeom: cols.has("entrance_geom"),
            hasPostalCode: cols.has("postal_code"),
            hasPostcode: cols.has("postcode"),
            hasIsPublic: cols.has("is_public"),
            hasConfidenceScore: cols.has("confidence_score"),
            hasNormalizedData: cols.has("normalized_data"),
        };
    }

    async loadCoreComponentColumnCaps(): Promise<CoreAddressComponentColumnCaps> {
        const rows = await this.prisma.$queryRaw<
            Array<{ column_name: string }>
        >`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'core'
              AND table_name = 'core_address_components'
        `;
        const cols = new Set(rows.map((r) => r.column_name));
        return {
            hasComponentTypeCode: cols.has("component_type_code"),
            hasSourceRefs: cols.has("source_refs"),
            hasConfidenceScore: cols.has("confidence_score"),
            hasMatchType: cols.has("match_type"),
            hasSourceAdminAreaId: cols.has("source_admin_area_id"),
            hasBoundaryStatus: cols.has("boundary_status"),
            hasAddressUsage: cols.has("address_usage"),
            hasUpdatedAt: cols.has("updated_at"),
        };
    }

    async resolveSourceTypeId(sourceRefs: unknown): Promise<bigint> {
        const refs =
            sourceRefs && typeof sourceRefs === "object" && !Array.isArray(sourceRefs)
                ? (sourceRefs as Record<string, unknown>)
                : {};
        const code =
            (typeof refs.source_type_code === "string" && refs.source_type_code.trim()) ||
            (typeof refs.source === "string" && refs.source.trim()) ||
            "osm";
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM ref.ref_source_types WHERE code = ${code} LIMIT 1
        `;
        if (rows[0]?.id !== undefined) {
            return rows[0].id;
        }
        const fallback = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM ref.ref_source_types WHERE code = 'osm' LIMIT 1
        `;
        const id = fallback[0]?.id;
        if (id === undefined) {
            throw new Error("ref.ref_source_types has no 'osm' row; cannot promote addresses");
        }
        return id;
    }

    async insertCoreAddress(args: {
        fullAddress: string;
        houseNumber: string | null;
        unitNumber: string | null;
        postalCode: string | null;
        streetId: bigint | null;
        adminAreaId: bigint | null;
        sourceTypeId: bigint;
        confidenceScore: number | null;
        sourceRefsJson: string;
        pointWkt: string;
        entranceWkt: string | null;
        caps: CoreAddressColumnCaps;
    }): Promise<bigint> {
        const cols: Prisma.Sql[] = [
            Prisma.sql`full_address`,
            Prisma.sql`house_number`,
            Prisma.sql`point_geom`,
            Prisma.sql`is_verified`,
            Prisma.sql`source_refs`,
        ];
        const vals: Prisma.Sql[] = [
            Prisma.sql`${args.fullAddress}`,
            Prisma.sql`${args.houseNumber}`,
            Prisma.sql`ST_GeomFromText(${args.pointWkt}, 4326)`,
            Prisma.sql`true`,
            Prisma.sql`${args.sourceRefsJson}::jsonb`,
        ];

        if (args.caps.hasUnitNumber) {
            cols.push(Prisma.sql`unit_number`);
            vals.push(Prisma.sql`${args.unitNumber}`);
        }
        if (args.caps.hasStreetId) {
            cols.push(Prisma.sql`street_id`);
            vals.push(Prisma.sql`${args.streetId}`);
        }
        if (args.caps.hasAdminAreaId) {
            cols.push(Prisma.sql`admin_area_id`);
            vals.push(Prisma.sql`${args.adminAreaId}`);
        }
        if (args.caps.hasEntranceGeom && args.entranceWkt) {
            cols.push(Prisma.sql`entrance_geom`);
            vals.push(Prisma.sql`ST_GeomFromText(${args.entranceWkt}, 4326)`);
        }
        if (args.caps.hasPostalCode) {
            cols.push(Prisma.sql`postal_code`);
            vals.push(Prisma.sql`${args.postalCode}`);
        } else if (args.caps.hasPostcode) {
            cols.push(Prisma.sql`postcode`);
            vals.push(Prisma.sql`${args.postalCode}`);
        }
        if (args.caps.hasIsPublic) {
            cols.push(Prisma.sql`is_public`);
            vals.push(Prisma.sql`true`);
        }
        if (args.caps.hasConfidenceScore) {
            cols.push(Prisma.sql`confidence_score`);
            vals.push(Prisma.sql`${args.confidenceScore}`);
        }
        cols.push(Prisma.sql`source_type_id`);
        vals.push(Prisma.sql`${args.sourceTypeId}`);
        if (args.caps.hasNormalizedData) {
            cols.push(Prisma.sql`normalized_data`);
            vals.push(Prisma.sql`${args.sourceRefsJson}::jsonb`);
        }

        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
            INSERT INTO core.core_addresses (${Prisma.join(cols, ", ")})
            VALUES (${Prisma.join(vals, ", ")})
            RETURNING id
        `);
        const id = rows[0]?.id;
        if (id === undefined) {
            throw new Error("Failed to insert core.core_addresses row");
        }
        return id;
    }

    async insertCoreComponents(args: {
        addressId: bigint;
        components: readonly AddressComponentValidationRowDb[];
        caps: CoreAddressComponentColumnCaps;
    }): Promise<number> {
        const active = args.components.filter((c) => !c.is_deleted);
        let inserted = 0;

        for (const row of active) {
            const cols: Prisma.Sql[] = [
                Prisma.sql`address_id`,
                Prisma.sql`component_type_id`,
                Prisma.sql`component_value`,
                Prisma.sql`language_code`,
                Prisma.sql`sort_order`,
            ];
            const vals: Prisma.Sql[] = [
                Prisma.sql`${args.addressId}`,
                Prisma.sql`(SELECT id FROM ref.ref_address_component_types WHERE code = ${row.component_type_code} LIMIT 1)`,
                Prisma.sql`${row.component_value.trim()}`,
                Prisma.sql`${row.language_code}`,
                Prisma.sql`coalesce(
                    (SELECT rank FROM ref.ref_address_component_types WHERE code = ${row.component_type_code} LIMIT 1),
                    100
                )`,
            ];

            if (args.caps.hasComponentTypeCode) {
                cols.push(Prisma.sql`component_type_code`);
                vals.push(Prisma.sql`${row.component_type_code}`);
            }
            if (args.caps.hasSourceRefs) {
                cols.push(Prisma.sql`source_refs`);
                vals.push(
                    Prisma.sql`jsonb_build_object(
                        'import_review_component_id', ${row.id.toString()},
                        'promoted_from', 'import_review.address_components'
                    )`
                );
            }
            if (args.caps.hasConfidenceScore) {
                cols.push(Prisma.sql`confidence_score`);
                vals.push(Prisma.sql`${row.confidence_score ?? null}`);
            }
            if (args.caps.hasMatchType) {
                cols.push(Prisma.sql`match_type`);
                vals.push(Prisma.sql`${row.match_type ?? null}`);
            }
            if (args.caps.hasSourceAdminAreaId) {
                cols.push(Prisma.sql`source_admin_area_id`);
                vals.push(Prisma.sql`${row.source_admin_area_id ?? null}`);
            }
            if (args.caps.hasBoundaryStatus) {
                cols.push(Prisma.sql`boundary_status`);
                vals.push(Prisma.sql`${row.boundary_status ?? null}`);
            }
            if (args.caps.hasAddressUsage) {
                cols.push(Prisma.sql`address_usage`);
                vals.push(Prisma.sql`${row.address_usage ?? null}`);
            }
            if (args.caps.hasUpdatedAt) {
                cols.push(Prisma.sql`updated_at`);
                vals.push(Prisma.sql`now()`);
            }

            const result = await this.prisma.$executeRaw(Prisma.sql`
                INSERT INTO core.core_address_components (${Prisma.join(cols, ", ")})
                SELECT ${Prisma.join(vals, ", ")}
                WHERE EXISTS (
                    SELECT 1 FROM ref.ref_address_component_types WHERE code = ${row.component_type_code}
                )
                ON CONFLICT (address_id, component_type_code, language_code, component_value) DO NOTHING
            `);
            if (result > 0) {
                inserted += 1;
            }
        }

        return inserted;
    }

    async linkPlaceAddress(placeId: bigint, addressId: bigint): Promise<boolean> {
        if (!(await this.tableExists("core.core_place_addresses"))) {
            return false;
        }
        const result = await this.prisma.$executeRaw`
            INSERT INTO core.core_place_addresses (place_id, address_id, relation_type, is_primary)
            VALUES (${placeId}, ${addressId}, 'primary', true)
            ON CONFLICT (place_id, address_id) DO NOTHING
        `;
        return result > 0;
    }

    async markPromoted(candidateId: bigint, coreAddressId: bigint): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE import_review.address_candidates
            SET
                promotion_status = 'promoted',
                review_status = 'promoted',
                promoted_at = now(),
                promoted_core_address_id = ${coreAddressId},
                promoted_core_id = ${coreAddressId},
                updated_at = now()
            WHERE id = ${candidateId}
        `;
    }

    async markDuplicateReviewNeeded(args: {
        candidateId: bigint;
        blockers: AddressValidationIssue[];
        warnings: AddressValidationIssue[];
    }): Promise<void> {
        const blockersJson = JSON.stringify(args.blockers);
        const warningsJson = JSON.stringify(args.warnings);

        await this.prisma.$executeRaw`
            UPDATE import_review.address_candidates
            SET
                promotion_status = 'duplicate_review_needed',
                promotion_blockers = ${blockersJson}::jsonb,
                promotion_warnings = ${warningsJson}::jsonb,
                validation_errors = ${blockersJson}::jsonb,
                validation_warnings = ${warningsJson}::jsonb,
                validation_status = 'blocked',
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

import { Prisma, type PrismaClient } from "@prisma/client";

import { composeAddress } from "../addresses/address-composer.js";
import { assessAddressPromotionEligibility } from "./import-review-address-promotion-eligibility.js";
import { ImportReviewAddressPromotionRepository } from "./import-review-address-promotion.repo.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";

const ADDRESS_CANDIDATE_TABLE = "import_review.address_candidates";
const CORE_ADDRESSES_TABLE = "core.core_addresses";

function clampConfidence(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return null;
    }
    return Math.min(100, Math.max(0, n));
}

function buildPromotionSourceRefs(candidateId: bigint, sourceRefs: unknown, batchId: bigint): string {
    const base =
        sourceRefs && typeof sourceRefs === "object" && !Array.isArray(sourceRefs)
            ? { ...(sourceRefs as Record<string, unknown>) }
            : {};
    return JSON.stringify({
        ...base,
        promoted_from: ADDRESS_CANDIDATE_TABLE,
        import_review_candidate_id: candidateId.toString(),
        publish_batch_id: batchId.toString(),
        entity_family: "addresses",
    });
}

function pickUndComponent(
    components: readonly {
        component_type_code: string;
        component_value: string;
        language_code: string;
        is_deleted: boolean;
    }[],
    typeCode: string
): string | null {
    const rows = components.filter(
        (c) => !c.is_deleted && c.component_type_code === typeCode && c.component_value.trim() !== ""
    );
    for (const lang of ["und", "en", "my"] as const) {
        const hit = rows.find((r) => r.language_code === lang);
        if (hit) {
            return hit.component_value.trim();
        }
    }
    return rows[0]?.component_value.trim() ?? null;
}

export class ImportReviewPromotionPromoteAddressesRepository {
    private readonly addressRepo: ImportReviewAddressPromotionRepository;

    constructor(private readonly prisma: PrismaClient) {
        this.addressRepo = new ImportReviewAddressPromotionRepository(prisma);
    }

    async checkAddressCoreExists(targetId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM core.core_addresses
            WHERE id = ${targetId} AND deleted_at IS NULL
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async promoteFromPublishItem(
        batchId: bigint,
        publishItemId: bigint
    ): Promise<PromoteItemResult> {
        const rows = await this.prisma.$queryRaw<
            Array<{
                publish_action: string;
                candidate_id: bigint;
            }>
        >`
            SELECT spi.publish_action, a.id AS candidate_id
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.address_candidates AS a
                ON a.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${ADDRESS_CANDIDATE_TABLE}
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Address publish item or candidate not found.",
                before_data: null,
                after_data: null,
            };
        }

        if (row.publish_action === "update") {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message:
                    "Address update via publish batch is not supported yet; use import review address promotion tools.",
                before_data: null,
                after_data: null,
            };
        }

        const candidates = await this.addressRepo.listCandidates({ candidateIds: [row.candidate_id] });
        const candidate = candidates[0];
        if (!candidate) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Address candidate not found.",
                before_data: null,
                after_data: null,
            };
        }

        const components = await this.addressRepo.listComponentsForCandidates([candidate.id]);
        const candidateComponents = components.filter((c) => c.address_candidate_id === candidate.id);
        const composed = composeAddress({
            components: candidateComponents.map((c) => ({
                component_type_code: c.component_type_code,
                component_value: c.component_value,
                language_code: c.language_code,
                sort_order: null,
            })),
            fallbackMode: "my_first",
        });
        const eligibility = assessAddressPromotionEligibility({
            candidate: {
                id: candidate.id,
                external_id: candidate.external_id,
                review_status: candidate.review_status,
                review_decision: candidate.review_decision,
                validation_status: candidate.validation_status,
                promotion_status: candidate.promotion_status,
                promotion_blockers: candidate.promotion_blockers,
                promotion_warnings: candidate.promotion_warnings,
                promoted_core_address_id: candidate.promoted_core_address_id,
                point_geom_present: candidate.point_geom_present,
                address_strength: candidate.address_strength,
            },
            confirmWarnings: true,
            hasCoreDuplicate: false,
            coreDuplicateMessage: null,
            composedDisplayAddress: composed.display_full_address,
        });
        if (!eligibility.eligible) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message:
                    eligibility.blockers[0]?.message ??
                    "Address candidate is not eligible for promotion.",
                before_data: null,
                after_data: { reasons: eligibility.reasons },
            };
        }

        const displayAddress = composed.display_full_address?.trim();
        if (!displayAddress || !candidate.point_wkt) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: "Missing display address or point geometry.",
                before_data: null,
                after_data: null,
            };
        }

        try {
            const addressCaps = await this.addressRepo.loadCoreAddressColumnCaps();
            const componentCaps = await this.addressRepo.loadCoreComponentColumnCaps();
            const sourceTypeId = await this.addressRepo.resolveSourceTypeId(candidate.source_refs);
            const sourceRefsJson = buildPromotionSourceRefs(
                candidate.id,
                candidate.source_refs,
                batchId
            );
            const coreAddressId = await this.addressRepo.insertCoreAddress({
                fullAddress: displayAddress,
                houseNumber: pickUndComponent(candidateComponents, "house_number"),
                unitNumber: pickUndComponent(candidateComponents, "unit"),
                postalCode: pickUndComponent(candidateComponents, "postcode"),
                streetId: candidate.matched_street_id,
                adminAreaId: candidate.matched_admin_area_id,
                sourceTypeId,
                confidenceScore: clampConfidence(candidate.confidence_score),
                sourceRefsJson,
                pointWkt: candidate.point_wkt,
                entranceWkt: candidate.entrance_wkt,
                caps: addressCaps,
            });
            await this.addressRepo.insertCoreComponents({
                addressId: coreAddressId,
                components: candidateComponents,
                caps: componentCaps,
            });

            return {
                publish_item_id: publishItemId,
                outcome: "inserted",
                target_id: coreAddressId,
                error_message: null,
                before_data: null,
                after_data: {
                    id: coreAddressId.toString(),
                    target_table: CORE_ADDRESSES_TABLE,
                    external_id: candidate.external_id,
                },
            };
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Address promotion failed.",
                before_data: null,
                after_data: null,
            };
        }
    }
}

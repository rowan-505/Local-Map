import type { PrismaClient } from "@prisma/client";

import { refreshAddressSearchIndex } from "../addresses/address-index.js";
import { composeAddress } from "../addresses/address-composer.js";
import { ImportReviewBatchNotFoundError } from "./import-review-errors.js";
import { assessAddressPromotionEligibility } from "./import-review-address-promotion-eligibility.js";
import { ImportReviewAddressPromotionDisabledError } from "./import-review-address-promotion.errors.js";
import { ImportReviewAddressPromotionRepository } from "./import-review-address-promotion.repo.js";
import type { PostImportReviewAddressPromotionBody } from "./import-review-address-promotion.schema.js";
import type {
    AddressPromotionItemResult,
    ImportReviewAddressPromotionResponse,
} from "./import-review-address-promotion.types.js";
import type { AddressValidationIssue } from "./import-review-address-validation.types.js";
import { isImportReviewAddressPromotionEnabled } from "./import-review-config.js";

function numOrNull(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function clampConfidence(value: unknown): number | null {
    const n = numOrNull(value);
    if (n === null) {
        return null;
    }
    return Math.min(100, Math.max(0, n));
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
    const order = ["und", "en", "my"] as const;
    for (const lang of order) {
        const hit = rows.find((r) => r.language_code === lang);
        if (hit) {
            return hit.component_value.trim();
        }
    }
    return rows[0]?.component_value.trim() ?? null;
}

function pickComponentValue(
    components: readonly {
        address_candidate_id: bigint;
        component_type_code: string;
        component_value: string;
        language_code: string;
        is_deleted: boolean;
    }[],
    candidateId: bigint,
    typeCode: string
): string | null {
    return pickUndComponent(
        components.filter((c) => c.address_candidate_id === candidateId),
        typeCode
    );
}

function buildPromotionSourceRefs(candidateId: bigint, sourceRefs: unknown): string {
    const base =
        sourceRefs && typeof sourceRefs === "object" && !Array.isArray(sourceRefs)
            ? { ...(sourceRefs as Record<string, unknown>) }
            : {};
    return JSON.stringify({
        ...base,
        promoted_from: "import_review.address_candidates",
        import_review_candidate_id: candidateId.toString(),
    });
}

function parseWarnings(value: unknown): AddressValidationIssue[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const out: AddressValidationIssue[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const row = item as Record<string, unknown>;
        out.push({
            code: typeof row.code === "string" ? row.code : "warning",
            message: typeof row.message === "string" ? row.message : "warning",
            severity: "warning",
        });
    }
    return out;
}

export function createImportReviewAddressPromotionService(prisma: PrismaClient) {
    const repo = new ImportReviewAddressPromotionRepository(prisma);

    return {
        async dryRun(
            body: PostImportReviewAddressPromotionBody
        ): Promise<ImportReviewAddressPromotionResponse> {
            return runPromotion(prisma, repo, body, true);
        },

        async promote(
            body: PostImportReviewAddressPromotionBody
        ): Promise<ImportReviewAddressPromotionResponse> {
            if (!isImportReviewAddressPromotionEnabled()) {
                throw new ImportReviewAddressPromotionDisabledError();
            }
            return runPromotion(prisma, repo, body, false);
        },
    };
}

async function runPromotion(
    prisma: PrismaClient,
    repo: ImportReviewAddressPromotionRepository,
    body: PostImportReviewAddressPromotionBody,
    dryRun: boolean
): Promise<ImportReviewAddressPromotionResponse> {
    if (body.review_batch_id !== undefined) {
        const exists = await repo.reviewBatchExists(body.review_batch_id);
        if (!exists) {
            throw new ImportReviewBatchNotFoundError(body.review_batch_id.toString());
        }
    }

    const candidates = await repo.listCandidates({
        reviewBatchId: body.review_batch_id,
        candidateIds: body.candidate_ids,
    });

    const finishedAt = new Date().toISOString();
    const empty: ImportReviewAddressPromotionResponse = {
        dry_run: dryRun,
        review_batch_id: body.review_batch_id?.toString() ?? null,
        candidate_count: 0,
        promoted: 0,
        skipped: 0,
        duplicate_review_needed: 0,
        failed: 0,
        warnings: [],
        items: [],
        finished_at: finishedAt,
        ...(dryRun && !isImportReviewAddressPromotionEnabled()
            ? {
                  disabled_because_env_flag_false: true,
                  message:
                      "Dry-run only: set ENABLE_IMPORT_REVIEW_ADDRESS_PROMOTION=true to execute promotion.",
              }
            : {}),
    };

    if (candidates.length === 0) {
        return empty;
    }

    const candidateIds = candidates.map((c) => c.id);
    const components = await repo.listComponentsForCandidates(candidateIds);
    const componentsByCandidate = new Map<bigint, typeof components>();
    for (const row of components) {
        const list = componentsByCandidate.get(row.address_candidate_id) ?? [];
        list.push(row);
        componentsByCandidate.set(row.address_candidate_id, list);
    }

    const houseNumberByCandidate = new Map<bigint, string | null>();
    const postcodeByCandidate = new Map<bigint, string | null>();
    for (const c of candidates) {
        houseNumberByCandidate.set(c.id, pickComponentValue(components, c.id, "house_number"));
        postcodeByCandidate.set(c.id, pickComponentValue(components, c.id, "postcode"));
    }

    const duplicateRows = await repo.findCoreAddressDuplicates({
        candidates,
        houseNumberByCandidate,
        postcodeByCandidate,
    });
    const duplicateByCandidate = new Map<bigint, (typeof duplicateRows)[0]>();
    for (const dup of duplicateRows) {
        if (!duplicateByCandidate.has(dup.address_candidate_id)) {
            duplicateByCandidate.set(dup.address_candidate_id, dup);
        }
    }

    const [addressCaps, componentCaps] = await Promise.all([
        repo.loadCoreAddressColumnCaps(),
        repo.loadCoreComponentColumnCaps(),
    ]);

    const summary = {
        promoted: 0,
        skipped: 0,
        duplicate_review_needed: 0,
        failed: 0,
    };
    const globalWarnings: string[] = [];
    const items: AddressPromotionItemResult[] = [];
    const promotedCoreAddressIds: bigint[] = [];

    await prisma.$transaction(async (tx) => {
        const txRepo = new ImportReviewAddressPromotionRepository(tx);

        for (const candidate of candidates) {
            const candidateComponents = componentsByCandidate.get(candidate.id) ?? [];
            const dup = duplicateByCandidate.get(candidate.id);
            const composed = composeAddress({
                components: candidateComponents.map((row) => ({
                    component_type_code: row.component_type_code,
                    component_value: row.component_value,
                    language_code: row.language_code,
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
                },
                confirmWarnings: body.confirm_warnings,
                hasCoreDuplicate: dup !== undefined,
                coreDuplicateMessage:
                    dup !== undefined
                        ? `Possible duplicate core address id=${dup.core_address_id.toString()} (~${Math.round(Number(dup.distance_m))}m).`
                        : null,
                composedDisplayAddress: composed.display_full_address,
            });

            const promotionWarnings = parseWarnings(candidate.promotion_warnings);

            if (!eligibility.eligible) {
                const isDuplicate = eligibility.reasons.includes("duplicate_core_address");

                if (isDuplicate) {
                    if (!dryRun) {
                        await txRepo.markDuplicateReviewNeeded({
                            candidateId: candidate.id,
                            blockers: eligibility.blockers,
                            warnings: promotionWarnings,
                        });
                    }
                    summary.duplicate_review_needed += 1;
                    items.push({
                        address_candidate_id: candidate.id.toString(),
                        external_id: candidate.external_id,
                        outcome: "duplicate_review_needed",
                        reasons: eligibility.reasons,
                        core_address_id: null,
                        promotion_warnings: promotionWarnings,
                        promotion_blockers: eligibility.blockers,
                    });
                } else {
                    summary.skipped += 1;
                    items.push({
                        address_candidate_id: candidate.id.toString(),
                        external_id: candidate.external_id,
                        outcome: "skipped",
                        reasons: eligibility.reasons,
                        core_address_id: null,
                        promotion_warnings: promotionWarnings,
                        promotion_blockers: eligibility.blockers,
                    });
                }
                continue;
            }

            if (dryRun) {
                summary.promoted += 1;
                items.push({
                    address_candidate_id: candidate.id.toString(),
                    external_id: candidate.external_id,
                    outcome: "would_promote",
                    reasons: [],
                    core_address_id: null,
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [],
                });
                continue;
            }

            try {
                const displayAddress = composed.display_full_address?.trim();
                if (!displayAddress || !candidate.point_wkt) {
                    throw new Error("Missing display address or point geometry");
                }

                const sourceTypeId = await txRepo.resolveSourceTypeId(candidate.source_refs);
                const sourceRefsJson = buildPromotionSourceRefs(
                    candidate.id,
                    candidate.source_refs
                );

                const coreAddressId = await txRepo.insertCoreAddress({
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

                await txRepo.insertCoreComponents({
                    addressId: coreAddressId,
                    components: candidateComponents,
                    caps: componentCaps,
                });

                if (candidate.matched_place_id !== null) {
                    await txRepo.linkPlaceAddress(
                        candidate.matched_place_id,
                        coreAddressId
                    );
                }

                await txRepo.markPromoted(candidate.id, coreAddressId);
                promotedCoreAddressIds.push(coreAddressId);
                summary.promoted += 1;
                items.push({
                    address_candidate_id: candidate.id.toString(),
                    external_id: candidate.external_id,
                    outcome: "promoted",
                    reasons: [],
                    core_address_id: coreAddressId.toString(),
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [],
                });
            } catch (err) {
                summary.failed += 1;
                const message =
                    err instanceof Error ? err.message : "Promotion insert failed";
                globalWarnings.push(`candidate ${candidate.id.toString()}: ${message}`);
                items.push({
                    address_candidate_id: candidate.id.toString(),
                    external_id: candidate.external_id,
                    outcome: "failed",
                    reasons: ["insert_failed"],
                    core_address_id: null,
                    promotion_warnings: promotionWarnings,
                    promotion_blockers: [
                        {
                            code: "promotion_insert_failed",
                            message,
                            severity: "error",
                        },
                    ],
                });
            }
        }
    });

    if (!dryRun && promotedCoreAddressIds.length > 0) {
        await refreshAddressSearchIndex(prisma, promotedCoreAddressIds);
    }

    return {
        dry_run: dryRun,
        review_batch_id:
            body.review_batch_id?.toString() ??
            (candidates.length > 0 ? candidates[0]!.review_batch_id.toString() : null),
        candidate_count: candidates.length,
        ...summary,
        warnings: globalWarnings,
        items,
        finished_at: finishedAt,
    };
}

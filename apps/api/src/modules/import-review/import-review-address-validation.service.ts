import type { PrismaClient } from "@prisma/client";

import { ImportReviewBatchNotFoundError } from "./import-review-errors.js";
import { validateAddressCandidate } from "./import-review-address-validation.js";
import { ImportReviewAddressValidationRepository } from "./import-review-address-validation.repo.js";
import type { PostImportReviewAddressValidateBody } from "./import-review-address-validation.schema.js";
import type {
    AddressCandidateValidationResult,
    AddressValidationIssue,
} from "./import-review-address-validation.types.js";

const DUPLICATE_MAX_DISTANCE_M = 30;
const DUPLICATE_CLOSE_DISTANCE_M = 10;

export type ImportReviewAddressValidateResultItem = {
    address_candidate_id: string;
    validation_status: string;
    promotion_blockers: AddressValidationIssue[];
    promotion_warnings: AddressValidationIssue[];
    validated_at: string;
};

export type ImportReviewAddressValidateResponse = {
    review_batch_id: string | null;
    candidate_count: number;
    summary: {
        blocked: number;
        valid_with_warnings: number;
        valid: number;
    };
    results: ImportReviewAddressValidateResultItem[];
};

function numOrNull(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function pickComponentValue(
    components: readonly { address_candidate_id: bigint; component_type_code: string; component_value: string; is_deleted: boolean }[],
    candidateId: bigint,
    typeCode: string
): string | null {
    const row = components.find(
        (c) =>
            c.address_candidate_id === candidateId &&
            !c.is_deleted &&
            c.component_type_code === typeCode &&
            c.component_value.trim() !== ""
    );
    return row?.component_value.trim() ?? null;
}

export function createImportReviewAddressValidationService(prisma: PrismaClient) {
    const repo = new ImportReviewAddressValidationRepository(prisma);

    return {
        async validate(body: PostImportReviewAddressValidateBody): Promise<ImportReviewAddressValidateResponse> {
            if (body.review_batch_id !== undefined) {
                const exists = await repo.reviewBatchExists(body.review_batch_id);
                if (!exists) {
                    throw new ImportReviewBatchNotFoundError(body.review_batch_id.toString());
                }
            }

            const candidates = await repo.listCandidatesForValidation({
                reviewBatchId: body.review_batch_id,
                candidateIds: body.candidate_ids,
            });

            if (candidates.length === 0) {
                return {
                    review_batch_id: body.review_batch_id?.toString() ?? null,
                    candidate_count: 0,
                    summary: { blocked: 0, valid_with_warnings: 0, valid: 0 },
                    results: [],
                };
            }

            const candidateIds = candidates.map((c) => c.id);
            const [components, validTypeCodes] = await Promise.all([
                repo.listComponentsForCandidates(candidateIds),
                repo.listValidComponentTypeCodes(),
            ]);

            const componentsByCandidate = new Map<bigint, typeof components>();
            for (const row of components) {
                const list = componentsByCandidate.get(row.address_candidate_id) ?? [];
                list.push(row);
                componentsByCandidate.set(row.address_candidate_id, list);
            }

            const houseNumberByCandidate = new Map<bigint, string | null>();
            const postcodeByCandidate = new Map<bigint, string | null>();
            for (const c of candidates) {
                houseNumberByCandidate.set(
                    c.id,
                    pickComponentValue(components, c.id, "house_number")
                );
                postcodeByCandidate.set(c.id, pickComponentValue(components, c.id, "postcode"));
            }

            const duplicateRows = await repo.findCoreAddressDuplicates({
                candidates,
                houseNumberByCandidate,
                postcodeByCandidate,
                maxDistanceM: DUPLICATE_MAX_DISTANCE_M,
                closeDistanceM: DUPLICATE_CLOSE_DISTANCE_M,
            });

            const duplicateByCandidate = new Map<bigint, (typeof duplicateRows)[0]>();
            for (const dup of duplicateRows) {
                if (!duplicateByCandidate.has(dup.address_candidate_id)) {
                    duplicateByCandidate.set(dup.address_candidate_id, dup);
                }
            }

            const validatedAt = new Date().toISOString();
            const results: ImportReviewAddressValidateResultItem[] = [];
            const summary = { blocked: 0, valid_with_warnings: 0, valid: 0 };

            for (const candidate of candidates) {
                const dup = duplicateByCandidate.get(candidate.id);
                const validation = validateAddressCandidate({
                    id: candidate.id,
                    point_geom_present: candidate.point_geom_present,
                    entrance_geom_present: candidate.entrance_geom_present,
                    matched_admin_area_id: candidate.matched_admin_area_id,
                    matched_street_id: candidate.matched_street_id,
                    review_status: candidate.review_status,
                    promotion_status: candidate.promotion_status,
                    promoted_core_address_id: candidate.promoted_core_address_id,
                    components: (componentsByCandidate.get(candidate.id) ?? []).map((row) => ({
                        id: row.id,
                        component_type_code: row.component_type_code,
                        component_value: row.component_value,
                        language_code: row.language_code,
                        confidence_score: numOrNull(row.confidence_score),
                        source_admin_area_id: row.source_admin_area_id,
                        boundary_status: row.boundary_status,
                        address_usage: row.address_usage,
                        is_deleted: row.is_deleted,
                    })),
                    valid_component_type_codes: validTypeCodes,
                    has_core_duplicate: dup !== undefined,
                    core_duplicate_message:
                        dup !== undefined
                            ? `Possible duplicate core address id=${dup.core_address_id.toString()} (~${Math.round(Number(dup.distance_m))}m).`
                            : null,
                });

                await repo.persistValidationResult({
                    candidateId: candidate.id,
                    validationStatus: validation.validation_status,
                    promotionBlockers: validation.promotion_blockers,
                    promotionWarnings: validation.promotion_warnings,
                });

                if (validation.validation_status === "blocked") {
                    summary.blocked += 1;
                } else if (validation.validation_status === "valid_with_warnings") {
                    summary.valid_with_warnings += 1;
                } else {
                    summary.valid += 1;
                }

                results.push(mapResultItem(validation, validatedAt));
            }

            const reviewBatchId =
                body.review_batch_id?.toString() ??
                (candidates.length > 0 ? candidates[0]!.review_batch_id.toString() : null);

            return {
                review_batch_id: reviewBatchId,
                candidate_count: results.length,
                summary,
                results,
            };
        },
    };
}

function mapResultItem(
    validation: AddressCandidateValidationResult,
    validatedAt: string
): ImportReviewAddressValidateResultItem {
    return {
        address_candidate_id: validation.address_candidate_id.toString(),
        validation_status: validation.validation_status,
        promotion_blockers: validation.promotion_blockers,
        promotion_warnings: validation.promotion_warnings,
        validated_at: validatedAt,
    };
}

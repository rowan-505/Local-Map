import type { PrismaClient } from "@prisma/client";

import { ImportReviewBatchNotFoundError } from "./import-review-errors.js";
import { ImportReviewPlaceAddressLinkValidationRepository } from "./import-review-place-address-link-validation.repo.js";
import type { PostImportReviewPlaceAddressLinkValidateBody } from "./import-review-place-address-link-validation.schema.js";
import type {
    AddressValidationIssue,
    AddressValidationStatus,
} from "./import-review-address-validation.types.js";

const VALID_RELATION_TYPES = new Set(["primary", "located_at", "entrance", "delivery", "mailing", "nearby"]);

export type ImportReviewPlaceAddressLinkValidateResultItem = {
    place_address_link_id: string;
    validation_status: AddressValidationStatus;
    validation_errors: AddressValidationIssue[];
    validation_warnings: AddressValidationIssue[];
    validated_at: string;
};

export type ImportReviewPlaceAddressLinkValidateResponse = {
    review_batch_id: string | null;
    link_count: number;
    summary: {
        blocked: number;
        valid_with_warnings: number;
        valid: number;
    };
    results: ImportReviewPlaceAddressLinkValidateResultItem[];
};

function issue(
    code: string,
    message: string,
    severity: "error" | "warning",
    extra?: { field?: string }
): AddressValidationIssue {
    return { code, message, severity, ...extra };
}

function resolveStatus(
    blockers: AddressValidationIssue[],
    warnings: AddressValidationIssue[]
): AddressValidationStatus {
    if (blockers.length > 0) {
        return "blocked";
    }
    return warnings.length > 0 ? "valid_with_warnings" : "valid";
}

export function createImportReviewPlaceAddressLinkValidationService(prisma: PrismaClient) {
    const repo = new ImportReviewPlaceAddressLinkValidationRepository(prisma);

    return {
        async validate(
            body: PostImportReviewPlaceAddressLinkValidateBody
        ): Promise<ImportReviewPlaceAddressLinkValidateResponse> {
            if (body.review_batch_id !== undefined) {
                const exists = await repo.reviewBatchExists(body.review_batch_id);
                if (!exists) {
                    throw new ImportReviewBatchNotFoundError(body.review_batch_id.toString());
                }
            }

            const links = await repo.listLinksForValidation({
                reviewBatchId: body.review_batch_id,
                linkIds: body.link_ids,
            });

            const validatedAt = new Date().toISOString();
            const summary = { blocked: 0, valid_with_warnings: 0, valid: 0 };
            const results: ImportReviewPlaceAddressLinkValidateResultItem[] = [];

            for (const link of links) {
                const blockers: AddressValidationIssue[] = [];
                const warnings: AddressValidationIssue[] = [];

                if (!link.place_candidate_exists && !link.core_place_exists) {
                    blockers.push(
                        issue(
                            "place_side_missing",
                            "Link needs either place_candidate_id or matched_core_place_id.",
                            "error",
                            { field: "place_candidate_id" }
                        )
                    );
                }

                if (!link.address_candidate_exists && !link.core_address_exists) {
                    blockers.push(
                        issue(
                            "address_side_missing",
                            "Link needs either address_candidate_id or matched_core_address_id.",
                            "error",
                            { field: "address_candidate_id" }
                        )
                    );
                }

                if (!link.relation_type || !VALID_RELATION_TYPES.has(link.relation_type)) {
                    blockers.push(
                        issue(
                            "invalid_relation_type",
                            `Invalid relation_type: ${link.relation_type ?? "null"}.`,
                            "error",
                            { field: "relation_type" }
                        )
                    );
                }

                if (link.duplicate_count > 0n) {
                    blockers.push(
                        issue("duplicate_place_address_link", "Duplicate place/address link detected.", "error")
                    );
                }

                if (!link.place_promotion_ready) {
                    blockers.push(
                        issue(
                            "place_side_not_promotion_ready",
                            "Place side is not promoted or promotion-ready.",
                            "error"
                        )
                    );
                }

                if (!link.address_promotion_ready) {
                    blockers.push(
                        issue(
                            "address_side_not_promotion_ready",
                            "Address side is not promoted or promotion-ready.",
                            "error"
                        )
                    );
                }

                if (link.place_candidate_id !== null && link.matched_core_place_id !== null) {
                    warnings.push(
                        issue(
                            "place_side_has_candidate_and_core_match",
                            "Both place_candidate_id and matched_core_place_id are set; confirm intended side.",
                            "warning"
                        )
                    );
                }

                if (link.address_candidate_id !== null && link.matched_core_address_id !== null) {
                    warnings.push(
                        issue(
                            "address_side_has_candidate_and_core_match",
                            "Both address_candidate_id and matched_core_address_id are set; confirm intended side.",
                            "warning"
                        )
                    );
                }

                const validationStatus = resolveStatus(blockers, warnings);
                await repo.persistValidationResult({
                    linkId: link.id,
                    validationStatus,
                    validationErrors: blockers,
                    validationWarnings: warnings,
                });

                if (validationStatus === "blocked") {
                    summary.blocked += 1;
                } else if (validationStatus === "valid_with_warnings") {
                    summary.valid_with_warnings += 1;
                } else {
                    summary.valid += 1;
                }

                results.push({
                    place_address_link_id: link.id.toString(),
                    validation_status: validationStatus,
                    validation_errors: blockers,
                    validation_warnings: warnings,
                    validated_at: validatedAt,
                });
            }

            return {
                review_batch_id:
                    body.review_batch_id?.toString() ??
                    (links.length > 0 ? links[0]!.review_batch_id.toString() : null),
                link_count: results.length,
                summary,
                results,
            };
        },
    };
}

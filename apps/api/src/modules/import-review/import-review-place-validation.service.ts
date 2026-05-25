import type { PrismaClient } from "@prisma/client";

import { ImportReviewBatchNotFoundError } from "./import-review-errors.js";
import { ImportReviewPlaceValidationRepository } from "./import-review-place-validation.repo.js";
import type { PostImportReviewPlaceValidateBody } from "./import-review-place-validation.schema.js";
import type {
    AddressValidationIssue,
    AddressValidationStatus,
} from "./import-review-address-validation.types.js";

export type ImportReviewPlaceValidateResultItem = {
    place_candidate_id: string;
    validation_status: AddressValidationStatus;
    validation_errors: AddressValidationIssue[];
    validation_warnings: AddressValidationIssue[];
    validated_at: string;
};

export type ImportReviewPlaceValidateResponse = {
    review_batch_id: string | null;
    candidate_count: number;
    summary: {
        blocked: number;
        valid_with_warnings: number;
        valid: number;
    };
    results: ImportReviewPlaceValidateResultItem[];
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

export function createImportReviewPlaceValidationService(prisma: PrismaClient) {
    const repo = new ImportReviewPlaceValidationRepository(prisma);

    return {
        async validate(body: PostImportReviewPlaceValidateBody): Promise<ImportReviewPlaceValidateResponse> {
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

            const validatedAt = new Date().toISOString();
            const summary = { blocked: 0, valid_with_warnings: 0, valid: 0 };
            const results: ImportReviewPlaceValidateResultItem[] = [];

            for (const candidate of candidates) {
                const blockers: AddressValidationIssue[] = [];
                const warnings: AddressValidationIssue[] = [];
                const displayName =
                    candidate.display_name ?? candidate.primary_name ?? candidate.canonical_name;

                if (!displayName || displayName.trim() === "") {
                    blockers.push(
                        issue("place_name_missing", "Place candidate needs a source/display name.", "error", {
                            field: "display_name",
                        })
                    );
                }

                if (
                    candidate.category_id === null &&
                    candidate.place_class_id === null &&
                    (!candidate.class_code || candidate.class_code.trim() === "")
                ) {
                    blockers.push(
                        issue(
                            "place_category_missing",
                            "Place candidate needs a category, class, or source type before promotion.",
                            "error",
                            { field: "category_id" }
                        )
                    );
                }

                if (!candidate.has_usable_geometry) {
                    blockers.push(
                        issue("place_geometry_missing", "Place candidate needs point_geom or usable geometry.", "error", {
                            field: "point_geom",
                        })
                    );
                }

                if (!candidate.can_infer_admin_area) {
                    blockers.push(
                        issue(
                            "place_admin_area_missing",
                            "Place candidate needs admin_area_id or a point that can infer one.",
                            "error",
                            { field: "admin_area_id" }
                        )
                    );
                }

                if (candidate.has_core_duplicate) {
                    blockers.push(
                        issue(
                            "duplicate_core_place",
                            "Possible duplicate core.core_places row detected.",
                            "error"
                        )
                    );
                }

                if (!candidate.has_linked_address) {
                    warnings.push(
                        issue("linked_address_missing", "No linked address candidate.", "warning")
                    );
                }

                if (
                    candidate.weakest_linked_address_strength === "none" ||
                    candidate.weakest_linked_address_strength === "weak" ||
                    candidate.weakest_linked_address_strength === "partial"
                ) {
                    warnings.push(
                        issue(
                            "linked_address_weak_or_partial",
                            `Linked address strength is ${candidate.weakest_linked_address_strength}.`,
                            "warning"
                        )
                    );
                }

                if (!candidate.has_english_name) {
                    warnings.push(
                        issue("english_place_name_missing", "No English place name found.", "warning")
                    );
                }
                if (!candidate.has_myanmar_name) {
                    warnings.push(
                        issue("myanmar_place_name_missing", "No Myanmar place name found.", "warning")
                    );
                }
                if (!candidate.has_contact_info) {
                    warnings.push(
                        issue("contact_info_missing", "No phone, email, website, or opening_hours tag.", "warning")
                    );
                }

                const validationStatus = resolveStatus(blockers, warnings);
                await repo.persistValidationResult({
                    candidateId: candidate.id,
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
                    place_candidate_id: candidate.id.toString(),
                    validation_status: validationStatus,
                    validation_errors: blockers,
                    validation_warnings: warnings,
                    validated_at: validatedAt,
                });
            }

            return {
                review_batch_id:
                    body.review_batch_id?.toString() ??
                    (candidates.length > 0 ? candidates[0]!.review_batch_id.toString() : null),
                candidate_count: results.length,
                summary,
                results,
            };
        },
    };
}

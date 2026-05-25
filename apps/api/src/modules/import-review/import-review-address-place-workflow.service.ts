import type { PrismaClient } from "@prisma/client";

import {
    deriveAddressSourceContextFromCandidate,
    mergeAddressSourceTagLayers,
} from "./import-review-address-source-context.js";
import { ImportReviewAddressPlaceWorkflowRepository } from "./import-review-address-place-workflow.repo.js";
import {
    ImportReviewCandidateNotFoundError,
    ImportReviewDecisionRuleError,
} from "./import-review-errors.js";
import type { PatchImportReviewAddressPlaceStatusBody } from "./import-review-address-place-workflow.schema.js";

function linkConfidenceScoreForAddressStrength(addressStrength: string | null): number | null {
    switch (addressStrength) {
        case "full":
            return 90;
        case "strong":
            return 85;
        case "partial":
            return 70;
        default:
            return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createImportReviewAddressPlaceWorkflowService(prisma: PrismaClient) {
    const repo = new ImportReviewAddressPlaceWorkflowRepository(prisma);

    return {
        async getSummary(candidateId: bigint) {
            return repo.getSummary(candidateId);
        },

        async createPlaceCandidate(candidateId: bigint) {
            const candidate = await repo.getAddressContext(candidateId);
            if (candidate === null) {
                throw new ImportReviewCandidateNotFoundError("addresses", candidateId.toString(), "id");
            }

            if (candidate.linked_place_candidate_id !== null) {
                const summary = await repo.getSummary(candidateId);
                return {
                    address_candidate_id: candidate.id.toString(),
                    linked_place_candidate_id: candidate.linked_place_candidate_id.toString(),
                    matched_core_place_id:
                        candidate.matched_core_place_id === null ? null : candidate.matched_core_place_id.toString(),
                    place_candidate_status: candidate.place_candidate_status,
                    ...summary,
                };
            }

            if (candidate.has_place_evidence !== true) {
                throw new ImportReviewDecisionRuleError("Address candidate has no place evidence.");
            }

            const sourceContext = deriveAddressSourceContextFromCandidate(candidate);
            const sourceName =
                sourceContext.source_name ??
                sourceContext.source_name_en ??
                sourceContext.source_name_my ??
                candidate.canonical_name ??
                candidate.external_id;
            if (!sourceName || sourceName.trim() === "") {
                throw new ImportReviewDecisionRuleError("Address candidate has place evidence but no source name.");
            }

            const tags = mergeAddressSourceTagLayers(
                candidate.normalized_data,
                candidate.source_refs,
                candidate.source_tags
            );
            const normalizedData = {
                ...(isRecord(candidate.normalized_data) ? candidate.normalized_data : {}),
                tags,
                source_classification: candidate.source_classification,
                address_strength: candidate.address_strength,
                created_from_address_candidate_id: candidate.id.toString(),
                created_from_address_local_staging_id: candidate.local_staging_id.toString(),
                created_by: "import-review-address-api",
            };
            const sourceRefs = {
                ...(isRecord(candidate.source_refs) ? candidate.source_refs : {}),
                tags,
                address_candidate_id: candidate.id.toString(),
                address_local_staging_id: candidate.local_staging_id.toString(),
            };

            const result = await repo.createOrLinkPlaceCandidate({
                candidateId,
                sourceName,
                sourceTypeHint: sourceContext.source_type_hint,
                normalizedData,
                sourceRefs,
                linkConfidenceScore: linkConfidenceScoreForAddressStrength(candidate.address_strength),
            });
            if (result === null) {
                throw new ImportReviewCandidateNotFoundError("addresses", candidateId.toString(), "id");
            }
            return result;
        },

        async patchPlaceStatus(candidateId: bigint, body: PatchImportReviewAddressPlaceStatusBody) {
            if (body.matched_core_place_id !== undefined && body.matched_core_place_id !== null) {
                const corePlace = await repo.getCorePlaceSummary(body.matched_core_place_id);
                if (corePlace === null) {
                    throw new ImportReviewDecisionRuleError(
                        `Core place not found for id=${body.matched_core_place_id.toString()}.`
                    );
                }
            }

            const result = await repo.patchPlaceStatus({
                candidateId,
                placeCandidateStatus: body.place_candidate_status,
                matchedCorePlaceId: body.matched_core_place_id,
                clearLinkedPlaceCandidate: body.clear_linked_place_candidate,
            });
            if (result === null) {
                throw new ImportReviewCandidateNotFoundError("addresses", candidateId.toString(), "id");
            }
            return result;
        },
    };
}

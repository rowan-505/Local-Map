import type { PrismaClient } from "@prisma/client";

import { createImportReviewDataRepository } from "./import-review-repository.factory.js";
import { ImportReviewCandidateNotFoundError, ImportReviewDecisionRuleError } from "./import-review-errors.js";
import { ImportReviewAddressComponentsMutationRepository } from "./import-review-address-components-mutation.repo.js";
import type { PatchImportReviewAddressComponentsBody } from "./import-review-address-components-mutation.schema.js";
import { ImportReviewService } from "./import-review.service.js";

export function createImportReviewAddressComponentsMutationService(prisma: PrismaClient) {
    const repo = new ImportReviewAddressComponentsMutationRepository(prisma);
    const importReviewService = new ImportReviewService(createImportReviewDataRepository(prisma));

    return {
        async patchComponents(
            candidateId: bigint,
            body: PatchImportReviewAddressComponentsBody
        ) {
            const exists = await repo.candidateExists(candidateId);
            if (!exists) {
                throw new ImportReviewCandidateNotFoundError("addresses", candidateId.toString(), "id");
            }

            for (const row of body.upsert) {
                const typeOk = await repo.isComponentTypeValid(row.component_type_code);
                if (!typeOk) {
                    throw new ImportReviewDecisionRuleError(
                        `Unknown component_type_code: ${row.component_type_code}`
                    );
                }
            }

            if (body.delete_ids?.length) {
                await repo.softDeleteComponents(candidateId, body.delete_ids);
            }

            for (const row of body.upsert) {
                await repo.upsertComponent(candidateId, row);
            }

            return importReviewService.getCandidateById("addresses", {
                id: candidateId,
                include_geometry: true,
            });
        },
    };
}

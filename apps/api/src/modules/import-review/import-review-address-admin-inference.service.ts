import type { PrismaClient } from "@prisma/client";

import {
    ImportReviewAddressAdminInferenceRepository,
    type AddressAdminInferenceRunRow,
    type AddressAdminInferenceVerification,
} from "./import-review-address-admin-inference.repo.js";
import type { PostImportReviewAddressAdminInferenceBody } from "./import-review-address-admin-inference.schema.js";

export class ImportReviewAddressAdminInferenceNotReadyError extends Error {
    readonly statusCode = 503;

    constructor() {
        super(
            "Admin address inference is not installed. Apply migration 044_infer_address_admin_components.sql."
        );
        this.name = "ImportReviewAddressAdminInferenceNotReadyError";
    }
}

export class ImportReviewAddressAdminInferenceBatchNotFoundError extends Error {
    readonly statusCode = 404;

    constructor(reviewBatchId: bigint) {
        super(`Review batch not found: ${reviewBatchId.toString()}`);
        this.name = "ImportReviewAddressAdminInferenceBatchNotFoundError";
    }
}

export type ImportReviewAddressAdminInferenceResult = {
    review_batch_id: string;
    run: {
        candidates_with_point: string;
        candidates_matched: string;
        components_inserted: string;
        candidates_updated: string;
    };
    verification: {
        matched_admin_area_count: string;
        candidates_with_point: string;
        components_by_type_language: Array<{
            component_type_code: string;
            language_code: string;
            row_count: string;
        }>;
        sample_components: Array<{
            address_candidate_id: string;
            component_type_code: string;
            language_code: string;
            component_value: string;
            match_type: string | null;
            confidence_score: number | null;
            boundary_status: string | null;
            address_usage: string | null;
            source_admin_area_id: string | null;
        }>;
    };
};

function bigStr(value: bigint): string {
    return value.toString();
}

function numOrNull(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function mapRun(row: AddressAdminInferenceRunRow) {
    return {
        candidates_with_point: bigStr(row.candidates_with_point),
        candidates_matched: bigStr(row.candidates_matched),
        components_inserted: bigStr(row.components_inserted),
        candidates_updated: bigStr(row.candidates_updated),
    };
}

function mapVerification(v: AddressAdminInferenceVerification) {
    return {
        matched_admin_area_count: bigStr(v.matched_admin_area_count),
        candidates_with_point: bigStr(v.candidates_with_point),
        components_by_type_language: v.components_by_type_language.map((row) => ({
            component_type_code: row.component_type_code,
            language_code: row.language_code,
            row_count: bigStr(row.row_count),
        })),
        sample_components: v.sample_components.map((row) => ({
            address_candidate_id: bigStr(row.address_candidate_id),
            component_type_code: row.component_type_code,
            language_code: row.language_code,
            component_value: row.component_value,
            match_type: row.match_type,
            confidence_score: numOrNull(row.confidence_score),
            boundary_status: row.boundary_status,
            address_usage: row.address_usage,
            source_admin_area_id:
                row.source_admin_area_id != null ? bigStr(row.source_admin_area_id) : null,
        })),
    };
}

export function createImportReviewAddressAdminInferenceService(prisma: PrismaClient) {
    const repo = new ImportReviewAddressAdminInferenceRepository(prisma);

    return {
        async run(
            body: PostImportReviewAddressAdminInferenceBody
        ): Promise<ImportReviewAddressAdminInferenceResult> {
            const ready = await repo.inferenceFunctionExists();
            if (!ready) {
                throw new ImportReviewAddressAdminInferenceNotReadyError();
            }

            const exists = await repo.reviewBatchExists(body.review_batch_id);
            if (!exists) {
                throw new ImportReviewAddressAdminInferenceBatchNotFoundError(body.review_batch_id);
            }

            const runRow = await repo.runInference({
                reviewBatchId: body.review_batch_id,
                nearestVillageMeters: body.nearest_village_meters,
            });

            const verification = await repo.getVerification(body.review_batch_id);

            return {
                review_batch_id: body.review_batch_id.toString(),
                run: mapRun(runRow),
                verification: mapVerification(verification),
            };
        },
    };
}

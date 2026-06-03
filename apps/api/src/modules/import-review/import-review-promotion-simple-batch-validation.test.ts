import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
    ImportReviewPromotionSimpleBatchValidation,
    type PublishItemValidationTarget,
    type PublishItemSimpleValidationOutcome,
} from "./import-review-promotion-simple-batch-validation.js";
import type { SimplePromotionCandidateValidationRow } from "./import-review-promotion-simple-validation.js";
import { resolvePromotionValidationChunkSize } from "./import-review-promotion-validation-chunks.js";

function readyOutcome(
    publishItemId: bigint,
    entityFamily: string
): PublishItemSimpleValidationOutcome {
    return {
        publish_item_id: publishItemId,
        entity_family: entityFamily,
        status: "ready",
        skipped: false,
        result: { status: "ready", errors: [], warnings: [] },
    };
}

function makeTarget(index: number): PublishItemValidationTarget {
    return {
        publish_item_id: BigInt(index),
        entity_family: "buildings",
        review_candidate_id: BigInt(1000 + index),
        review_batch_id: 2n,
    };
}

function stubBuildingBatchLoad(svc: ImportReviewPromotionSimpleBatchValidation): void {
    svc.simpleRepo.loadCandidateRowsBatch = async (_config, ids) => {
        const map = new Map<string, SimplePromotionCandidateValidationRow>();
        for (const id of ids) {
            map.set(id.toString(), {
                id,
                review_batch_id: 2n,
                review_status: "approved",
                review_decision: "approved",
                promotion_status: "ready",
                promoted_core_id: null,
                external_id: `ext-${id}`,
                local_staging_id: `ls-${id}`,
                source_refs: { source: "osm" },
                confidence_score: 80,
                building_type_id: 1n,
                class_code: "yes",
                name_mm: "မြန်မာ",
                name_en: "Building",
                geomDiagnostics: {
                    present: true,
                    valid: true,
                    srid: 4326,
                    type: "ST_Polygon",
                    empty: false,
                    areaM2: 500,
                },
            });
        }
        return map;
    };
    svc.simpleRepo.resolveFkExistenceBatch = async (_config, rows) => {
        const map = new Map<string, Record<string, boolean>>();
        for (const row of rows) {
            map.set(row.id.toString(), { building_type_id: true, admin_area_id: true });
        }
        return map;
    };
}

describe("ImportReviewPromotionSimpleBatchValidation.validatePublishBatch progress", () => {
    it("calls onChunkComplete after each chunk", async () => {
        const chunkSize = resolvePromotionValidationChunkSize("buildings");
        const total = chunkSize + 5;
        const targets = Array.from({ length: total }, (_, i) => makeTarget(i + 1));

        const svc = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);
        svc.listPublishItemTargets = async () => targets;
        stubBuildingBatchLoad(svc);

        const chunkDone: number[] = [];
        const outcomes = await svc.validatePublishBatch(17n, {
            onChunkComplete: async (event) => {
                chunkDone.push(event.done);
            },
        });

        assert.equal(outcomes.length, total);
        assert.deepEqual(chunkDone, [chunkSize, total]);
    });

    it("invokes onChunkComplete before validatePublishBatch resolves all outcomes", async () => {
        const chunkSize = resolvePromotionValidationChunkSize("buildings");
        const total = chunkSize * 2;
        const targets = Array.from({ length: total }, (_, i) => makeTarget(i + 1));

        const svc = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);
        svc.listPublishItemTargets = async () => targets;
        stubBuildingBatchLoad(svc);

        let doneAtFirstChunk = 0;
        const outcomes = await svc.validatePublishBatch(17n, {
            onChunkComplete: async (event) => {
                if (event.done === chunkSize) {
                    doneAtFirstChunk = event.done;
                }
            },
        });

        assert.equal(doneAtFirstChunk, chunkSize);
        assert.equal(outcomes.length, total);
    });
});

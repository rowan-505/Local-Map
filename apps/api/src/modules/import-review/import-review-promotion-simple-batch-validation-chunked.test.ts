import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY } from "./import-review-promotion-simple-config.js";
import {
    ImportReviewPromotionSimpleBatchValidation,
    type PublishItemSimpleValidationOutcome,
    type PublishItemValidationTarget,
} from "./import-review-promotion-simple-batch-validation.js";
import { ImportReviewSimplePromotionValidationRepository, type SimplePromotionCandidateValidationRow } from "./import-review-promotion-simple-validation.js";
import {
    buildPromotionValidationGeometrySelectSql,
    listPromotionValidationScalarColumnNames,
} from "./import-review-promotion-simple-validation-sql.js";
import { resolvePromotionValidationChunkSize } from "./import-review-promotion-validation-chunks.js";

function readyRow(id: bigint): SimplePromotionCandidateValidationRow {
    return {
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
        admin_area_id: 1n,
        class_code: "yes",
        name_mm: "မြန်မာ",
        name_en: "Building",
        geomDiagnostics: {
            present: true,
            valid: true,
            srid: 4326,
            type: "ST_Polygon",
            empty: false,
            areaM2: 1200,
        },
    };
}

function readyOutcome(publishItemId: bigint, family: string): PublishItemSimpleValidationOutcome {
    return {
        publish_item_id: publishItemId,
        entity_family: family,
        status: "ready",
        skipped: false,
        result: { status: "ready", errors: [], warnings: [] },
    };
}

function makeBuildingTarget(index: number): PublishItemValidationTarget {
    return {
        publish_item_id: BigInt(index),
        entity_family: "buildings",
        review_candidate_id: BigInt(1000 + index),
        review_batch_id: 2n,
    };
}

function makePlaceTarget(index: number): PublishItemValidationTarget {
    return {
        publish_item_id: BigInt(10_000 + index),
        entity_family: "places",
        review_candidate_id: BigInt(2000 + index),
        review_batch_id: 2n,
    };
}

describe("ImportReviewPromotionSimpleBatchValidation chunked validation", () => {
    it("validates 1 building candidate via batch load", async () => {
        const target = makeBuildingTarget(1);
        const svc = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);
        let batchLoadCalls = 0;

        svc.simpleRepo.loadCandidateRowsBatch = async (_config, ids) => {
            batchLoadCalls += 1;
            assert.equal(ids.length, 1);
            return new Map([[target.review_candidate_id.toString(), readyRow(target.review_candidate_id)]]);
        };
        svc.simpleRepo.resolveFkExistenceBatch = async () =>
            new Map([[target.review_candidate_id.toString(), { building_type_id: true, admin_area_id: true }]]);

        const outcomes = await svc.validateTargetsChunk([target], "buildings");
        assert.equal(batchLoadCalls, 1);
        assert.equal(outcomes.length, 1);
        assert.equal(outcomes[0]?.status, "ready");
    });

    it("validates 250 building candidates in multiple chunks", async () => {
        const chunkSize = resolvePromotionValidationChunkSize("buildings");
        const targets = Array.from({ length: 250 }, (_, i) => makeBuildingTarget(i + 1));
        const svc = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);
        const batchLoads: number[] = [];

        svc.listPublishItemTargets = async () => targets;
        svc.simpleRepo.loadCandidateRowsBatch = async (_config, ids) => {
            batchLoads.push(ids.length);
            const map = new Map<string, SimplePromotionCandidateValidationRow>();
            for (const id of ids) {
                map.set(id.toString(), readyRow(id));
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

        const outcomes = await svc.validatePublishBatch(17n);
        assert.equal(outcomes.length, 250);
        assert.equal(batchLoads.length, Math.ceil(250 / chunkSize));
        assert.equal(batchLoads.reduce((a, b) => a + b, 0), 250);
    });

    it("validates mixed buildings and places in separate family chunks", async () => {
        const targets = [
            makeBuildingTarget(1),
            makeBuildingTarget(2),
            makePlaceTarget(1),
        ];
        const svc = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);
        const familiesLoaded: string[] = [];

        svc.listPublishItemTargets = async () => targets;
        svc.simpleRepo.loadCandidateRowsBatch = async (config, ids) => {
            familiesLoaded.push(config.family);
            const map = new Map<string, SimplePromotionCandidateValidationRow>();
            for (const id of ids) {
                const row =
                    config.family === "places"
                        ? {
                              ...readyRow(id),
                              category_id: 1n,
                              admin_area_id: 1n,
                              point_geom: undefined,
                              geomDiagnostics: {
                                  present: true,
                                  valid: true,
                                  srid: 4326,
                                  type: "ST_Point",
                                  empty: false,
                              },
                          }
                        : readyRow(id);
                map.set(id.toString(), row as SimplePromotionCandidateValidationRow);
            }
            return map;
        };
        svc.simpleRepo.resolveFkExistenceBatch = async (config, rows) => {
            const map = new Map<string, Record<string, boolean>>();
            for (const row of rows) {
                if (config.family === "places") {
                    map.set(row.id.toString(), { category_id: true, admin_area_id: true });
                } else {
                    map.set(row.id.toString(), { building_type_id: true });
                }
            }
            return map;
        };

        const outcomes = await svc.validatePublishBatch(17n);
        assert.equal(outcomes.length, 3);
        assert.deepEqual(familiesLoaded, ["buildings", "places"]);
    });

    it("updates progress via onChunkComplete before all outcomes are returned", async () => {
        const chunkSize = resolvePromotionValidationChunkSize("buildings");
        const total = chunkSize + 10;
        const targets = Array.from({ length: total }, (_, i) => makeBuildingTarget(i + 1));
        const svc = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);

        svc.listPublishItemTargets = async () => targets;
        svc.simpleRepo.loadCandidateRowsBatch = async (_config, ids) => {
            const map = new Map<string, SimplePromotionCandidateValidationRow>();
            for (const id of ids) {
                map.set(id.toString(), readyRow(id));
            }
            return map;
        };
        svc.simpleRepo.resolveFkExistenceBatch = async (_config, rows) => {
            const map = new Map<string, Record<string, boolean>>();
            for (const row of rows) {
                map.set(row.id.toString(), { building_type_id: true });
            }
            return map;
        };

        const chunkDone: number[] = [];
        let outcomesLengthAtFirstChunk = -1;

        const outcomesPromise = svc.validatePublishBatch(17n, {
            onChunkComplete: async (event) => {
                chunkDone.push(event.done);
                if (chunkDone.length === 1) {
                    outcomesLengthAtFirstChunk = -1;
                }
            },
        });

        const outcomes = await outcomesPromise;
        assert.equal(outcomes.length, total);
        assert.ok(chunkDone.length >= 2);
        assert.ok(chunkDone[0]! < total);
        assert.equal(chunkDone.at(-1), total);
        assert.equal(outcomesLengthAtFirstChunk, -1);
    });

    it("shouldAbort during validateTargetsChunk stops before completing the chunk", async () => {
        const targets = Array.from({ length: 60 }, (_, i) => makeBuildingTarget(i + 1));
        const svc = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);
        svc.listPublishItemTargets = async () => targets;

        svc.simpleRepo.loadCandidateRowsBatch = async () => {
            const map = new Map<string, ReturnType<typeof readyRow>>();
            for (const t of targets) {
                map.set(t.review_candidate_id.toString(), readyRow(t.review_candidate_id));
            }
            return map;
        };
        svc.simpleRepo.resolveFkExistenceBatch = async () => new Map();

        let progressCalls = 0;
        let completed = false;
        await assert.rejects(
            () =>
                svc.validatePublishBatch(17n, {
                    onProgress: async () => {
                        progressCalls += 1;
                    },
                    shouldAbort: async () => progressCalls >= 1,
                }),
            (err: unknown) =>
                err instanceof Error && err.name === "ImportReviewPublishBatchValidationAbortedError"
        );
        assert.ok(progressCalls >= 1);
        assert.equal(completed, false);
    });

    it("marks chunk items blocked and rethrows on unexpected chunk failure", async () => {
        const targets = [makeBuildingTarget(1), makeBuildingTarget(2)];
        const svc = new ImportReviewPromotionSimpleBatchValidation({} as PrismaClient);
        svc.listPublishItemTargets = async () => targets;
        svc.validateTargetsChunk = async () => {
            throw new Error("simulated chunk crash");
        };

        const persisted: PublishItemSimpleValidationOutcome[] = [];
        await assert.rejects(
            () =>
                svc.validatePublishBatch(17n, {
                    onChunkComplete: async (event) => {
                        persisted.push(...event.outcomes);
                    },
                }),
            /simulated chunk crash/
        );

        assert.equal(persisted.length, 2);
        assert.equal(persisted[0]?.status, "blocked");
        assert.equal(persisted[0]?.result.errors[0]?.code, "validation_chunk_failed");
    });
});

describe("loadCandidateRowsBatch geometry scalars", () => {
    it("buildings batch SELECT uses scalar geometry facts only", async () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings;
        const scalars = listPromotionValidationScalarColumnNames(config);
        assert.equal(scalars.includes("geom"), false);

        const prisma = {
            $queryRaw: async () => [
                {
                    id: 1n,
                    review_batch_id: 2n,
                    review_status: "approved",
                    review_decision: "approved",
                    promotion_status: "ready",
                    promoted_core_id: null,
                    building_type_id: 1n,
                    external_id: "x",
                    source_refs: {},
                    confidence_score: 80,
                    has_geom: true,
                    geom_is_valid: true,
                    geom_srid: 4326,
                    geom_type: "ST_Polygon",
                    geom_is_empty: false,
                    geom_length_m: null,
                    geom_area_m2: 1200,
                },
            ],
        } as unknown as PrismaClient;

        const repo = new ImportReviewSimplePromotionValidationRepository(prisma);
        const map = await repo.loadCandidateRowsBatch(config, [1n], 2n);
        assert.equal(map.size, 1);
        assert.equal(map.get("1")?.geomDiagnostics?.present, true);
        assert.equal("geom" in (map.get("1") ?? {}), false);

        const geomSql = buildPromotionValidationGeometrySelectSql(config);
        const geomSqlText =
            typeof geomSql === "object" && geomSql !== null && "strings" in geomSql
                ? (geomSql as { strings: string[] }).strings.join("?")
                : String(geomSql);
        assert.match(geomSqlText, /ST_IsValid/);
        assert.match(geomSqlText, /geom_area_m2/);
    });
});

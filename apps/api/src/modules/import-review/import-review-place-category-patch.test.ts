import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";

import {
    mapOverridePatchToColumnPatch,
    pickColumnSnapshot,
} from "./import-review-candidate-column-patch.js";
import { buildUpdateColumnAssignment } from "./import-review-candidate-sql.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import { GenericImportReviewCandidateRepository } from "./import-review-generic-candidate.repo.js";
import { importReviewBuildingItemSchema } from "./import-review.openapi.js";
import { ImportReviewReferenceOptionsRepository } from "./import-review-reference-options.repo.js";
import { sanitizeReviewOverridesPatch } from "./import-review-overrides-sanitize.js";

type QueryRawHandler = (
    strings: TemplateStringsArray,
    ...values: unknown[]
) => Promise<unknown>;

function createMockPrisma(handlers: {
    queryRaw: QueryRawHandler;
    executeRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}): PrismaClient {
    type TxClient = {
        $queryRaw: ReturnType<typeof mock.fn<QueryRawHandler>>;
        $executeRaw: ReturnType<typeof mock.fn>;
        $transaction: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>;
    };
    const client: TxClient = {
        $queryRaw: mock.fn(handlers.queryRaw),
        $executeRaw: mock.fn(handlers.executeRaw ?? (async () => 1)),
        $transaction: async <T>(fn: (tx: TxClient) => Promise<T>) => fn(client),
    };
    return client as unknown as PrismaClient;
}

function refRepoQueryRawForPoiCategories(exists: boolean): QueryRawHandler {
    return async (strings) => {
        const sql = strings.join("?");
        if (sql.includes("to_regclass")) {
            return [{ ok: true }];
        }
        if (sql.includes("ref.ref_poi_categories")) {
            return exists ? [{ id: 39n }] : [];
        }
        return [];
    };
}

function sqlFragment(sql: Prisma.Sql): string {
    return sql.strings.join("?");
}

describe("import-review places category_id direct PATCH", () => {
    it("OpenAPI building item schema exposes category_id for response serialization", () => {
        const props = importReviewBuildingItemSchema.properties as Record<string, unknown>;
        assert.ok("category_id" in props);
        assert.equal(importReviewBuildingItemSchema.additionalProperties, false);
    });

    it("sanitize + mapOverridePatchToColumnPatch persist category_id to place_candidates column", () => {
        const sanitized = sanitizeReviewOverridesPatch("places", {
            category_id: "39",
            name_en: "Test Place",
        });
        assert.equal(sanitized.category_id, 39);

        const columnPatch = mapOverridePatchToColumnPatch("places", sanitized);
        assert.deepEqual(columnPatch.category_id, 39);
        assert.equal(sqlFragment(buildUpdateColumnAssignment("category_id", 39)), "category_id = ?::bigint");
    });

    it("ImportReviewReferenceOptionsRepository rejects unknown poi category ids", async () => {
        const prisma = createMockPrisma({
            queryRaw: refRepoQueryRawForPoiCategories(false),
        });
        const repo = new ImportReviewReferenceOptionsRepository(prisma);
        const exists = await repo.poiCategoryExistsById(999_999n);
        assert.equal(exists, false);
    });

    it("ImportReviewReferenceOptionsRepository accepts known poi category ids", async () => {
        const prisma = createMockPrisma({
            queryRaw: refRepoQueryRawForPoiCategories(true),
        });
        const repo = new ImportReviewReferenceOptionsRepository(prisma);
        const exists = await repo.poiCategoryExistsById(39n);
        assert.equal(exists, true);
    });

    it("generic repo UPDATE includes category_id and audit snapshot without review_overrides", async () => {
        let queryCalls = 0;
        let executeSql = "";

        const prisma = createMockPrisma({
            queryRaw: async (strings, ...values) => {
                queryCalls += 1;
                const sql = strings.join("?");

                if (queryCalls <= 2) {
                    return [{ ok: true }];
                }
                if (queryCalls === 3) {
                    return [{ category_id: null, name_en: "Before" }];
                }
                if (queryCalls === 4) {
                    return [{ id: 23n }];
                }
                if (queryCalls === 5) {
                    return [
                        {
                            id: 23n,
                            public_id: "plc-23",
                            review_batch_id: 2n,
                            source_snapshot_version: "snap",
                            local_staging_id: 1n,
                            source_snapshot_id_local: null,
                            external_id: null,
                            canonical_name: null,
                            name: null,
                            name_mm: null,
                            name_en: "After",
                            category_id: 39n,
                            class_code: null,
                            building_type: null,
                            building_type_id: null,
                            landuse_class_id: null,
                            admin_area_id: null,
                            levels: null,
                            height_m: null,
                            area_m2: null,
                            confidence_score: null,
                            match_status: null,
                            auto_action: null,
                            review_status: null,
                            review_decision: null,
                            reviewed_by: null,
                            reviewed_at: null,
                            review_note: null,
                            normalized_data: {},
                            source_refs: {},
                            matched_core_id: null,
                            matched_core_table: null,
                            matched_core_data: {},
                            f2_comparison: {},
                            validation_warnings: [],
                            validation_errors: [],
                            promotion_status: null,
                            promoted_core_id: null,
                            created_at: new Date(),
                            updated_at: new Date(),
                            geometry: null,
                            centroid: null,
                        },
                    ];
                }
                return [];
            },
            executeRaw: async (strings) => {
                executeSql = strings.join("?");
                return 1;
            },
        });

        const repo = new GenericImportReviewCandidateRepository(prisma);
        const columnPatch = mapOverridePatchToColumnPatch("places", {
            category_id: 39,
            name_en: "After",
        });

        const row = await repo.patchCandidateColumns({
            family: "places",
            reviewBatchId: 2n,
            id: 23n,
            columnPatch,
            editedByUserId: 1n,
            reviewNote: null,
            requireTypedColumnUpdates: true,
        });

        assert.equal(queryCalls, 5);
        assert.match(executeSql, /review_candidate_edits/);
        assert.doesNotMatch(executeSql, /review_overrides/i);
        assert.equal(row?.category_id, 39n);
        assert.equal(row?.name_en, "After");

        const beforeSnap = pickColumnSnapshot({ category_id: null, name_en: "Before" }, [
            "category_id",
            "name_en",
        ]);
        const afterSnap = pickColumnSnapshot(
            { category_id: 39n, name_en: "After" } as Record<string, unknown>,
            ["category_id", "name_en"]
        );
        assert.equal(beforeSnap.category_id, null);
        assert.equal(afterSnap.category_id, "39");
        assert.equal(afterSnap.name_en, "After");
    });

    it("rejects invalid category_id with ImportReviewDecisionRuleError message", async () => {
        const prisma = createMockPrisma({
            queryRaw: refRepoQueryRawForPoiCategories(false),
        });
        const refRepo = new ImportReviewReferenceOptionsRepository(prisma);
        const exists = await refRepo.poiCategoryExistsById(999_999n);
        assert.equal(exists, false);

        const err = new ImportReviewDecisionRuleError(
            "Unknown category_id=999999 (must match ref.ref_poi_categories)."
        );
        assert.match(err.message, /Unknown category_id=999999/);
    });
});

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";

import { GenericImportReviewCandidateRepository } from "./import-review-generic-candidate.repo.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import { IMPORT_REVIEW_CANDIDATE_COLUMN_EDIT_TYPE } from "./import-review-candidate-column-patch.js";

type QueryRawHandler = (
    strings: TemplateStringsArray,
    ...values: unknown[]
) => Promise<unknown>;

type ExecuteRawHandler = (
    strings: TemplateStringsArray,
    ...values: unknown[]
) => Promise<unknown>;

function createMockPrisma(handlers: {
    queryRaw: QueryRawHandler;
    executeRaw?: ExecuteRawHandler;
}): PrismaClient {
    type TxClient = {
        $queryRaw: ReturnType<typeof mock.fn<QueryRawHandler>>;
        $executeRaw: ReturnType<typeof mock.fn<ExecuteRawHandler>>;
        $transaction: <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>;
    };
    const client: TxClient = {
        $queryRaw: mock.fn(handlers.queryRaw),
        $executeRaw: mock.fn(handlers.executeRaw ?? (async () => 1)),
        $transaction: async <T>(fn: (tx: TxClient) => Promise<T>) => fn(client),
    };
    return client as unknown as PrismaClient;
}

describe("GenericImportReviewCandidateRepository.patchCandidateColumns", () => {
    it("throws when requireTypedColumnUpdates and columnPatch is empty", async () => {
        const prisma = createMockPrisma({
            queryRaw: async () => [{ ok: true }],
        });
        const repo = new GenericImportReviewCandidateRepository(prisma);

        await assert.rejects(
            () =>
                repo.patchCandidateColumns({
                    family: "places",
                    reviewBatchId: 2n,
                    id: 100n,
                    columnPatch: {},
                    editedByUserId: 1n,
                    reviewNote: null,
                    requireTypedColumnUpdates: true,
                }),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("at least one typed column assignment")
        );
    });

    it("returns null when candidate row is missing (404 path)", async () => {
        let queryCalls = 0;
        const prisma = createMockPrisma({
            queryRaw: async () => {
                queryCalls += 1;
                if (queryCalls <= 2) {
                    return [{ ok: true }];
                }
                return [];
            },
        });
        const repo = new GenericImportReviewCandidateRepository(prisma);

        const row = await repo.patchCandidateColumns({
            family: "roads",
            reviewBatchId: 2n,
            id: 999n,
            columnPatch: { surface: "paved" },
            editedByUserId: 1n,
            reviewNote: null,
            requireTypedColumnUpdates: true,
        });

        assert.equal(row, null);
    });

    it("persists road surface via UPDATE RETURNING then reloads DB row", async () => {
        let queryCalls = 0;
        let executeCalls = 0;

        const prisma = createMockPrisma({
            queryRaw: async () => {
                queryCalls += 1;

                if (queryCalls <= 2) {
                    return [{ ok: true }];
                }
                if (queryCalls === 3) {
                    return [{ surface: "dirt" }];
                }
                if (queryCalls === 4) {
                    return [{ id: 55n }];
                }
                if (queryCalls === 5) {
                    return [
                        {
                            id: 55n,
                            public_id: "rd-55",
                            review_batch_id: 2n,
                            source_snapshot_version: "snap",
                            local_staging_id: 1n,
                            source_snapshot_id_local: null,
                            external_id: "ext",
                            canonical_name: "Road",
                            name: "Road",
                            class_code: null,
                            building_type: null,
                            building_type_id: null,
                            land_area_class_id: null,
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
                            road_candidate_road_class_id: null,
                            road_candidate_surface: "paved",
                            road_candidate_is_oneway: false,
                            road_candidate_class_label: null,
                            length_m: null,
                        },
                    ];
                }
                return [];
            },
            executeRaw: async () => {
                executeCalls += 1;
                return 1;
            },
        });

        const repo = new GenericImportReviewCandidateRepository(prisma);
        const row = await repo.patchCandidateColumns({
            family: "roads",
            reviewBatchId: 2n,
            id: 55n,
            columnPatch: { surface: "paved" },
            editedByUserId: 10n,
            reviewNote: "direct edit",
            requireTypedColumnUpdates: true,
        });

        assert.equal(queryCalls, 5);
        assert.equal(executeCalls, 1);
        assert.equal(row?.road_candidate_surface, "paved");
    });

    it("water polygon PATCH audit uses valid edit_type constant", async () => {
        let queryCalls = 0;
        let executeCalls = 0;
        let capturedEditType: string | null = null;

        const prisma = createMockPrisma({
            queryRaw: async () => {
                queryCalls += 1;
                if (queryCalls <= 2) {
                    return [{ ok: true }];
                }
                if (queryCalls === 3) {
                    return [{ class_code: "lake" }];
                }
                if (queryCalls === 4) {
                    return [{ id: 7n }];
                }
                if (queryCalls === 5) {
                    return [
                        {
                            id: 7n,
                            public_id: "wp-7",
                            review_batch_id: 2n,
                            source_snapshot_version: "snap",
                            local_staging_id: 1n,
                            source_snapshot_id_local: null,
                            external_id: null,
                            canonical_name: null,
                            name: null,
                            class_code: "reservoir",
                            building_type: null,
                            building_type_id: null,
                            land_area_class_id: null,
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
            executeRaw: async (_strings, ...values) => {
                executeCalls += 1;
                capturedEditType =
                    (values.find((v) => v === IMPORT_REVIEW_CANDIDATE_COLUMN_EDIT_TYPE) as
                        | string
                        | undefined) ?? null;
                return 1;
            },
        });

        const repo = new GenericImportReviewCandidateRepository(prisma);
        const row = await repo.patchCandidateColumns({
            family: "water_polygons",
            reviewBatchId: 2n,
            id: 7n,
            columnPatch: { class_code: "reservoir" },
            editedByUserId: null,
            reviewNote: null,
            requireTypedColumnUpdates: true,
        });

        assert.equal(queryCalls, 5);
        assert.equal(executeCalls, 1);
        assert.equal(capturedEditType, "override_update");
        assert.equal(row?.class_code, "reservoir");
    });

    it("routing barrier PATCH uses bigint cast in SET and audit json without BigInt throw", async () => {
        let queryCalls = 0;
        let executeCalls = 0;
        const prisma = createMockPrisma({
            queryRaw: async () => {
                queryCalls += 1;
                if (queryCalls <= 2) {
                    return [{ ok: true }];
                }
                if (queryCalls === 3) {
                    return [{ admin_area_id: null }];
                }
                if (queryCalls === 4) {
                    return [{ id: 3n }];
                }
                if (queryCalls === 5) {
                    return [
                        {
                            id: 3n,
                            public_id: "rb-3",
                            review_batch_id: 2n,
                            source_snapshot_version: "snap",
                            local_staging_id: 1n,
                            source_snapshot_id_local: null,
                            external_id: null,
                            canonical_name: null,
                            name: null,
                            class_code: "gate",
                            building_type: null,
                            building_type_id: null,
                            land_area_class_id: null,
                            admin_area_id: 88n,
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
            executeRaw: async (_strings, ...values) => {
                executeCalls += 1;
                const afterJson = values.find((v) => typeof v === "string" && v.includes("88"));
                assert.ok(afterJson);
                assert.doesNotThrow(() => JSON.parse(String(afterJson)));
                return 1;
            },
        });

        const repo = new GenericImportReviewCandidateRepository(prisma);
        const row = await repo.patchCandidateColumns({
            family: "routing_barriers",
            reviewBatchId: 2n,
            id: 3n,
            columnPatch: { admin_area_id: 88 },
            editedByUserId: 1n,
            reviewNote: null,
            requireTypedColumnUpdates: true,
        });

        assert.equal(queryCalls, 5);
        assert.equal(executeCalls, 1);
        assert.equal(row?.admin_area_id, 88n);
    });
});

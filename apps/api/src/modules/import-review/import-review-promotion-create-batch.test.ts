import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { PrismaClient } from "@prisma/client";

import type { JwtUser } from "../../plugins/auth.js";
import {
    ImportReviewPromotionCreateBatchResolver,
    normalizeCandidateIdsByFamilyInput,
    PROMOTION_CREATE_BATCH_NO_LIMIT_ELIGIBLE_MESSAGE,
    resolveCreateBatchFamiliesFromSimpleRegistry,
} from "./import-review-promotion-create-batch.js";
import {
    buildCreateBatchDryRunResponse,
    buildCreateBatchSuccessResponse,
    publishBatchIdToNumber,
    resolveCreateBatchFamilies,
} from "./import-review-promotion-create-batch-api.js";
import { IMPORT_REVIEW_PROMOTION_TARGETS } from "./import-review-promotion-config.js";
import {
    ImportReviewPromotionNoEligibleCandidatesError,
    ImportReviewPromotionSelectedCandidateError,
    ImportReviewTransportPromotionDeprecatedError,
} from "./import-review-promotion.errors.js";
import { ImportReviewPromotionService } from "./import-review-promotion.service.js";
import type { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import type { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import type { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { assertPublishBatchLimits } from "./import-review-promotion-batch-limits.js";
import { ImportReviewPromotionBatchLimitsError } from "./import-review-promotion.errors.js";
import { postImportReviewPromotionBatchBodySchema } from "./import-review-promotion.schema.js";
import { listPromotableFamilies } from "./import-review-promotion-simple-config.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";
import { buildSelectCreateBatchEligibleCandidateIdsSql } from "./import-review-promotion-create-batch-eligibility.js";

function queryRawSqlText(sql: unknown): string {
    if (sql && typeof sql === "object" && "strings" in sql && Array.isArray((sql as { strings: unknown }).strings)) {
        const tagged = sql as { strings: string[]; values?: unknown[] };
        const text = tagged.strings.join("?");
        const values =
            tagged.values && tagged.values.length > 0
                ? ` /*values:${tagged.values.map((v) => String(v)).join(",")}*/`
                : "";
        return text + values;
    }
    return String(sql);
}

function createMockPrismaForResolver(handlers: {
    queryRaw: (sql: unknown, ...values: unknown[]) => Promise<unknown>;
}): PrismaClient {
    return {
        $queryRaw: mock.fn((sql: unknown, ...values: unknown[]) => handlers.queryRaw(sql, ...values)),
    } as unknown as PrismaClient;
}

function createMockRepo(
    prisma: PrismaClient,
    overrides: Partial<ImportReviewPromotionRepository> = {}
): ImportReviewPromotionRepository {
    return {
        getPrisma: () => prisma,
        resolveScope: async () => ({
            reviewBatchId: 2n,
            snapshotVersion: "snap-v1",
        }),
        createPublishBatchMultiFamily: async (args: {
            candidateIdsByFamily?: Readonly<Record<string, readonly bigint[]>>;
        }) => {
            const idsByFamily = args.candidateIdsByFamily ?? {};
            const total = Object.values(idsByFamily).reduce(
                (sum, ids) => sum + (ids?.length ?? 0),
                0
            );
            return {
                batch: { id: 42n, batch_name: "live", status: "draft" },
                itemsAdded: total,
                candidatesMarked: 0,
                byFamily: [],
                timing: { resolve_ms: 0, eligibility_ms: 0, payload_ms: 0, transaction_ms: 0 },
                totalSelected: total,
            };
        },
        ...overrides,
    } as unknown as ImportReviewPromotionRepository;
}

const testUser = { sub: "1", email: "test@example.com", roles: ["admin"] } as JwtUser;

function createService(repo: ImportReviewPromotionRepository): ImportReviewPromotionService {
    const validationRepo = {
        prisma: {} as PrismaClient,
    } as unknown as ImportReviewPromotionValidationRepository;
    return new ImportReviewPromotionService(
        repo,
        validationRepo,
        {} as ImportReviewPromotionPromoteRepository
    );
}

describe("import-review-promotion-create-batch schema", () => {
    it("parses selected mode with candidate_ids_by_family", () => {
        const parsed = postImportReviewPromotionBatchBodySchema.safeParse({
            review_batch_id: "2",
            mode: "selected",
            families: ["places", "buildings"],
            candidate_ids_by_family: {
                places: [23, 24],
                buildings: [1020],
            },
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.mode, "selected");
            assert.deepEqual(parsed.data.candidate_ids_by_family?.places, [23n, 24n]);
        }
    });

    it("parses all_ready mode with filters", () => {
        const parsed = postImportReviewPromotionBatchBodySchema.safeParse({
            review_batch_id: "2",
            mode: "all_ready",
            families: ["places"],
            filters: { review_decision: "approved", include_warnings: false },
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.mode, "all_ready");
            assert.equal(parsed.data.filters?.include_warnings, false);
        }
    });

    it("maps legacy approved_only mode to all_ready", () => {
        const parsed = postImportReviewPromotionBatchBodySchema.safeParse({
            review_batch_id: "2",
            mode: "approved_only",
            families: ["buildings"],
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.mode, "all_ready");
        }
    });

    it("rejects selected mode without candidate ids", () => {
        const parsed = postImportReviewPromotionBatchBodySchema.safeParse({
            review_batch_id: "2",
            mode: "selected",
            families: ["places"],
            candidate_ids_by_family: {},
        });
        assert.equal(parsed.success, false);
    });
});

describe("resolveCreateBatchFamiliesFromSimpleRegistry", () => {
    it("includes all nine simple promotable families", () => {
        const configs = resolveCreateBatchFamiliesFromSimpleRegistry(listPromotableFamilies());
        assert.equal(configs.length, 9);
    });

    it("rejects bus families", () => {
        assert.throws(
            () => resolveCreateBatchFamiliesFromSimpleRegistry(["bus_routes"]),
            (err: unknown) => err instanceof ImportReviewTransportPromotionDeprecatedError
        );
    });
});

describe("ImportReviewPromotionCreateBatchResolver", () => {
    it("all_ready: resolves eligible candidate ids per family", async () => {
        let call = 0;
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => {
                call += 1;
                if (call === 1) {
                    return [{ id: 23n }, { id: 24n }];
                }
                return [{ id: 1020n }];
            },
        });
        const resolver = new ImportReviewPromotionCreateBatchResolver(prisma);
        const result = await resolver.resolveCandidateIds({
            reviewBatchId: 2n,
            mode: "all_ready",
            families: ["places", "buildings"],
            filters: { review_decision: "approved", include_warnings: false },
        });

        assert.equal(result.totalItems, 3);
        assert.equal(result.countByFamily.places, 2);
        assert.equal(result.countByFamily.buildings, 1);
        assert.equal(call, 2);
    });

    it("selected: one place resolves to exactly one publish item", async () => {
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [{ id: 23n }],
        });
        const resolver = new ImportReviewPromotionCreateBatchResolver(prisma);
        const result = await resolver.resolveCandidateIds({
            reviewBatchId: 2n,
            mode: "selected",
            families: ["places"],
            candidateIdsByFamily: { places: [23n] },
            filters: { review_decision: "approved", include_warnings: false },
        });

        assert.equal(result.totalItems, 1);
        assert.deepEqual(result.candidateIdsByFamily.places, [23n]);
    });

    it("selected: rejects candidate id from wrong review batch", async () => {
        let call = 0;
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => {
                call += 1;
                if (call === 1) {
                    return [];
                }
                if (call === 2) {
                    return [{ id: 23n, review_batch_id: 99n }];
                }
                return [];
            },
        });
        const resolver = new ImportReviewPromotionCreateBatchResolver(prisma);
        await assert.rejects(
            () =>
                resolver.resolveCandidateIds({
                    reviewBatchId: 2n,
                    mode: "selected",
                    families: ["places"],
                    candidateIdsByFamily: { places: [23n] },
                    filters: { review_decision: "approved", include_warnings: false },
                }),
            (err: unknown) =>
                err instanceof ImportReviewPromotionSelectedCandidateError &&
                err.reason === "wrong_review_batch"
        );
    });

    it("selected: rejects candidate id from wrong family", async () => {
        let call = 0;
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => {
                call += 1;
                if (call === 1) {
                    return [];
                }
                if (call === 2) {
                    return [];
                }
                if (call === 3) {
                    return [{ id: 1020n, review_batch_id: 2n }];
                }
                return [];
            },
        });
        const resolver = new ImportReviewPromotionCreateBatchResolver(prisma);
        await assert.rejects(
            () =>
                resolver.resolveCandidateIds({
                    reviewBatchId: 2n,
                    mode: "selected",
                    families: ["places"],
                    candidateIdsByFamily: { places: [1020n] },
                    filters: { review_decision: "approved", include_warnings: false },
                }),
            (err: unknown) =>
                err instanceof ImportReviewPromotionSelectedCandidateError &&
                err.reason === "wrong_family"
        );
    });

    it("throws 400-class error when no candidates resolve", async () => {
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [],
        });
        const resolver = new ImportReviewPromotionCreateBatchResolver(prisma);
        await assert.rejects(
            () =>
                resolver.resolveCandidateIds({
                    reviewBatchId: 2n,
                    mode: "all_ready",
                    families: ["places"],
                    filters: { review_decision: "approved", include_warnings: false },
                }),
            (err: unknown) => err instanceof ImportReviewPromotionNoEligibleCandidatesError
        );
    });

    it("selects at most max_items roads using lightweight not_ready eligibility", async () => {
        const roadIds = Array.from({ length: 20 }, (_, i) => ({ id: BigInt(i + 1) }));
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => roadIds,
        });
        const resolver = new ImportReviewPromotionCreateBatchResolver(prisma);
        const resolution = await resolver.resolveCandidateIds({
            reviewBatchId: 2n,
            mode: "all_ready",
            families: ["roads"],
            filters: { review_decision: "approved", include_warnings: false },
            maxItems: 20,
        });

        assert.equal(resolution.totalItems, 20);
        assert.equal(resolution.candidateIdsByFamily.roads?.length, 20);

        const cfg = getImportReviewPublishFamilyConfig("roads");
        assert.ok(cfg);
        const sqlText = queryRawSqlText(
            buildSelectCreateBatchEligibleCandidateIdsSql(
                cfg,
                2n,
                { includeWarnings: false, includeMerged: false },
                { limit: 20 }
            )
        );
        assert.match(sqlText, /LIMIT/i);
        assert.match(sqlText, /promotion_status\s*=\s*'not_ready'/i);
        assert.match(sqlText, /review_status\s*=\s*'approved'/i);
        assert.match(sqlText, /road_class_id IS NOT NULL/i);
    });

    it("returns limit-specific message when max_items yields zero roads", async () => {
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [],
        });
        const resolver = new ImportReviewPromotionCreateBatchResolver(prisma);
        await assert.rejects(
            () =>
                resolver.resolveCandidateIds({
                    reviewBatchId: 2n,
                    mode: "all_ready",
                    families: ["roads"],
                    filters: { review_decision: "approved", include_warnings: false },
                    maxItems: 20,
                }),
            (err: unknown) => {
                assert.ok(err instanceof ImportReviewPromotionNoEligibleCandidatesError);
                assert.equal(err.message, PROMOTION_CREATE_BATCH_NO_LIMIT_ELIGIBLE_MESSAGE);
                return true;
            }
        );
    });
});

describe("import-review-promotion-create-batch schema max_items", () => {
    it("parses max_items for roads test batch", () => {
        const parsed = postImportReviewPromotionBatchBodySchema.safeParse({
            review_batch_id: "2",
            families: ["roads"],
            max_items: 20,
            batch_name: "roads-test-20",
            allow_high_risk_families: true,
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.max_items, 20);
        }
    });
});

describe("import-review promotion batch limits on create", () => {
    it("rejects live create over 200 items without confirm_large_batch", async () => {
        const bigIds = Array.from({ length: 201 }, (_, i) => BigInt(i + 1));
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => bigIds.map((id) => ({ id })),
        });
        const repo = createMockRepo(prisma);
        const service = createService(repo);

        await assert.rejects(
            () =>
                service.createBatch(
                    {
                        review_batch_id: 2n,
                        mode: "selected",
                        families: ["buildings"],
                        candidate_ids_by_family: { buildings: bigIds },
                        dry_run: false,
                        include_warnings: false,
                        include_merged: false,
                        allow_high_risk_families: false,
                        confirm_large_batch: false,
                        mixed_high_risk_confirm: false,
                    },
                    testUser
                ),
            (err: unknown) => err instanceof ImportReviewPromotionBatchLimitsError
        );
    });

    it("allows dry-run preview over 200 without confirm_large_batch", async () => {
        const bigIds = Array.from({ length: 201 }, (_, i) => BigInt(i + 1));
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => bigIds.map((id) => ({ id })),
        });
        const repo = createMockRepo(prisma);
        const service = createService(repo);

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                mode: "selected",
                families: ["buildings"],
                candidate_ids_by_family: { buildings: bigIds },
                dry_run: true,
                include_warnings: false,
                include_merged: false,
                allow_high_risk_families: false,
                confirm_large_batch: false,
                mixed_high_risk_confirm: false,
            },
            testUser
        );
        assert.equal("dry_run" in result && result.dry_run, true);
    });
});

describe("buildCreateBatchSuccessResponse", () => {
    it("exposes numeric id from system_publish_batches.id", () => {
        const response = buildCreateBatchSuccessResponse({
            batch: { id: 77n, batch_name: "place-one", status: "draft" },
            detail: {
                id: "77",
                public_id: "550e8400-e29b-41d4-a716-446655440000",
                batch_name: "place-one",
                status: "draft",
                total_item_count: 1,
            } as Awaited<ReturnType<ImportReviewPromotionService["getBatchById"]>>,
            reviewBatchId: 2n,
            mode: "selected",
            families: ["places"],
            countByFamily: { places: 1 },
            itemsAdded: 1,
            totalSelected: 1,
            candidatesMarked: 1,
            byFamily: [
                { entity_family: "places", items_added: 1, marked_batched: 1, skipped_reasons: [] },
            ],
            skipped: 0,
            timing_ms: {
                resolve_ms: 0,
                eligibility_ms: 0,
                payload_ms: 0,
                transaction_ms: 0,
                total_ms: 0,
            },
            buildingsMarked: 0,
            message: "ok",
        });

        assert.equal(response.id, 77);
        assert.equal(publishBatchIdToNumber(77n), 77);
        assert.equal(response.public_id, "550e8400-e29b-41d4-a716-446655440000");
        assert.equal(response.review_batch_id, 2);
        assert.equal(response.mode, "selected");
        assert.equal(response.total_item_count, 1);
        assert.deepEqual(response.count_by_family, { places: 1 });
        assert.equal(typeof response.id, "number");
    });
});

describe("import-review promotion create batch service", () => {
    it("selected mode creates batch with one place and total_items=1", async () => {
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [{ id: 23n }],
        });
        const repo = createMockRepo(prisma, {
            createPublishBatchMultiFamily: async (args) => {
                assert.deepEqual(args.candidateIdsByFamily?.places, [23n]);
                return {
                    batch: { id: 77n, batch_name: "place-one", status: "draft" },
                    itemsAdded: 1,
                    candidatesMarked: 1,
                    byFamily: [
                        { entity_family: "places", items_added: 1, marked_batched: 1, skipped_reasons: [] },
                    ],
                    timing: { resolve_ms: 0, eligibility_ms: 0, payload_ms: 0, transaction_ms: 0 },
                    totalSelected: 1,
                } as unknown as Awaited<
                    ReturnType<ImportReviewPromotionRepository["createPublishBatchMultiFamily"]>
                >;
            },
        });

        const service = createService(repo);
        service.getBatchById = async () =>
            ({
                id: "77",
                public_id: "pb_77",
                batch_name: "place-one",
                status: "draft",
                total_item_count: 1,
            }) as Awaited<ReturnType<ImportReviewPromotionService["getBatchById"]>>;

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                mode: "selected",
                families: ["places"],
                candidate_ids_by_family: { places: [23n] },
                filters: { review_decision: "approved", include_warnings: false },
                include_warnings: false,
                dry_run: false,
                batch_name: "place-one",
                include_merged: false,
                allow_high_risk_families: false,
                confirm_large_batch: false,
                mixed_high_risk_confirm: false,
            },
            testUser
        );

        if ("dry_run" in result && result.dry_run) {
            assert.fail("expected live create");
        } else {
            assert.equal(result.id, 77);
            assert.equal(typeof result.id, "number");
            assert.equal(result.public_id, "pb_77");
            assert.equal(result.review_batch_id, 2);
            assert.equal(result.mode, "selected");
            assert.equal(result.publish_batch_id, "77");
            assert.equal(result.batch_id, "77");
            assert.equal(result.total_items, 1);
            assert.equal(result.total_item_count, 1);
            assert.equal(result.count_by_family.places, 1);
            assert.equal(result.batch.total_item_count, 1);
        }
    });

    it("selected already promoted candidate returns already_promoted", async () => {
        let call = 0;
        const prisma = createMockPrismaForResolver({
            queryRaw: async (sql: unknown) => {
                call += 1;
                const text = queryRawSqlText(sql);
                if (call === 1) {
                    return [];
                }
                if (text.includes("review_batch_id") && text.includes("LIMIT 1") && !text.includes("promoted_core_id")) {
                    return [{ id: 59n, review_batch_id: 2n }];
                }
                if (text.includes("promoted_core_id")) {
                    return [
                        {
                            id: 59n,
                            review_batch_id: 2n,
                            review_status: "approved",
                            review_decision: "approved",
                            promotion_status: "promoted",
                            match_status: null,
                            auto_action: null,
                            review_note: null,
                            validation_errors: null,
                            validation_warnings: null,
                            promoted_core_id: 1001n,
                            promoted_at: new Date("2024-06-01T12:00:00.000Z"),
                        },
                    ];
                }
                if (text.includes("system_publish_items")) {
                    return [];
                }
                return [];
            },
        });
        const repo = createMockRepo(prisma, {
            createPublishBatchMultiFamily: async () => {
                throw new Error("should not create");
            },
        });
        const service = createService(repo);

        let caught: unknown;
        await assert.rejects(
            () =>
                service.createBatch(
                    {
                        review_batch_id: 2n,
                        mode: "selected",
                        families: ["places"],
                        candidate_ids_by_family: { places: [59n] },
                        filters: { review_decision: "approved", include_warnings: false },
                        include_warnings: false,
                        dry_run: false,
                        include_merged: false,
                        allow_high_risk_families: false,
                        confirm_large_batch: false,
                        mixed_high_risk_confirm: false,
                    },
                    testUser
                ),
            (e: unknown) => {
                caught = e;
                return (
                    e instanceof ImportReviewPromotionSelectedCandidateError &&
                    e.reason === "already_promoted"
                );
            }
        );
        assert.ok(caught instanceof ImportReviewPromotionSelectedCandidateError);
        assert.match(caught.message, /already promoted/);
        assert.equal(caught.details.promoted_core_id, "1001");
    });

    it("selected unapproved candidate returns not_approved", async () => {
        let call = 0;
        const prisma = createMockPrismaForResolver({
            queryRaw: async (sql: unknown) => {
                call += 1;
                const text = queryRawSqlText(sql);
                if (call === 1) {
                    return [];
                }
                if (text.includes("promoted_core_id")) {
                    return [
                        {
                            id: 59n,
                            review_batch_id: 2n,
                            review_status: "approved",
                            review_decision: "rejected",
                            promotion_status: "ready",
                            match_status: null,
                            auto_action: null,
                            review_note: null,
                            validation_errors: null,
                            validation_warnings: null,
                            promoted_core_id: null,
                            promoted_at: null,
                        },
                    ];
                }
                if (text.includes("LIMIT 1")) {
                    return [{ id: 59n, review_batch_id: 2n }];
                }
                if (text.includes("system_publish_items")) {
                    return [];
                }
                return [];
            },
        });
        const repo = createMockRepo(prisma);
        const service = createService(repo);

        await assert.rejects(
            () =>
                service.createBatch(
                    {
                        review_batch_id: 2n,
                        mode: "selected",
                        families: ["places"],
                        candidate_ids_by_family: { places: [59n] },
                        filters: { review_decision: "approved", include_warnings: false },
                        include_warnings: false,
                        dry_run: false,
                        include_merged: false,
                        allow_high_risk_families: false,
                        confirm_large_batch: false,
                        mixed_high_risk_confirm: false,
                    },
                    testUser
                ),
            (e: unknown) =>
                e instanceof ImportReviewPromotionSelectedCandidateError && e.reason === "not_approved"
        );
    });

    it("selected validation-blocked candidate returns validation_blocked", async () => {
        let call = 0;
        const prisma = createMockPrismaForResolver({
            queryRaw: async (sql: unknown) => {
                call += 1;
                const text = queryRawSqlText(sql);
                if (call === 1) {
                    return [];
                }
                if (text.includes("promoted_core_id")) {
                    return [
                        {
                            id: 59n,
                            review_batch_id: 2n,
                            review_status: "approved",
                            review_decision: "approved",
                            promotion_status: "ready",
                            match_status: null,
                            auto_action: null,
                            review_note: null,
                            validation_errors: [{ code: "invalid_value", field: "name_en", message: "Bad" }],
                            validation_warnings: null,
                            promoted_core_id: null,
                            promoted_at: null,
                        },
                    ];
                }
                if (text.includes("LIMIT 1")) {
                    return [{ id: 59n, review_batch_id: 2n }];
                }
                if (text.includes("system_publish_items")) {
                    return [];
                }
                return [];
            },
        });
        const repo = createMockRepo(prisma);
        const service = createService(repo);

        await assert.rejects(
            () =>
                service.createBatch(
                    {
                        review_batch_id: 2n,
                        mode: "selected",
                        families: ["places"],
                        candidate_ids_by_family: { places: [59n] },
                        filters: { review_decision: "approved", include_warnings: false },
                        include_warnings: false,
                        dry_run: false,
                        include_merged: false,
                        allow_high_risk_families: false,
                        confirm_large_batch: false,
                        mixed_high_risk_confirm: false,
                    },
                    testUser
                ),
            (e: unknown) =>
                e instanceof ImportReviewPromotionSelectedCandidateError &&
                e.reason === "validation_blocked"
        );
    });

    it("failed publish item does not block selected retry", async () => {
        const prisma = createMockPrismaForResolver({
            queryRaw: async (sql: unknown) => {
                const text = queryRawSqlText(sql);
                if (text.includes("system_publish_items")) {
                    return [];
                }
                if (text.includes("promoted_core_id") && text.includes("validation_errors")) {
                    return [];
                }
                return [{ id: 59n }];
            },
        });
        const repo = createMockRepo(prisma);
        const service = createService(repo);

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                mode: "selected",
                families: ["places"],
                candidate_ids_by_family: { places: [59n] },
                filters: { review_decision: "approved", include_warnings: false },
                include_warnings: false,
                dry_run: true,
                include_merged: false,
                allow_high_risk_families: false,
                confirm_large_batch: false,
                mixed_high_risk_confirm: false,
            },
            testUser
        );

        assert.equal(result.dry_run, true);
        assert.equal(result.can_create_batch, true);
        assert.equal(result.total_selected, 1);
    });

    it("selected retry after failed publish item creates one-item batch", async () => {
        let createCalled = false;
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [{ id: 59n }],
        });
        const repo = createMockRepo(prisma, {
            createPublishBatchMultiFamily: async (args) => {
                createCalled = true;
                assert.deepEqual(args.candidateIdsByFamily?.places, [59n]);
                return {
                    batch: { id: 201n, batch_name: "retry-batch", status: "draft" },
                    itemsAdded: 1,
                    candidatesMarked: 1,
                    byFamily: [
                        {
                            entity_family: "places",
                            items_added: 1,
                            marked_batched: 1,
                            skipped_reasons: [],
                        },
                    ],
                    timing: { resolve_ms: 0, eligibility_ms: 0, payload_ms: 0, transaction_ms: 0 },
                    totalSelected: 1,
                } as unknown as Awaited<
                    ReturnType<ImportReviewPromotionRepository["createPublishBatchMultiFamily"]>
                >;
            },
        });
        const service = createService(repo);
        service.getBatchById = async () =>
            ({
                id: "201",
                public_id: "pb_201",
                batch_name: "retry-batch",
                status: "draft",
                total_item_count: 1,
            }) as Awaited<ReturnType<ImportReviewPromotionService["getBatchById"]>>;

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                mode: "selected",
                families: ["places"],
                candidate_ids_by_family: { places: [59n] },
                filters: { review_decision: "approved", include_warnings: false },
                include_warnings: false,
                dry_run: false,
                include_merged: false,
                allow_high_risk_families: false,
                confirm_large_batch: false,
                mixed_high_risk_confirm: false,
            },
            testUser
        );

        assert.equal(createCalled, true);
        if ("dry_run" in result && result.dry_run) {
            assert.fail("expected live create");
        } else {
            assert.equal(result.id, 201);
            assert.equal(result.total_item_count, 1);
            assert.equal(result.count_by_family.places, 1);
        }
    });

    it("selected candidate in active publish batch is blocked", async () => {
        const prisma = createMockPrismaForResolver({
            queryRaw: async (sql: unknown) => {
                const text = queryRawSqlText(sql);
                if (text.includes("system_publish_items") && text.includes("publish_batch_id")) {
                    return [{ publish_batch_id: 88n }];
                }
                if (text.includes("promoted_core_id")) {
                    return [
                        {
                            id: 59n,
                            review_batch_id: 2n,
                            review_status: "approved",
                            review_decision: "approved",
                            promotion_status: "batched",
                            match_status: null,
                            auto_action: null,
                            review_note: null,
                            validation_errors: null,
                            validation_warnings: null,
                            promoted_core_id: null,
                            promoted_at: null,
                        },
                    ];
                }
                if (text.includes("LIMIT 1")) {
                    return [{ id: 59n, review_batch_id: 2n }];
                }
                return [];
            },
        });
        const repo = createMockRepo(prisma);
        const service = createService(repo);

        await assert.rejects(
            () =>
                service.createBatch(
                    {
                        review_batch_id: 2n,
                        mode: "selected",
                        families: ["places"],
                        candidate_ids_by_family: { places: [59n] },
                        filters: { review_decision: "approved", include_warnings: false },
                        include_warnings: false,
                        dry_run: false,
                        include_merged: false,
                        allow_high_risk_families: false,
                        confirm_large_batch: false,
                        mixed_high_risk_confirm: false,
                    },
                    testUser
                ),
            (e: unknown) =>
                e instanceof ImportReviewPromotionSelectedCandidateError &&
                e.reason === "already_in_active_publish_batch" &&
                e.details.active_publish_batch_id === "88"
        );
    });

    it("selected with invalid candidate id rejects with 400-class error and does not create batch", async () => {
        let createCalled = false;
        let call = 0;
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => {
                call += 1;
                if (call === 1) {
                    return [];
                }
                return [{ id: 23n, review_batch_id: 99n }];
            },
        });
        const repo = createMockRepo(prisma, {
            createPublishBatchMultiFamily: async () => {
                createCalled = true;
                throw new Error("should not create");
            },
        });
        const service = createService(repo);

        let caught: unknown;
        await assert.rejects(
            () =>
                service.createBatch(
                    {
                        review_batch_id: 2n,
                        mode: "selected",
                        families: ["places"],
                        candidate_ids_by_family: { places: [23n] },
                        filters: { review_decision: "approved", include_warnings: false },
                        include_warnings: false,
                        dry_run: false,
                        include_merged: false,
                        allow_high_risk_families: false,
                        confirm_large_batch: false,
                        mixed_high_risk_confirm: false,
                    },
                    testUser
                ),
            (e: unknown) => {
                caught = e;
                return e instanceof ImportReviewPromotionSelectedCandidateError;
            }
        );

        assert.equal(createCalled, false);
        assert.ok(caught instanceof ImportReviewPromotionSelectedCandidateError);
        assert.equal(Object.hasOwn(caught as object, "id"), false);
    });

    it("selected mode creates batch with explicit candidate ids", async () => {
        let capturedIds: Record<string, readonly bigint[]> | undefined;
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [{ id: 23n }, { id: 24n }],
        });
        const repo = createMockRepo(prisma, {
            createPublishBatchMultiFamily: async (args) => {
                capturedIds = args.candidateIdsByFamily;
                return {
                    batch: { id: 99n, batch_name: "selected-batch", status: "draft" },
                    itemsAdded: 2,
                    candidatesMarked: 2,
                    byFamily: [
                        { entity_family: "places", items_added: 2, marked_batched: 2, skipped_reasons: [] },
                    ],
                    timing: { resolve_ms: 0, eligibility_ms: 0, payload_ms: 0, transaction_ms: 0 },
                    totalSelected: 2,
                } as unknown as Awaited<
                    ReturnType<ImportReviewPromotionRepository["createPublishBatchMultiFamily"]>
                >;
            },
        });

        const service = createService(repo);
        service.getBatchById = async () =>
            ({
                id: "99",
                batch_name: "selected-batch",
                status: "draft",
            }) as Awaited<ReturnType<ImportReviewPromotionService["getBatchById"]>>;

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                mode: "selected",
                families: ["places"],
                candidate_ids_by_family: { places: [23n, 24n] },
                filters: { review_decision: "approved", include_warnings: false },
                include_warnings: false,
                dry_run: false,
                batch_name: "selected-batch",
                include_merged: false,
                allow_high_risk_families: false,
                confirm_large_batch: false,
                mixed_high_risk_confirm: false,
            },
            testUser
        );

        assert.equal("dry_run" in result && result.dry_run, false);
        if (!("dry_run" in result) || result.dry_run) {
            return;
        }
        assert.equal(result.mode, "selected");
        assert.equal(result.total_items, 2);
        assert.equal(result.count_by_family.places, 2);
        assert.deepEqual(capturedIds?.places, [23n, 24n]);
    });

    it("all_ready mode creates batch from eligible scope", async () => {
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [{ id: 23n }],
        });
        const repo = createMockRepo(prisma, {
            createPublishBatchMultiFamily: async (args) => {
                assert.equal(args.candidateIdsByFamily?.places?.length, 1);
                return {
                    batch: { id: 50n, batch_name: "ready-batch", status: "draft" },
                    itemsAdded: 1,
                    candidatesMarked: 1,
                    byFamily: [],
                    timing: { resolve_ms: 0, eligibility_ms: 0, payload_ms: 0, transaction_ms: 0 },
                    totalSelected: 1,
                } as unknown as Awaited<
                    ReturnType<ImportReviewPromotionRepository["createPublishBatchMultiFamily"]>
                >;
            },
        });

        const service = createService(repo);
        service.getBatchById = async () =>
            ({
                id: "50",
                batch_name: "ready-batch",
                status: "draft",
            }) as Awaited<ReturnType<ImportReviewPromotionService["getBatchById"]>>;

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                mode: "all_ready",
                families: ["places"],
                filters: { review_decision: "approved", include_warnings: false },
                include_warnings: false,
                dry_run: false,
                batch_name: "ready-batch",
                include_merged: false,
                allow_high_risk_families: false,
                confirm_large_batch: false,
                mixed_high_risk_confirm: false,
            },
            testUser
        );

        if ("dry_run" in result && result.dry_run) {
            assert.fail("expected live create");
        } else {
            assert.equal(result.id, 50);
            assert.equal(typeof result.id, "number");
            assert.equal(result.mode, "all_ready");
            assert.equal(result.review_batch_id, 2);
            assert.equal(result.total_items, 1);
            assert.equal(result.total_item_count, 1);
            assert.equal(result.count_by_family.places, 1);
        }
    });

    it("throws when live create resolves zero candidates", async () => {
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [],
        });
        const repo = createMockRepo(prisma);
        const service = createService(repo);

        await assert.rejects(
            () =>
                service.createBatch(
                    {
                        review_batch_id: 2n,
                        mode: "all_ready",
                        families: ["places"],
                        filters: { review_decision: "approved", include_warnings: false },
                        include_warnings: false,
                        dry_run: false,
                        batch_name: "empty",
                        include_merged: false,
                        allow_high_risk_families: false,
                confirm_large_batch: false,
                mixed_high_risk_confirm: false,
                    },
                    testUser
                ),
            (err: unknown) => err instanceof ImportReviewPromotionNoEligibleCandidatesError
        );
    });

    it("dry-run returns preview counts without creating batch", async () => {
        let createCalled = false;
        const prisma = createMockPrismaForResolver({
            queryRaw: async () => [{ id: 10n }],
        });
        const repo = createMockRepo(prisma, {
            createPublishBatchMultiFamily: async () => {
                createCalled = true;
                throw new Error("should not create");
            },
        });
        const service = createService(repo);

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                mode: "all_ready",
                families: ["buildings"],
                filters: { review_decision: "approved", include_warnings: false },
                include_warnings: false,
                dry_run: true,
                include_merged: false,
                allow_high_risk_families: false,
                confirm_large_batch: false,
                mixed_high_risk_confirm: false,
            },
            testUser
        );

        assert.equal(createCalled, false);
        assert.equal(result.dry_run, true);
        assert.equal(result.can_create_batch, true);
    });

    it("normalizeCandidateIdsByFamilyInput deduplicates ids", () => {
        const map = normalizeCandidateIdsByFamilyInput(["places"], {
            places: [24n, 23n, 24n, "23"],
        });
        assert.deepEqual(map.places, [23n, 24n]);
    });

    it("resolveCreateBatchFamilies uses simple registry targets", () => {
        const cfg = resolveCreateBatchFamilies(["buildings"], undefined);
        assert.equal(cfg[0]?.coreTargetTable, IMPORT_REVIEW_PROMOTION_TARGETS.buildings);
    });

    it("dry-run with no candidates sets can_create_batch false", () => {
        const response = buildCreateBatchDryRunResponse({
            reviewBatchId: 2n,
            batchName: "preview",
            familyConfigs: resolveCreateBatchFamilies(["buildings"], undefined),
            preview: {
                batchName: "preview",
                entityFamilies: ["buildings"],
                totals: { included: 0, excluded: 0, skipped: 0 },
                byFamily: [
                    {
                        entity_family: "buildings",
                        included: 0,
                        excluded: 0,
                        skipped: 0,
                        skipped_reasons: [],
                    },
                ],
            },
            countRows: [],
            includeWarnings: false,
            timing_ms: {
                resolve_ms: 0,
                eligibility_ms: 0,
                payload_ms: 0,
                transaction_ms: 0,
                total_ms: 0,
            },
            resolveMs: 0,
        });
        assert.equal(response.can_create_batch, false);
    });
});

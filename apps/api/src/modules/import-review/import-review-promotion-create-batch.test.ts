import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { JwtUser } from "../../plugins/auth.js";
import type { FamilyEligibilityCountDb } from "./import-review-promotion-eligibility.js";
import {
    buildCreateBatchDryRunResponse,
    resolveCreateBatchFamilies,
} from "./import-review-promotion-create-batch-api.js";
import { IMPORT_REVIEW_PROMOTION_TARGETS } from "./import-review-promotion-config.js";
import {
    ImportReviewPromotionNoEligibleCandidatesError,
    ImportReviewTransportPromotionDeprecatedError,
} from "./import-review-promotion.errors.js";
import { ImportReviewPromotionService } from "./import-review-promotion.service.js";
import type { ImportReviewPromotionRepository } from "./import-review-promotion.repo.js";
import type { ImportReviewPromotionValidationRepository } from "./import-review-promotion-validation.repo.js";
import type { ImportReviewPromotionPromoteRepository } from "./import-review-promotion-promote.repo.js";
import { postImportReviewPromotionBatchBodySchema } from "./import-review-promotion.schema.js";

function zeroCountRow(entityFamily: string): FamilyEligibilityCountDb {
    return {
        entity_family: entityFamily,
        table_name: `import_review.${entityFamily}_candidates`,
        approved_ready: 0n,
        with_warnings: 0n,
        blocked: 0n,
        already_promoted: 0n,
        excluded: 0n,
        has_validation_errors: 0n,
        manual_protected: 0n,
        duplicate_unconfirmed: 0n,
        rejected_decision: 0n,
    };
}

function readyCountRow(entityFamily: string, ready: number): FamilyEligibilityCountDb {
    return {
        ...zeroCountRow(entityFamily),
        approved_ready: BigInt(ready),
    };
}

function createMockRepo(overrides: Partial<ImportReviewPromotionRepository> = {}): ImportReviewPromotionRepository {
    return {
        resolveScope: async () => ({
            reviewBatchId: 2n,
            snapshotVersion: "snap-v1",
        }),
        dryRunPublishBatchMultiFamily: async () => ({
            batchName: "test-batch",
            entityFamilies: ["buildings"],
            totals: { included: 5, excluded: 0, skipped: 0 },
            byFamily: [
                {
                    entity_family: "buildings",
                    included: 5,
                    excluded: 0,
                    skipped: 0,
                    skipped_reasons: [],
                },
            ],
        }),
        countBatchEligibilityByFamilies: async () => [readyCountRow("buildings", 5)],
        createPublishBatchMultiFamily: async () => ({
            batch: {
                id: 99n,
                batch_name: "live-batch",
                status: "draft",
            },
            itemsAdded: 5,
            candidatesMarked: 5,
            byFamily: [
                {
                    entity_family: "buildings",
                    items_added: 5,
                    marked_batched: 5,
                    skipped_reasons: [],
                },
            ],
            timing: {
                resolve_ms: 1,
                eligibility_ms: 2,
                payload_ms: 3,
                transaction_ms: 4,
            },
            totalSelected: 5,
        }),
        ...overrides,
    } as unknown as ImportReviewPromotionRepository;
}

const testUser = { sub: "1", email: "test@example.com", roles: ["admin"] } as JwtUser;

function createService(repo: ImportReviewPromotionRepository): ImportReviewPromotionService {
    const validationRepo = {
        getPrismaClient: () => ({}),
    } as unknown as ImportReviewPromotionValidationRepository;
    return new ImportReviewPromotionService(
        repo,
        validationRepo,
        {} as ImportReviewPromotionPromoteRepository
    );
}

describe("import-review promotion create batch", () => {
    it("requires families in request schema", () => {
        const missing = postImportReviewPromotionBatchBodySchema.safeParse({
            review_batch_id: "2",
        });
        assert.equal(missing.success, false);

        const ok = postImportReviewPromotionBatchBodySchema.safeParse({
            review_batch_id: "2",
            families: ["buildings"],
            dry_run: true,
        });
        assert.equal(ok.success, true);
    });

    it("accepts legacy entity_families alias via preprocess", () => {
        const parsed = postImportReviewPromotionBatchBodySchema.safeParse({
            review_batch_id: "2",
            entity_families: ["buildings", "places"],
            dry_run: true,
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.deepEqual(parsed.data.families, ["buildings", "places"]);
        }
    });

    it("resolves buildings-only and routing_barriers target", () => {
        const buildings = resolveCreateBatchFamilies(["buildings"], undefined);
        assert.equal(buildings.length, 1);
        assert.equal(buildings[0]?.coreTargetTable, IMPORT_REVIEW_PROMOTION_TARGETS.buildings);

        const barriers = resolveCreateBatchFamilies(["routing_barriers"], undefined);
        assert.equal(barriers[0]?.coreTargetTable, "routing.routing_barriers");
    });

    it("resolves multi-family selection", () => {
        const configs = resolveCreateBatchFamilies(["buildings", "places"], undefined);
        assert.deepEqual(
            configs.map((c) => c.entityFamily),
            ["buildings", "places"]
        );
    });

    it("rejects bus family", () => {
        assert.throws(
            () => resolveCreateBatchFamilies(["bus_routes"], undefined),
            (err: unknown) => err instanceof ImportReviewTransportPromotionDeprecatedError
        );
    });

    it("dry-run does not create publish batch rows", async () => {
        let createCalled = false;
        let dryRunCalled = false;
        const repo = createMockRepo({
            dryRunPublishBatchMultiFamily: async () => {
                dryRunCalled = true;
                return {
                    batchName: "dry",
                    entityFamilies: ["buildings"],
                    totals: { included: 3, excluded: 0, skipped: 0 },
                    byFamily: [
                        {
                            entity_family: "buildings",
                            included: 3,
                            excluded: 0,
                            skipped: 0,
                            skipped_reasons: [],
                        },
                    ],
                };
            },
            createPublishBatchMultiFamily: async () => {
                createCalled = true;
                throw new Error("should not create on dry_run");
            },
        });
        const service = createService(repo);

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                families: ["buildings"],
                include_warnings: false,
                dry_run: true,
                include_merged: false,
                mode: "approved_only",
                allow_high_risk_families: false,
            },
            testUser
        );

        assert.equal(dryRunCalled, true);
        assert.equal(createCalled, false);
        assert.equal(result.dry_run, true);
        assert.equal(result.can_create_batch, true);
        assert.equal(result.families[0]?.target, IMPORT_REVIEW_PROMOTION_TARGETS.buildings);
    });

    it("dry-run with no ready candidates sets can_create_batch false", () => {
        const response = buildCreateBatchDryRunResponse({
            reviewBatchId: 2n,
            batchName: "preview",
            familyConfigs: resolveCreateBatchFamilies(["buildings"], undefined),
            preview: {
                batchName: "preview",
                entityFamilies: ["buildings"],
                totals: { included: 0, excluded: 1, skipped: 2 },
                byFamily: [
                    {
                        entity_family: "buildings",
                        included: 0,
                        excluded: 1,
                        skipped: 2,
                        skipped_reasons: [],
                    },
                ],
            },
            countRows: [zeroCountRow("buildings")],
            includeWarnings: false,
            timing_ms: {
                resolve_ms: 1,
                eligibility_ms: 2,
                payload_ms: 0,
                transaction_ms: 0,
                total_ms: 3,
            },
            resolveMs: 1,
        });

        assert.equal(response.can_create_batch, false);
        assert.match(response.message, /No eligible candidates/i);
    });

    it("creates multi-family batch when dry_run is false", async () => {
        let selectedFamilies: string[] = [];
        const repo = createMockRepo({
            countBatchEligibilityByFamilies: async () => [
                readyCountRow("buildings", 2),
                readyCountRow("places", 3),
            ],
            createPublishBatchMultiFamily: async (args) => {
                selectedFamilies = args.families.map((f) => f.entityFamily);
                return {
                    batch: { id: 42n, batch_name: "multi", status: "draft" },
                    itemsAdded: 5,
                    candidatesMarked: 5,
                    byFamily: [
                        {
                            entity_family: "buildings",
                            items_added: 2,
                            marked_batched: 2,
                            skipped_reasons: [],
                        },
                        {
                            entity_family: "places",
                            items_added: 3,
                            marked_batched: 3,
                            skipped_reasons: [],
                        },
                    ],
                    timing: {
                        resolve_ms: 0,
                        eligibility_ms: 0,
                        payload_ms: 0,
                        transaction_ms: 0,
                    },
                    totalSelected: 5,
                } as unknown as Awaited<
                    ReturnType<ImportReviewPromotionRepository["createPublishBatchMultiFamily"]>
                >;
            },
        });

        const service = createService(repo);
        service.getBatchById = async () =>
            ({
                id: "42",
                public_id: "pub-42",
                batch_name: "multi",
                status: "draft",
                source_review_batch_id: "2",
                source_snapshot_version: "snap-v1",
                region_code: null,
                total_item_count: 5,
                success_count: 0,
                failed_count: 0,
                skipped_count: 0,
                note: null,
                created_at: new Date().toISOString(),
                published_at: null,
                promoted_at: null,
                derived_status: "draft",
                derived_status_reason: null,
                stored_status_recommendation: null,
                status_note: null,
                item_counts: {
                    pending: 5,
                    success: 0,
                    failed: 0,
                    skipped: 0,
                    rolled_back: 0,
                    total: 5,
                },
                building_item_counts: {
                    pending: 2,
                    success: 0,
                    failed: 0,
                    skipped: 0,
                    rolled_back: 0,
                    total: 2,
                },
                item_counts_by_entity_family: {},
            }) as Awaited<ReturnType<ImportReviewPromotionService["getBatchById"]>>;

        const result = await service.createBatch(
            {
                review_batch_id: 2n,
                families: ["buildings", "places"],
                include_warnings: false,
                dry_run: false,
                batch_name: "multi-family-batch",
                include_merged: false,
                mode: "approved_only",
                allow_high_risk_families: false,
            },
            testUser
        );

        assert.equal(result.dry_run, undefined);
        assert.equal(result.publish_batch_id, "42");
        assert.deepEqual(result.families, ["buildings", "places"]);
        assert.deepEqual(selectedFamilies, ["buildings", "places"]);
    });

    it("throws when live create has no eligible candidates", async () => {
        const repo = createMockRepo({
            countBatchEligibilityByFamilies: async () => [zeroCountRow("buildings")],
            createPublishBatchMultiFamily: async () => {
                throw new ImportReviewPromotionNoEligibleCandidatesError(
                    0,
                    "No eligible candidates for publish batch creation. Review per-family skipped reasons.",
                    []
                );
            },
        });
        const service = createService(repo);

        await assert.rejects(
            () =>
                service.createBatch(
                    {
                        review_batch_id: 2n,
                        families: ["buildings"],
                        include_warnings: false,
                        dry_run: false,
                        batch_name: "empty-batch",
                        include_merged: false,
                        mode: "approved_only",
                        allow_high_risk_families: false,
                    },
                    testUser
                ),
            (err: unknown) => err instanceof ImportReviewPromotionNoEligibleCandidatesError
        );
    });

    it("include_warnings=false keeps warnings out of dry-run ready messaging", () => {
        const response = buildCreateBatchDryRunResponse({
            reviewBatchId: 2n,
            batchName: "preview",
            familyConfigs: resolveCreateBatchFamilies(["buildings"], undefined),
            preview: {
                batchName: "preview",
                entityFamilies: ["buildings"],
                totals: { included: 10, excluded: 0, skipped: 0 },
                byFamily: [
                    {
                        entity_family: "buildings",
                        included: 10,
                        excluded: 0,
                        skipped: 0,
                        skipped_reasons: [],
                    },
                ],
            },
            countRows: [readyCountRow("buildings", 10)],
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

        assert.equal(response.families[0]?.ready, 10);
        assert.equal(response.families[0]?.warnings, 0);
    });
});

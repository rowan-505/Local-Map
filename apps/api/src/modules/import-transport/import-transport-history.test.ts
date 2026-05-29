import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ImportTransportHistoryImportBatchNotFoundError,
    ImportTransportHistoryPromotionBatchNotFoundError,
} from "./import-transport-history.errors.js";
import type { ImportTransportHistoryRepository } from "./import-transport-history.repo.js";
import { ImportTransportHistoryService } from "./import-transport-history.service.js";

function mockRepo(overrides: Partial<ImportTransportHistoryRepository> = {}): ImportTransportHistoryRepository {
    return {
        listImportBatches: async () => ({ rows: [], total: 0n }),
        getImportBatchById: async () => null,
        listPromotionBatches: async () => ({ rows: [], total: 0n }),
        getPromotionBatchById: async () => null,
        listPromotionBatchItems: async () => ({ rows: [], total: 0n }),
        listPromotionBatchLogs: async () => [],
        fetchEntityCountsForBatch: async () => [],
        fetchValidationCounts: async () => ({
            issue_blocked_count: 0,
            issue_warning_count: 0,
            candidate_blocked_count: 0,
            candidate_warning_count: 0,
        }),
        fetchPromotionItemStatusCounts: async () => ({
            item_total: 0,
            promoted_count: 0,
            failed_count: 0,
            skipped_count: 0,
            validation_blocked_count: 0,
            validation_warning_count: 0,
        }),
        listPromotionBatchSummariesForImportBatch: async () => [],
        ...overrides,
    } as unknown as ImportTransportHistoryRepository;
}

describe("import-transport history service", () => {
    it("throws when import batch is missing", async () => {
        const service = new ImportTransportHistoryService(mockRepo());
        await assert.rejects(
            () => service.getImportBatchById(99n),
            (err: unknown) => err instanceof ImportTransportHistoryImportBatchNotFoundError
        );
    });

    it("throws when promotion batch is missing", async () => {
        const service = new ImportTransportHistoryService(mockRepo());
        await assert.rejects(
            () => service.getPromotionBatchById(99n),
            (err: unknown) => err instanceof ImportTransportHistoryPromotionBatchNotFoundError
        );
    });

    it("maps promotion counts from summary promotion_result", async () => {
        const service = new ImportTransportHistoryService(
            mockRepo({
                getPromotionBatchById: async () =>
                    ({
                        id: 1n,
                        public_id: "pb-1",
                        batch_name: "Batch",
                        import_batch_id: 2n,
                        import_batch_name: "Import",
                        import_status: "completed",
                        source_snapshot_version: "v1",
                        source_dataset_id: 3n,
                        dataset_code: "ybs",
                        dataset_name: "YBS",
                        dataset_transport_mode: "bus",
                        dataset_source_format: "gtfs",
                        dataset_provider_name: null,
                        dataset_region_code: "yangon",
                        promotion_status: "promoted",
                        validation_status: "validated",
                        can_promote: false,
                        target_schema: "core_transport",
                        item_counts: {},
                        summary: { mode: "all_entities", promotion_result: { promoted: 5, failed: 1, skipped: 2 } },
                        error_message: null,
                        created_at: new Date("2026-01-01T00:00:00Z"),
                        updated_at: new Date("2026-01-01T00:00:00Z"),
                        validated_at: null,
                        promoted_at: null,
                    }) as never,
            })
        );

        const detail = await service.getPromotionBatchById(1n);
        assert.equal(detail.promoted_count, 5);
        assert.equal(detail.failed_count, 1);
        assert.equal(detail.skipped_count, 2);
        assert.equal(detail.mode, "all_entities");
    });
});

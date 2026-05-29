import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ImportTransportPromotionRepository } from "./import-transport-promotion.repo.js";
import { ImportTransportPromotionService } from "./import-transport-promotion.service.js";
import { ImportTransportPromotionInvalidModeError } from "./import-transport-promotion.errors.js";
import type { ImportTransportPromotionPromoteService } from "./import-transport-promotion-promote.service.js";
import type { ImportTransportPromotionValidationService } from "./import-transport-promotion-validation.service.js";

function mockValidationService(): ImportTransportPromotionValidationService {
    return {
        validateBatch: async () => {
            throw new Error("not implemented in test");
        },
        getBatchProgress: async () => {
            throw new Error("not implemented in test");
        },
        getBatchLogs: async () => {
            throw new Error("not implemented in test");
        },
    } as unknown as ImportTransportPromotionValidationService;
}

function mockPromoteService(): ImportTransportPromotionPromoteService {
    return {
        promoteBatch: async () => {
            throw new Error("not implemented in test");
        },
    } as unknown as ImportTransportPromotionPromoteService;
}

describe("import-transport promotion service", () => {
    it("requires entity_family for one_entity mode", async () => {
        const repo = {
            importBatchExists: async () => true,
        } as unknown as ImportTransportPromotionRepository;
        const service = new ImportTransportPromotionService(
            repo,
            mockValidationService(),
            mockPromoteService()
        );

        await assert.rejects(
            () =>
                service.createBatch({
                    import_batch_id: 1n,
                    mode: "one_entity",
                    entity_family: null,
                    include_warnings: false,
                }),
            (err: unknown) => err instanceof ImportTransportPromotionInvalidModeError
        );
    });

    it("resolves all entity families for all_entities mode", () => {
        const repo = new ImportTransportPromotionRepository({} as never);
        assert.deepEqual(repo.familiesForMode("all_entities", null), [
            "routes",
            "stops",
            "variants",
            "route_stops",
        ]);
        assert.deepEqual(repo.familiesForMode("all_entities", "routes"), [
            "routes",
            "stops",
            "variants",
            "route_stops",
        ]);
    });

    it("resolves single family for one_entity mode", () => {
        const repo = new ImportTransportPromotionRepository({} as never);
        assert.deepEqual(repo.familiesForMode("one_entity", "stops"), ["stops"]);
    });
});

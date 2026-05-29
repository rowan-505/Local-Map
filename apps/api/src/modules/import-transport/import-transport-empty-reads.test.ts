import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    emptyImportTransportCandidatesList,
    emptyImportTransportPromotionReady,
    emptyImportTransportSummary,
} from "./import-transport-empty-reads.js";
import { ImportTransportRepository } from "./import-transport.repo.js";
import { ImportTransportService } from "./import-transport.service.js";
import { ImportTransportPromotionRepository } from "./import-transport-promotion.repo.js";
import { ImportTransportPromotionService } from "./import-transport-promotion.service.js";
import type { ImportTransportPromotionPromoteService } from "./import-transport-promotion-promote.service.js";
import type { ImportTransportPromotionValidationService } from "./import-transport-promotion-validation.service.js";

describe("import-transport empty read responses", () => {
    it("builds zeroed summary payload", () => {
        const summary = emptyImportTransportSummary({ import_batch_id: 2n });
        assert.equal(summary.import_batch_id, "2");
        assert.equal(summary.families.length, 4);
        assert.equal(summary.rollup.total_candidates, 0);
    });

    it("builds empty candidate list payload", () => {
        const list = emptyImportTransportCandidatesList({ import_batch_id: 2n });
        assert.deepEqual(list.items, []);
        assert.equal(list.total, 0);
        assert.equal(list.import_batch_id, "2");
    });

    it("builds zeroed promotion ready payload", () => {
        const ready = emptyImportTransportPromotionReady(2n, false);
        assert.equal(ready.import_batch_id, "2");
        assert.equal(ready.totals.ready, 0);
        assert.equal(ready.by_family.length, 4);
    });

    it("returns empty summary when scope cannot be resolved", async () => {
        const repo = {
            tryResolveScope: async () => null,
        } as unknown as ImportTransportRepository;
        const service = new ImportTransportService(repo);
        const summary = await service.getSummary({ import_batch_id: 99n });
        assert.equal(summary.import_batch_id, "99");
        assert.equal(summary.families.every((f) => f.total === 0), true);
    });

    it("returns empty candidate list when scope cannot be resolved", async () => {
        const repo = {
            tryResolveScope: async () => null,
        } as unknown as ImportTransportRepository;
        const service = new ImportTransportService(repo);
        const list = await service.listCandidates("routes", {
            import_batch_id: 99n,
            limit: 50,
            offset: 0,
        });
        assert.deepEqual(list.items, []);
        assert.equal(list.total, 0);
    });

    it("returns zero promotion ready counts when import batch is missing", async () => {
        const repo = {
            importBatchExists: async () => false,
            familiesForMode: () => ["routes", "stops", "variants", "route_stops"] as const,
        } as unknown as ImportTransportPromotionRepository;
        const service = new ImportTransportPromotionService(
            repo,
            {} as ImportTransportPromotionValidationService,
            {} as ImportTransportPromotionPromoteService
        );
        const ready = await service.getReadyCounts(2n, false);
        assert.equal(ready.import_batch_id, "2");
        assert.equal(ready.totals.ready, 0);
    });
});

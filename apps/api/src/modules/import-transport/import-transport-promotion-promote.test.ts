import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
    assertBatchReadyForPromotion,
    countItemValidationStatuses,
} from "./import-transport-promotion-promote-guards.js";
import { ImportTransportPromotionPromoteService } from "./import-transport-promotion-promote.service.js";
import { ImportTransportPromotionBatchNotValidatedError } from "./import-transport-promotion.errors.js";
import { ImportTransportPromotionBlockedError } from "./import-transport-promotion-eligibility.js";
import { ImportTransportPromotionWarningConfirmationRequiredError } from "./import-transport-promotion-eligibility.js";
import { ImportTransportValidationWarningNoteRequiredError } from "./import-transport.errors.js";
import { stagesForBatchMode } from "./import-transport-promotion-validation.types.js";
import { IMPORT_TRANSPORT_PROMOTION_EXECUTION_STAGES } from "./import-transport-promotion-promote.types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function baseBatch(overrides: Record<string, unknown> = {}) {
    return {
        id: "1",
        import_batch_id: "10",
        promotion_status: "ready",
        validation_status: "passed",
        can_promote: true,
        validation_total: 2,
        validation_done: 2,
        validation_percent: 100,
        validated_at: new Date().toISOString(),
        summary: { mode: "one_entity", entity_family: "stops" },
        ...overrides,
    };
}

describe("import-transport promotion promote guards", () => {
    it("blocks promotion when batch is not validated", () => {
        assert.throws(
            () =>
                assertBatchReadyForPromotion({
                    batch: baseBatch({ validated_at: null, can_promote: false }),
                    items: [{ item_validation_status: "valid", promotion_status: "pending" }],
                    confirm_warnings: false,
                }),
            (err: unknown) => err instanceof ImportTransportPromotionBatchNotValidatedError
        );
    });

    it("blocks promotion when any item is blocked", () => {
        assert.throws(
            () =>
                assertBatchReadyForPromotion({
                    batch: baseBatch(),
                    items: [
                        { item_validation_status: "valid", promotion_status: "pending" },
                        { item_validation_status: "blocked", promotion_status: "pending" },
                    ],
                    confirm_warnings: false,
                }),
            (err: unknown) => err instanceof ImportTransportPromotionBlockedError
        );
    });

    it("requires warning confirmation and review note", () => {
        assert.throws(
            () =>
                assertBatchReadyForPromotion({
                    batch: baseBatch(),
                    items: [{ item_validation_status: "warning", promotion_status: "pending" }],
                    confirm_warnings: false,
                }),
            (err: unknown) => err instanceof ImportTransportPromotionWarningConfirmationRequiredError
        );

        assert.throws(
            () =>
                assertBatchReadyForPromotion({
                    batch: baseBatch(),
                    items: [{ item_validation_status: "warning", promotion_status: "pending" }],
                    confirm_warnings: true,
                    review_note: "  ",
                }),
            (err: unknown) => err instanceof ImportTransportValidationWarningNoteRequiredError
        );

        assert.doesNotThrow(() =>
            assertBatchReadyForPromotion({
                batch: baseBatch(),
                items: [{ item_validation_status: "warning", promotion_status: "pending" }],
                confirm_warnings: true,
                review_note: "Reviewed warnings manually.",
            })
        );
    });
});

describe("import-transport promotion execution order", () => {
    it("promotes all_entities in dependency order", () => {
        assert.deepEqual(stagesForBatchMode({ mode: "all_entities" }), [
            "routes",
            "stops",
            "variants",
            "route_stops",
        ]);
        assert.deepEqual(
            IMPORT_TRANSPORT_PROMOTION_EXECUTION_STAGES.map((stage) => stage.family),
            ["routes", "stops", "variants", "route_stops"]
        );
    });

    it("promotes routes only for one_entity routes batch", () => {
        assert.deepEqual(stagesForBatchMode({ mode: "one_entity", entity_family: "routes" }), [
            "routes",
        ]);
    });

    it("promotes stops only for one_entity stops batch", () => {
        assert.deepEqual(stagesForBatchMode({ mode: "one_entity", entity_family: "stops" }), [
            "stops",
        ]);
    });
});

describe("import-transport promotion promote service orchestration", () => {
    it("calls entity promoters in stage order for all_entities", async () => {
        const calls: string[] = [];
        const promoteRepo = {
            listPromotableItems: async (_batchId: bigint, entityKind: string) => {
                calls.push(`list:${entityKind}`);
                if (entityKind === "route") {
                    return [{ id: 1n, entity_kind: "route", raw_entity_id: 11n, item_validation_status: "valid", promotion_status: "pending", promoted_target_id: null }];
                }
                if (entityKind === "stop") {
                    return [{ id: 2n, entity_kind: "stop", raw_entity_id: 22n, item_validation_status: "valid", promotion_status: "pending", promoted_target_id: null }];
                }
                return [];
            },
            claimBatchForPromotion: async () => true,
            finalizeBatchPromotion: async () => {},
            promoteRouteItem: async () => {
                calls.push("promote:route");
                return { promotion_item_id: "1", entity_kind: "route", raw_entity_id: "11", outcome: "promoted", promoted_target_id: "101", error_message: null };
            },
            promoteStopItem: async () => {
                calls.push("promote:stop");
                return { promotion_item_id: "2", entity_kind: "stop", raw_entity_id: "22", outcome: "promoted", promoted_target_id: "202", error_message: null };
            },
            promoteVariantItem: async () => {
                calls.push("promote:variant");
                return { promotion_item_id: "3", entity_kind: "route_variant", raw_entity_id: "33", outcome: "promoted", promoted_target_id: "303", error_message: null };
            },
            promoteRouteStopItem: async () => {
                calls.push("promote:route_stop");
                return { promotion_item_id: "4", entity_kind: "route_stop", raw_entity_id: "44", outcome: "promoted", promoted_target_id: "404", error_message: null };
            },
        };
        const validationRepo = {
            fetchBatchProgress: async () =>
                baseBatch({ summary: { mode: "all_entities" } }),
            listAllBatchItems: async () => [
                { item_validation_status: "valid", promotion_status: "pending" },
                { item_validation_status: "valid", promotion_status: "pending" },
            ],
            summarizeByEntity: async () => [],
        };

        const service = new ImportTransportPromotionPromoteService(
            promoteRepo as never,
            validationRepo as never
        );

        const result = await service.promoteBatch(1n, { confirm_warnings: false });
        assert.equal(result.promoted, 2);
        assert.deepEqual(calls, [
            "list:route",
            "promote:route",
            "list:stop",
            "promote:stop",
            "list:route_variant",
            "list:route_stop",
        ]);
    });

    it("does not mark raw candidate promoted when simulated core insert fails", async () => {
        const state = {
            rawPromoted: false,
            itemStatus: "pending",
        };
        const promoteRepo = {
            listPromotableItems: async () => [
                {
                    id: 9n,
                    entity_kind: "stop",
                    raw_entity_id: 99n,
                    item_validation_status: "valid",
                    promotion_status: "pending",
                    promoted_target_id: null,
                },
            ],
            claimBatchForPromotion: async () => true,
            finalizeBatchPromotion: async () => {},
            promoteStopItem: async () => {
                state.itemStatus = "failed";
                return {
                    promotion_item_id: "9",
                    entity_kind: "stop",
                    raw_entity_id: "99",
                    outcome: "failed",
                    promoted_target_id: null,
                    error_message: "Stop promotion failed: missing or invalid geometry.",
                };
            },
            promoteRouteItem: async () => {
                throw new Error("not used");
            },
            promoteVariantItem: async () => {
                throw new Error("not used");
            },
            promoteRouteStopItem: async () => {
                throw new Error("not used");
            },
        };
        const validationRepo = {
            fetchBatchProgress: async () =>
                baseBatch({ summary: { mode: "one_entity", entity_family: "stops" } }),
            listAllBatchItems: async () => [
                { item_validation_status: "valid", promotion_status: "pending" },
            ],
            summarizeByEntity: async () => [],
        };

        const service = new ImportTransportPromotionPromoteService(
            promoteRepo as never,
            validationRepo as never
        );
        const result = await service.promoteBatch(1n, { confirm_warnings: false });
        assert.equal(result.failed, 1);
        assert.equal(state.rawPromoted, false);
        assert.equal(state.itemStatus, "failed");
        assert.match(result.items[0]?.error_message ?? "", /geometry/i);
    });
});

describe("import-transport promotion SQL targets core_transport only", () => {
    it("does not reference deprecated core.core_bus_* tables in promote repo", () => {
        const source = readFileSync(
            join(moduleDir, "import-transport-promotion-promote.repo.ts"),
            "utf8"
        );
        assert.doesNotMatch(source, /core\.core_bus_/);
        assert.match(source, /core_transport\./);
    });
});

describe("import-transport promotion item status counts", () => {
    it("counts blocked and warning items for gate checks", () => {
        const counts = countItemValidationStatuses([
            { item_validation_status: "valid", promotion_status: "pending" },
            { item_validation_status: "warning", promotion_status: "pending" },
            { item_validation_status: "blocked", promotion_status: "pending" },
            { item_validation_status: "skipped", promotion_status: "pending" },
        ]);
        assert.equal(counts.blocked, 1);
        assert.equal(counts.warning, 1);
        assert.equal(counts.promotable, 2);
    });
});

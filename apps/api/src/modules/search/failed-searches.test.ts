import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    FailedSearchesError,
    FailedSearchesService,
} from "./failed-searches.service.js";

function makeRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 7n,
        query: "RGN airport",
        normalized_query: "rgn airport",
        lang: "en",
        category: "places",
        transport_type: "all",
        transport_mode: "all",
        entity_types_key: "place",
        types: ["place"],
        area_context_key: "16.8,96.2",
        result_count: 0,
        occurrence_count: 12,
        first_seen_at: new Date("2026-07-01T00:00:00.000Z"),
        last_seen_at: new Date("2026-07-10T00:00:00.000Z"),
        resolved_at: null,
        resolution_type: null,
        linked_alias_id: null,
        linked_alias_text: null,
        linked_entity_type: null,
        linked_entity_id: null,
        linked_entity_display_name: null,
        linked_entity_public_id: null,
        ...overrides,
    };
}

describe("FailedSearchesService", () => {
    it("serializes list rows with resolved state and linked alias", async () => {
        class MockRepo {
            async list() {
                return {
                    items: [
                        makeRow({
                            resolved_at: new Date("2026-07-11T00:00:00.000Z"),
                            resolution_type: "alias",
                            linked_alias_id: 99n,
                            linked_alias_text: "RGN",
                            linked_entity_type: "place",
                            linked_entity_id: 101n,
                            linked_entity_display_name: "Yangon International Airport",
                            linked_entity_public_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                        }),
                    ],
                    total: 1,
                };
            }
        }

        const service = new FailedSearchesService(new MockRepo() as never);
        const result = await service.list({
            page: 1,
            pageSize: 25,
            sort: "occurrence_count",
            order: "desc",
        });

        assert.equal(result.items[0]?.is_resolved, true);
        assert.equal(result.items[0]?.linked_alias?.alias_text, "RGN");
        assert.equal(result.items[0]?.linked_entity?.entity_id, "101");
    });

    it("requires linked_alias_id when resolving as alias", async () => {
        class MockRepo {
            async findById() {
                return makeRow();
            }
        }

        const service = new FailedSearchesService(new MockRepo() as never);
        await assert.rejects(
            () =>
                service.update("7", {
                    action: "resolve",
                    resolution_type: "alias",
                }),
            (error: unknown) => {
                assert.ok(error instanceof FailedSearchesError);
                assert.equal(error.statusCode, 400);
                return true;
            },
        );
    });

    it("rejects reopen when another unresolved duplicate exists", async () => {
        class MockRepo {
            async findById() {
                return makeRow({
                    resolved_at: new Date("2026-07-11T00:00:00.000Z"),
                    resolution_type: "ignored",
                });
            }
            async getDedupeKey() {
                return "rgn airport|en|places|all|all|place|16.8,96.2";
            }
            async findOpenByDedupeKey() {
                return 42n;
            }
        }

        const service = new FailedSearchesService(new MockRepo() as never);
        await assert.rejects(
            () => service.update("7", { action: "reopen" }),
            (error: unknown) => {
                assert.ok(error instanceof FailedSearchesError);
                assert.equal(error.statusCode, 409);
                return true;
            },
        );
    });

    it("resolves with alias after validation", async () => {
        class MockRepo {
            private resolved = false;
            async findById() {
                if (!this.resolved) {
                    return makeRow();
                }
                return makeRow({
                    resolved_at: new Date("2026-07-11T00:00:00.000Z"),
                    resolution_type: "alias",
                    linked_alias_id: 99n,
                    linked_alias_text: "RGN",
                });
            }
            async aliasExists() {
                return true;
            }
            async resolve() {
                this.resolved = true;
                return makeRow({
                    resolved_at: new Date("2026-07-11T00:00:00.000Z"),
                    resolution_type: "alias",
                    linked_alias_id: 99n,
                    linked_alias_text: "RGN",
                });
            }
        }

        const service = new FailedSearchesService(new MockRepo() as never);
        const result = await service.update("7", {
            action: "resolve",
            resolution_type: "alias",
            linked_alias_id: "99",
        });

        assert.equal(result.resolution_type, "alias");
        assert.equal(result.linked_alias?.id, "99");
    });
});

describe("failed-searches schema", () => {
    it("accepts resolve and reopen payloads", async () => {
        const { updateFailedSearchBodySchema } = await import("./failed-searches.schema.js");

        assert.equal(
            updateFailedSearchBodySchema.safeParse({
                action: "resolve",
                resolution_type: "ignored",
            }).success,
            true,
        );
        assert.equal(
            updateFailedSearchBodySchema.safeParse({ action: "reopen" }).success,
            true,
        );
    });
});

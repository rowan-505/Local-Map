import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { EntityAdminAreaRepository } from "./entity-admin-area.repo.js";

const outsideEnvelopeLineGeoJson = JSON.stringify({
    type: "LineString",
    coordinates: [
        [96.3347661, 16.6354093],
        [96.3347608, 16.6351382],
        [96.3347546, 16.6348298],
    ],
});

function templateSqlText(strings: TemplateStringsArray): string {
    return strings.join("?");
}

function createQueryCapturingPrisma(
    handlers: Array<(sql: string) => unknown[] | Promise<unknown[]>>,
): PrismaClient {
    let callIndex = 0;

    return {
        $queryRaw: async (strings: TemplateStringsArray) => {
            const sql = templateSqlText(strings);
            const handler = handlers[callIndex];
            callIndex += 1;
            if (!handler) {
                throw new Error(`Unexpected query #${callIndex}: ${sql.slice(0, 120)}`);
            }
            return handler(sql);
        },
    } as unknown as PrismaClient;
}

describe("EntityAdminAreaRepository.recommendRoadTownshipFromGeoJson SQL aliases", () => {
    it("returns outside_all_townships when road is outside township envelopes (not query_error)", async () => {
        const repo = new EntityAdminAreaRepository(
            createQueryCapturingPrisma([
                () => [
                    {
                        valid: true,
                        road_length_m: 64,
                        has_global_townships: true,
                        has_envelope_coverage: false,
                    },
                ],
                () => [],
            ]),
        );

        const result = await repo.recommendRoadTownshipFromGeoJson(outsideEnvelopeLineGeoJson);

        assert.equal(result.debugReason, "outside_all_townships");
        assert.notEqual(result.debugReason, "query_error");
        assert.equal(result.recommended, null);
    });

    it("returns outside_all_townships after overlap miss and fallback nearest miss", async () => {
        const repo = new EntityAdminAreaRepository(
            createQueryCapturingPrisma([
                () => [
                    {
                        valid: true,
                        road_length_m: 120,
                        has_global_townships: true,
                        has_envelope_coverage: true,
                    },
                ],
                () => [],
                () => [],
                () => [],
            ]),
        );

        const result = await repo.recommendRoadTownshipFromGeoJson(outsideEnvelopeLineGeoJson);

        assert.equal(result.debugReason, "outside_all_townships");
        assert.notEqual(result.debugReason, "query_error");
        assert.equal(result.recommended, null);
    });
});

describe("EntityAdminAreaService.infer roads district admin", () => {
    it("returns no_match with outside_all_townships for district current admin area", async () => {
        const { EntityAdminAreaService } = await import("./entity-admin-area.service.js");
        const { emptyRoadTownshipRecommendation } = await import(
            "./entity-admin-area.road-township-recommend.js"
        );
        const { resetEntityAdminAreaInferCacheForTests } = await import(
            "./entity-admin-area.infer-cache.js"
        );

        resetEntityAdminAreaInferCacheForTests();

        const service = new EntityAdminAreaService({
            recommendRoadTownshipFromGeoJson: async () =>
                emptyRoadTownshipRecommendation("outside_all_townships", {
                    road_length_m: 100,
                    nearest_unfiltered_distance_m: 2500,
                }),
            getAdminAreaSummaryAnyStatus: async (id) =>
                id === 7005n
                    ? {
                          id: 7005n,
                          canonical_name: "North District",
                          admin_level_code: "district",
                          admin_level_name: "District",
                          is_active: true,
                          deleted_at: null,
                      }
                    : null,
        } as unknown as EntityAdminAreaRepository);

        const result = await service.infer({
            kind: "street",
            geometry: {
                type: "LineString",
                coordinates: [
                    [96.33, 16.63],
                    [96.34, 16.64],
                ],
            },
            current_admin_area_id: "7005",
        });

        assert.equal(result.status, "no_match");
        assert.equal(result.debugReason, "outside_all_townships");
        assert.notEqual(result.debugReason, "query_error");
        assert.equal(result.currentAdminArea?.level_code, "district");
    });
});

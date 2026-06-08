import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { assertRoadTownshipAdminArea, StreetAdminAreaValidationError } from "./street-admin-area.js";

function mockRepo(overrides: Partial<EntityAdminAreaRepository>): EntityAdminAreaRepository {
    return {
        getActiveAdminAreaSummary: async () => null,
        isTownshipAdminArea: async () => false,
        inferAdminAreaIdForPoint: async () => null,
        inferAdminAreaIdForLineGeoJson: async () => null,
        inferTownshipAdminAreaForRoadGeoJson: async () => null,
        inferAdminAreaIdForPolygonGeoJson: async () => null,
        geometryMatchesTownshipAdminArea: async () => false,
        ...overrides,
    } as EntityAdminAreaRepository;
}

describe("assertRoadTownshipAdminArea", () => {
    it("allows null and undefined", async () => {
        const repo = mockRepo({});
        await assertRoadTownshipAdminArea(repo, null);
        await assertRoadTownshipAdminArea(repo, undefined);
    });

    it("allows active township admin areas", async () => {
        const repo = mockRepo({
            getActiveAdminAreaSummary: async () => ({
                id: 42n,
                canonical_name: "Kyauktan",
                admin_level_code: "township",
                admin_level_name: "Township",
            }),
            isTownshipAdminArea: async () => true,
        });

        await assertRoadTownshipAdminArea(repo, 42n);
    });

    it("rejects ward-level admin_area_id with a clear message", async () => {
        const repo = mockRepo({
            getActiveAdminAreaSummary: async () => ({
                id: 7n,
                canonical_name: "Ward 1",
                admin_level_code: "ward",
                admin_level_name: "Ward",
            }),
            isTownshipAdminArea: async () => false,
        });

        await assert.rejects(
            () => assertRoadTownshipAdminArea(repo, 7n),
            (error: unknown) => {
                assert.ok(error instanceof StreetAdminAreaValidationError);
                assert.match(error.message, /ward-level/);
                return true;
            },
        );
    });

    it("rejects invalid or inactive admin_area_id", async () => {
        const repo = mockRepo({
            getActiveAdminAreaSummary: async () => null,
        });

        await assert.rejects(
            () => assertRoadTownshipAdminArea(repo, 999n),
            (error: unknown) => {
                assert.ok(error instanceof StreetAdminAreaValidationError);
                assert.match(error.message, /invalid or inactive/);
                return true;
            },
        );
    });
});

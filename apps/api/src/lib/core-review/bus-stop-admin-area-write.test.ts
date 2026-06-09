import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../../modules/entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../../modules/entity-admin-area/entity-admin-area.service.js";
import {
    applyBusStopAdminAreaForCreate,
    applyBusStopAdminAreaForUpdate,
} from "./bus-stop-admin-area-write.js";

const TOWNSHIP_ID = 42n;
const WARD_ID = 8n;
const INFERRED_ID = 99n;

const pointGeometry = {
    type: "Point" as const,
    coordinates: [96.1, 16.8],
};

const testUser = { sub: "u1", email: "u@test", roles: ["admin"] as string[] };

function makeEntityAdminAreaRepo(): EntityAdminAreaRepository {
    return {
        isTownshipAdminArea: async (id: bigint | null) => id === TOWNSHIP_ID,
        getActiveAdminAreaSummary: async (id: bigint) => {
            if (id === TOWNSHIP_ID) {
                return {
                    id: TOWNSHIP_ID,
                    canonical_name: "Kyauktan",
                    admin_level_code: "township",
                    admin_level_name: "Township",
                };
            }
            if (id === WARD_ID) {
                return {
                    id: WARD_ID,
                    canonical_name: "Ward 1",
                    admin_level_code: "ward_village_tract",
                    admin_level_name: "Ward Or Village Tract",
                };
            }
            return null;
        },
        inferAdminAreaIdForPoint: async () => INFERRED_ID,
        geometryMatchesTownshipAdminArea: async () => true,
    } as unknown as EntityAdminAreaRepository;
}

function makeService() {
    return new EntityAdminAreaService(makeEntityAdminAreaRepo());
}

describe("applyBusStopAdminAreaForUpdate", () => {
    it("preserves existing township when admin_area_id is omitted", async () => {
        const body: Record<string, unknown> = { name: "Updated" };
        await applyBusStopAdminAreaForUpdate(
            makeService(),
            body,
            pointGeometry,
            TOWNSHIP_ID,
            testUser,
        );
        assert.equal("admin_area_id" in body, false);
    });

    it("clears legacy non-township when admin_area_id is omitted", async () => {
        const body: Record<string, unknown> = { name: "Updated" };
        await applyBusStopAdminAreaForUpdate(
            makeService(),
            body,
            pointGeometry,
            WARD_ID,
            testUser,
        );
        assert.equal(body.admin_area_id, null);
    });

    it("rejects non-township explicit admin_area_id", async () => {
        const body: Record<string, unknown> = { admin_area_id: WARD_ID };
        await assert.rejects(
            () =>
                applyBusStopAdminAreaForUpdate(
                    makeService(),
                    body,
                    pointGeometry,
                    null,
                    testUser,
                ),
            /township/,
        );
    });

    it("clears admin_area_id only when explicitClearAdminArea is true", async () => {
        const body: Record<string, unknown> = {
            admin_area_id: null,
            explicitClearAdminArea: true,
        };
        await applyBusStopAdminAreaForUpdate(
            makeService(),
            body,
            pointGeometry,
            TOWNSHIP_ID,
            testUser,
        );
        assert.equal(body.admin_area_id, null);
    });
});

describe("applyBusStopAdminAreaForCreate", () => {
    it("infers township when admin_area_id is omitted", async () => {
        const body: Record<string, unknown> = {};
        await applyBusStopAdminAreaForCreate(makeService(), body, pointGeometry, testUser);
        assert.equal(body.admin_area_id, INFERRED_ID);
    });
});

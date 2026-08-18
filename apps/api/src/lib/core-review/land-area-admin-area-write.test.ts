import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../../modules/entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../../modules/entity-admin-area/entity-admin-area.service.js";
import {
    applyLandAreaAdminAreaForCreate,
    applyLandAreaAdminAreaForUpdate,
} from "./land-area-admin-area-write.js";

const TOWNSHIP_ID = 42n;
const WARD_ID = 8n;
const INFERRED_ID = 99n;

const polygonGeometry = {
    type: "Polygon" as const,
    coordinates: [
        [
            [96.1, 16.8],
            [96.2, 16.8],
            [96.2, 16.9],
            [96.1, 16.9],
            [96.1, 16.8],
        ],
    ],
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
        inferAdminAreaIdForPolygonGeoJson: async () => INFERRED_ID,
        geometryMatchesTownshipAdminArea: async () => true,
    } as unknown as EntityAdminAreaRepository;
}

function makeService() {
    return new EntityAdminAreaService(makeEntityAdminAreaRepo());
}

describe("applyLandAreaAdminAreaForUpdate", () => {
    it("preserves existing township when admin_area_id is omitted", async () => {
        const body: Record<string, unknown> = { name_en: "Updated" };
        await applyLandAreaAdminAreaForUpdate(
            makeService(),
            body,
            polygonGeometry,
            TOWNSHIP_ID,
            testUser,
        );
        assert.equal("admin_area_id" in body, false);
    });

    it("clears legacy non-township when admin_area_id is omitted", async () => {
        const body: Record<string, unknown> = { name_en: "Updated" };
        await applyLandAreaAdminAreaForUpdate(
            makeService(),
            body,
            polygonGeometry,
            WARD_ID,
            testUser,
        );
        assert.equal(body.admin_area_id, null);
    });

    it("preserves null when existing admin_area_id is null and field is omitted", async () => {
        const body: Record<string, unknown> = { name_en: "Updated" };
        await applyLandAreaAdminAreaForUpdate(
            makeService(),
            body,
            polygonGeometry,
            null,
            testUser,
        );
        assert.equal("admin_area_id" in body, false);
    });

    it("rejects non-township explicit admin_area_id", async () => {
        const body: Record<string, unknown> = { admin_area_id: WARD_ID };
        await assert.rejects(
            () =>
                applyLandAreaAdminAreaForUpdate(
                    makeService(),
                    body,
                    polygonGeometry,
                    null,
                    testUser,
                ),
            /township/,
        );
    });

    it("accepts explicit township admin_area_id", async () => {
        const body: Record<string, unknown> = { admin_area_id: TOWNSHIP_ID };
        await applyLandAreaAdminAreaForUpdate(
            makeService(),
            body,
            polygonGeometry,
            null,
            testUser,
        );
        assert.equal(body.admin_area_id, TOWNSHIP_ID);
    });

    it("preserves admin_area_id when null is sent without explicitClearAdminArea", async () => {
        const body: Record<string, unknown> = { admin_area_id: null };
        await applyLandAreaAdminAreaForUpdate(
            makeService(),
            body,
            polygonGeometry,
            TOWNSHIP_ID,
            testUser,
        );
        assert.equal("admin_area_id" in body, false);
    });

    it("clears admin_area_id only when explicitClearAdminArea is true", async () => {
        const body: Record<string, unknown> = {
            admin_area_id: null,
            explicitClearAdminArea: true,
        };
        await applyLandAreaAdminAreaForUpdate(
            makeService(),
            body,
            polygonGeometry,
            TOWNSHIP_ID,
            testUser,
        );
        assert.equal(body.admin_area_id, null);
    });
});

describe("applyLandAreaAdminAreaForCreate", () => {
    it("infers township when admin_area_id is omitted", async () => {
        const body: Record<string, unknown> = {};
        await applyLandAreaAdminAreaForCreate(makeService(), body, polygonGeometry, testUser);
        assert.equal(body.admin_area_id, INFERRED_ID);
    });

    it("does not set admin_area_id when omitted and inference returns null", async () => {
        const repo = {
            ...makeEntityAdminAreaRepo(),
            inferAdminAreaIdForPolygonGeoJson: async () => null,
        } as unknown as EntityAdminAreaRepository;
        const body: Record<string, unknown> = {};
        await applyLandAreaAdminAreaForCreate(
            new EntityAdminAreaService(repo),
            body,
            polygonGeometry,
            testUser,
        );
        assert.equal("admin_area_id" in body, false);
    });
});

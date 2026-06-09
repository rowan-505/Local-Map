import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "./entity-admin-area.repo.js";
import {
    assertActiveTownshipAdminArea,
    resolveTownshipAdminAreaWhenOmitted,
    TOWNSHIP_ADMIN_AREA_MUST_BE_TOWNSHIP_CODE,
} from "./entity-admin-area-update.js";
import { EntityAdminAreaValidationError } from "./entity-admin-area.errors.js";

const TOWNSHIP_ID = 42n;
const WARD_ID = 8n;
const DISTRICT_ID = 12n;

function makeRepo(): EntityAdminAreaRepository {
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
            if (id === DISTRICT_ID) {
                return {
                    id: DISTRICT_ID,
                    canonical_name: "Yangon District",
                    admin_level_code: "district",
                    admin_level_name: "District",
                };
            }
            return null;
        },
    } as unknown as EntityAdminAreaRepository;
}

describe("resolveTownshipAdminAreaWhenOmitted", () => {
    it("returns undefined when existing is null", async () => {
        const result = await resolveTownshipAdminAreaWhenOmitted(makeRepo(), null);
        assert.equal(result.admin_area_id, undefined);
    });

    it("returns undefined when existing is township", async () => {
        const result = await resolveTownshipAdminAreaWhenOmitted(makeRepo(), TOWNSHIP_ID);
        assert.equal(result.admin_area_id, undefined);
    });

    it("returns null when existing is non-township legacy", async () => {
        const result = await resolveTownshipAdminAreaWhenOmitted(makeRepo(), DISTRICT_ID);
        assert.equal(result.admin_area_id, null);
    });
});

describe("assertActiveTownshipAdminArea", () => {
    it("accepts active township", async () => {
        await assertActiveTownshipAdminArea(makeRepo(), TOWNSHIP_ID);
    });

    it("rejects non-township with ADMIN_AREA_MUST_BE_TOWNSHIP", async () => {
        await assert.rejects(
            () => assertActiveTownshipAdminArea(makeRepo(), WARD_ID, "adminAreaId"),
            (error: unknown) => {
                assert.ok(error instanceof EntityAdminAreaValidationError);
                assert.equal(error.issues[0]?.code, TOWNSHIP_ADMIN_AREA_MUST_BE_TOWNSHIP_CODE);
                assert.match(error.message, /ward_village_tract/);
                return true;
            },
        );
    });
});

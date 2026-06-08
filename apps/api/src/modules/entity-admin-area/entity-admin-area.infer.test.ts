import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isRoadEntityAdminAreaKind,
    normalizeEntityAdminAreaKind,
} from "./entity-admin-area-kind.js";
import { EntityAdminAreaService } from "./entity-admin-area.service.js";
import type { EntityAdminAreaRepository } from "./entity-admin-area.repo.js";

describe("normalizeEntityAdminAreaKind", () => {
    it("maps road to street", () => {
        assert.equal(normalizeEntityAdminAreaKind("road"), "street");
    });

    it("preserves place, street, and building", () => {
        assert.equal(normalizeEntityAdminAreaKind("place"), "place");
        assert.equal(normalizeEntityAdminAreaKind("street"), "street");
        assert.equal(normalizeEntityAdminAreaKind("building"), "building");
    });
});

describe("isRoadEntityAdminAreaKind", () => {
    it("is true only for street", () => {
        assert.equal(isRoadEntityAdminAreaKind("street"), true);
        assert.equal(isRoadEntityAdminAreaKind("place"), false);
        assert.equal(isRoadEntityAdminAreaKind("building"), false);
    });
});

describe("EntityAdminAreaService.infer roads", () => {
    it("returns null fields when no township matches", async () => {
        const repo = {
            inferTownshipAdminAreaForRoadGeoJson: async () => null,
        } as unknown as EntityAdminAreaRepository;
        const service = new EntityAdminAreaService(repo);

        const result = await service.infer({
            kind: "street",
            geometry: {
                type: "LineString",
                coordinates: [
                    [96.1, 16.8],
                    [96.2, 16.9],
                ],
            },
        });

        assert.equal(result.admin_area_id, null);
        assert.equal(result.canonical_name, null);
        assert.equal(result.name_mm, null);
        assert.equal(result.geometry_contains, false);
    });

    it("returns township names for road matches", async () => {
        const repo = {
            inferTownshipAdminAreaForRoadGeoJson: async () => ({
                id: 42n,
                canonical_name: "Kyauktan",
                admin_level_code: "township",
                name_mm: "ကျောက်တန်း",
                name_en: "Kyauktan",
                geometry_intersects: true,
            }),
        } as unknown as EntityAdminAreaRepository;
        const service = new EntityAdminAreaService(repo);

        const result = await service.infer({
            kind: "street",
            geometry: {
                type: "MultiLineString",
                coordinates: [
                    [
                        [96.1, 16.8],
                        [96.2, 16.9],
                    ],
                ],
            },
        });

        assert.equal(result.admin_area_id, "42");
        assert.equal(result.canonical_name, "Kyauktan");
        assert.equal(result.name_mm, "ကျောက်တန်း");
        assert.equal(result.name_en, "Kyauktan");
        assert.equal(result.admin_level_code, "township");
        assert.equal(result.geometry_contains, true);
    });
});

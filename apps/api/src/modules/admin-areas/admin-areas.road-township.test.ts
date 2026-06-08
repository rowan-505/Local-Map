import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { roadTownshipAdminAreaOptionsQuerySchema } from "./admin-areas.schema.js";
import { AdminAreasService } from "./admin-areas.service.js";
import type { AdminAreasRepository } from "./admin-areas.repo.js";

describe("roadTownshipAdminAreaOptionsQuerySchema", () => {
    it("requires q and caps limit at 50", () => {
        const parsed = roadTownshipAdminAreaOptionsQuerySchema.parse({ q: "Kyauktan" });
        assert.equal(parsed.q, "Kyauktan");
        assert.equal(parsed.limit, 50);

        assert.throws(() =>
            roadTownshipAdminAreaOptionsQuerySchema.parse({ q: "x", limit: 51 })
        );
    });
});

describe("AdminAreasService.searchRoadTownshipAdminAreaOptions", () => {
    it("maps repository rows to string ids", async () => {
        const repo = {
            searchRoadTownshipAdminAreaOptions: async () => [
                {
                    id: 7n,
                    canonical_name: "Kyauktan",
                    name_mm: "ကျောက်တန်း",
                    name_en: "Kyauktan",
                    admin_level_id: 3n,
                    admin_level_code: "township",
                    admin_level_name: "Township",
                    parent_id: 2n,
                    parent_label: "Yangon",
                    boundary_status: "official",
                    address_usage: "official",
                },
            ],
        } as unknown as AdminAreasRepository;
        const service = new AdminAreasService(repo);

        const rows = await service.searchRoadTownshipAdminAreaOptions({ q: "Kyauktan", limit: 50 });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.id, "7");
        assert.equal(rows[0]?.name_mm, "ကျောက်တန်း");
        assert.equal(rows[0]?.parent_label, "Yangon");
    });
});

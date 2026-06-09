import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";
import type { StreetsRepository } from "./streets.repo.js";
import { ROAD_ADMIN_AREA_MUST_BE_TOWNSHIP_CODE } from "./street-admin-area.js";
import { StreetsService, StreetValidationError } from "./streets.service.js";

const geometry = {
    type: "LineString" as const,
    coordinates: [
        [96.1, 16.8],
        [96.2, 16.9],
    ] as [number, number][],
};

const TOWNSHIP_ID = 42n;
const WARD_ID = 8n;
const DISTRICT_ID = 12n;

function makeService(args: {
    existingAdminAreaId: string | null;
    inferAdminAreaId: string | null;
    onUpdate?: (input: { admin_area_id?: bigint | null }) => void;
}) {
    const streetsRepo = {
        getStreetByPublicId: async () => ({
            public_id: "road-1",
            admin_area_id: args.existingAdminAreaId,
            geometry,
            deleted_at: null,
        }),
        updateStreet: async (_id: string, input: { admin_area_id?: bigint | null }) => {
            args.onUpdate?.(input);
            return {
                public_id: "road-1",
                canonical_name: "Test Road",
                admin_area_id:
                    input.admin_area_id !== undefined
                        ? input.admin_area_id?.toString() ?? null
                        : args.existingAdminAreaId,
                admin_area_name: "Township",
                source_type_id: "1",
                road_class_id: "1",
                road_class: "residential",
                road_class_name: "Residential",
                surface: null,
                is_oneway: false,
                bridge: false,
                tunnel: false,
                manual_override: true,
                edit_status: "edited",
                routing_status: "needs_rebuild",
                deleted_at: null,
                last_edited_at: null,
                is_active: true,
                verification_status: "unverified",
                created_at: null,
                updated_at: null,
                geometry,
                names: [],
                myanmar_name: null,
                english_name: null,
            };
        },
    } as unknown as StreetsRepository;

    const entityAdminAreaRepo = {
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
        inferTownshipAdminAreaForRoadGeoJson: async () =>
            args.inferAdminAreaId
                ? {
                      id: BigInt(args.inferAdminAreaId),
                      canonical_name: "Inferred",
                      admin_level_code: "township",
                      name_mm: null,
                      name_en: null,
                      geometry_intersects: true,
                  }
                : null,
        inferAdminAreaIdForLineGeoJson: async () =>
            args.inferAdminAreaId ? BigInt(args.inferAdminAreaId) : null,
        geometryMatchesTownshipAdminArea: async () => true,
    } as unknown as EntityAdminAreaRepository;

    const entityAdminArea = new EntityAdminAreaService(entityAdminAreaRepo);

    return new StreetsService(streetsRepo, entityAdminArea, entityAdminAreaRepo);
}

describe("StreetsService.updateStreet admin_area_id", () => {
    it("clears existing district when admin_area_id is omitted", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: String(DISTRICT_ID),
            inferAdminAreaId: null,
            onUpdate: (input) => {
                capturedAdmin = input.admin_area_id;
            },
        });

        await service.updateStreet(
            "road-1",
            {
                geometry,
                myanmarName: "Road",
            },
            { sub: "u1", email: "u@test", roles: ["admin"] },
        );

        assert.equal(capturedAdmin, null);
    });

    it("clears existing ward_village_tract when admin_area_id is omitted", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: String(WARD_ID),
            inferAdminAreaId: null,
            onUpdate: (input) => {
                capturedAdmin = input.admin_area_id;
            },
        });

        await service.updateStreet(
            "road-1",
            {
                geometry,
                myanmarName: "Road",
            },
            { sub: "u1", email: "u@test", roles: ["admin"] },
        );

        assert.equal(capturedAdmin, null);
    });

    it("preserves existing township when admin_area_id is omitted", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: String(TOWNSHIP_ID),
            inferAdminAreaId: "99",
            onUpdate: (input) => {
                capturedAdmin = input.admin_area_id;
            },
        });

        await service.updateStreet(
            "road-1",
            {
                geometry,
                myanmarName: "Road",
            },
            { sub: "u1", email: "u@test", roles: ["admin"] },
        );

        assert.equal(capturedAdmin, undefined);
    });

    it("keeps null when existing admin_area_id is null and field is omitted", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: null,
            inferAdminAreaId: null,
            onUpdate: (input) => {
                capturedAdmin = input.admin_area_id;
            },
        });

        await service.updateStreet(
            "road-1",
            {
                geometry,
                myanmarName: "Road",
            },
            { sub: "u1", email: "u@test", roles: ["admin"] },
        );

        assert.equal(capturedAdmin, undefined);
    });

    it("preserves existing township when infer returns null and manual override is disabled", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: String(TOWNSHIP_ID),
            inferAdminAreaId: null,
            onUpdate: (input) => {
                capturedAdmin = input.admin_area_id;
            },
        });

        await service.updateStreet(
            "road-1",
            {
                geometry,
                myanmarName: "Road",
            },
            { sub: "u1", email: "u@test", roles: ["admin"] },
        );

        assert.equal(capturedAdmin, undefined);
    });

    it("preserves admin_area_id when null is sent without explicitClearAdminArea", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: String(TOWNSHIP_ID),
            inferAdminAreaId: null,
            onUpdate: (input) => {
                capturedAdmin = input.admin_area_id;
            },
        });

        await service.updateStreet(
            "road-1",
            {
                geometry,
                admin_area_manual_override: true,
                admin_area_id: null,
                myanmarName: "Road",
            },
            { sub: "u1", email: "u@test", roles: ["admin"] },
        );

        assert.equal(capturedAdmin, undefined);
    });

    it("clears admin_area_id only when explicitClearAdminArea is true", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: String(TOWNSHIP_ID),
            inferAdminAreaId: null,
            onUpdate: (input) => {
                capturedAdmin = input.admin_area_id;
            },
        });

        await service.updateStreet(
            "road-1",
            {
                geometry,
                admin_area_manual_override: true,
                admin_area_id: null,
                explicitClearAdminArea: true,
                myanmarName: "Road",
            },
            { sub: "u1", email: "u@test", roles: ["admin"] },
        );

        assert.equal(capturedAdmin, null);
    });

    it("persists applied township when manual override sends township id", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: null,
            inferAdminAreaId: "99",
            onUpdate: (input) => {
                capturedAdmin = input.admin_area_id;
            },
        });

        await service.updateStreet(
            "road-1",
            {
                geometry,
                admin_area_manual_override: true,
                admin_area_id: TOWNSHIP_ID,
                myanmarName: "Road",
            },
            { sub: "u1", email: "u@test", roles: ["admin"] },
        );

        assert.equal(capturedAdmin, TOWNSHIP_ID);
    });

    it("rejects non-township admin_area_id with ROAD_ADMIN_AREA_MUST_BE_TOWNSHIP", async () => {
        const service = makeService({
            existingAdminAreaId: String(TOWNSHIP_ID),
            inferAdminAreaId: null,
        });

        await assert.rejects(
            () =>
                service.updateStreet(
                    "road-1",
                    {
                        geometry,
                        admin_area_id: WARD_ID,
                        myanmarName: "Road",
                    },
                    { sub: "u1", email: "u@test", roles: ["admin"] },
                ),
            (error: unknown) => {
                assert.ok(error instanceof StreetValidationError);
                assert.equal(error.code, ROAD_ADMIN_AREA_MUST_BE_TOWNSHIP_CODE);
                assert.match(error.message, /ward_village_tract/);
                return true;
            },
        );
    });
});

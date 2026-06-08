import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";
import type { StreetsRepository } from "./streets.repo.js";
import { StreetsService } from "./streets.service.js";

const geometry = {
    type: "LineString" as const,
    coordinates: [
        [96.1, 16.8],
        [96.2, 16.9],
    ] as [number, number][],
};

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
        isTownshipAdminArea: async (id: bigint | null) => id === null || id === 42n,
        getActiveAdminAreaSummary: async (id: bigint) =>
            id === 42n
                ? {
                      id: 42n,
                      canonical_name: "Kyauktan",
                      admin_level_code: "township",
                      admin_level_name: "Township",
                  }
                : null,
        geometryMatchesTownshipAdminArea: async () => true,
    } as unknown as EntityAdminAreaRepository;

    const entityAdminArea = new EntityAdminAreaService({
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
    } as unknown as EntityAdminAreaRepository);

    return new StreetsService(streetsRepo, entityAdminArea, entityAdminAreaRepo);
}

describe("StreetsService.updateStreet admin_area_id", () => {
    it("preserves existing township when infer returns null and manual override is disabled", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: "42",
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

    it("clears admin_area_id only when manual override requests empty selection", async () => {
        let capturedAdmin: bigint | null | undefined;
        const service = makeService({
            existingAdminAreaId: "42",
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

        assert.equal(capturedAdmin, null);
    });
});

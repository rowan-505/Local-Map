import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EntityAdminAreaRepository } from "../entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";
import type { PlacesRepository } from "./places.repo.js";
import { PlaceValidationError, PlacesService } from "./places.service.js";

const TOWNSHIP_ID = 42n;
const WARD_ID = 8n;
const DISTRICT_ID = 12n;

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
        inferAdminAreaIdForPoint: async () => 99n,
        geometryMatchesTownshipAdminArea: async () => true,
    } as unknown as EntityAdminAreaRepository;
}

function makePlaceDetail(adminAreaId: bigint | null) {
    return {
        id: 1n,
        public_id: "place-1",
        primary_name: "Test Place",
        display_name: "Test Place",
        category_id: 1n,
        category_name: "Food",
        admin_area_id: adminAreaId,
        admin_area_name: null,
        lat: 16.8,
        lng: 96.1,
        importance_score: 0,
        popularity_score: 0,
        confidence_score: 50,
        is_public: true,
        verification_status: "unverified",
        is_verified: false,
        source_type_id: 1n,
        publish_status_id: null,
        plus_code: null,
        created_at: new Date(),
        updated_at: new Date(),
        myanmar_name: null,
        english_name: "Test",
    };
}

function makePlacesService(args: {
    existingAdminAreaId: bigint | null;
    onUpdate?: (input: { admin_area_id?: bigint | null }) => void;
}) {
    const entityAdminArea = new EntityAdminAreaService(makeEntityAdminAreaRepo());
    const placesRepo = {
        getPlaceDetailByPublicId: async () => makePlaceDetail(args.existingAdminAreaId),
        hasCategory: async () => true,
        updatePlace: async (_id: string, input: { admin_area_id?: bigint | null }) => {
            args.onUpdate?.(input);
            return makePlaceDetail(
                input.admin_area_id !== undefined
                    ? input.admin_area_id
                    : args.existingAdminAreaId,
            );
        },
    } as unknown as PlacesRepository;

    return new PlacesService(placesRepo, entityAdminArea);
}

describe("PlacesService.updatePlace admin_area_id", () => {
    it("preserves existing township when adminAreaId is omitted", async () => {
        let captured: bigint | null | undefined;
        const service = makePlacesService({
            existingAdminAreaId: TOWNSHIP_ID,
            onUpdate: (input) => {
                captured = input.admin_area_id;
            },
        });

        await service.updatePlace("place-1", { englishName: "Updated" }, testUser);
        assert.equal(captured, undefined);
    });

    it("preserves null when existing admin_area_id is null and field is omitted", async () => {
        let captured: bigint | null | undefined;
        const service = makePlacesService({
            existingAdminAreaId: null,
            onUpdate: (input) => {
                captured = input.admin_area_id;
            },
        });

        await service.updatePlace("place-1", { englishName: "Updated" }, testUser);
        assert.equal(captured, undefined);
    });

    it("clears legacy district when adminAreaId is omitted", async () => {
        let captured: bigint | null | undefined;
        const service = makePlacesService({
            existingAdminAreaId: DISTRICT_ID,
            onUpdate: (input) => {
                captured = input.admin_area_id;
            },
        });

        await service.updatePlace("place-1", { englishName: "Updated" }, testUser);
        assert.equal(captured, null);
    });

    it("persists provided township adminAreaId", async () => {
        let captured: bigint | null | undefined;
        const service = makePlacesService({
            existingAdminAreaId: null,
            onUpdate: (input) => {
                captured = input.admin_area_id;
            },
        });

        await service.updatePlace(
            "place-1",
            { adminAreaId: TOWNSHIP_ID, englishName: "Updated" },
            testUser,
        );
        assert.equal(captured, TOWNSHIP_ID);
    });

    it("preserves admin_area_id when null is sent without explicitClearAdminArea", async () => {
        let captured: bigint | null | undefined;
        const service = makePlacesService({
            existingAdminAreaId: TOWNSHIP_ID,
            onUpdate: (input) => {
                captured = input.admin_area_id;
            },
        });

        await service.updatePlace("place-1", { adminAreaId: null, englishName: "Updated" }, testUser);
        assert.equal(captured, undefined);
    });

    it("clears admin_area_id only when explicitClearAdminArea is true", async () => {
        let captured: bigint | null | undefined;
        const service = makePlacesService({
            existingAdminAreaId: TOWNSHIP_ID,
            onUpdate: (input) => {
                captured = input.admin_area_id;
            },
        });

        await service.updatePlace(
            "place-1",
            { adminAreaId: null, explicitClearAdminArea: true, englishName: "Updated" },
            testUser,
        );
        assert.equal(captured, null);
    });

    it("preserves legacy district when null is sent without explicitClearAdminArea", async () => {
        let captured: bigint | null | undefined;
        const service = makePlacesService({
            existingAdminAreaId: DISTRICT_ID,
            onUpdate: (input) => {
                captured = input.admin_area_id;
            },
        });

        await service.updatePlace("place-1", { adminAreaId: null, englishName: "Updated" }, testUser);
        assert.equal(captured, undefined);
    });

    it("clears legacy district when explicitClearAdminArea is true", async () => {
        let captured: bigint | null | undefined;
        const service = makePlacesService({
            existingAdminAreaId: DISTRICT_ID,
            onUpdate: (input) => {
                captured = input.admin_area_id;
            },
        });

        await service.updatePlace(
            "place-1",
            { adminAreaId: null, explicitClearAdminArea: true, englishName: "Updated" },
            testUser,
        );
        assert.equal(captured, null);
    });

    it("rejects provided non-township adminAreaId", async () => {
        const service = makePlacesService({ existingAdminAreaId: TOWNSHIP_ID });

        await assert.rejects(
            () =>
                service.updatePlace(
                    "place-1",
                    { adminAreaId: WARD_ID, englishName: "Updated" },
                    testUser,
                ),
            (error: unknown) => {
                assert.ok(error instanceof PlaceValidationError);
                assert.match(error.message, /ward_village_tract/);
                return true;
            },
        );
    });

});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    coreReviewPatchPlaceSchema,
    normalizeWriteBodyAliases,
} from "./core-review-write.schema.js";
import { mapCoreReviewPlacePatch } from "./core-review-write.mappers.js";
import { updatePlaceBodySchema } from "../places/places.schema.js";
import {
    PlaceValidationError,
    PlacesService,
} from "../places/places.service.js";
import { placeCategoryValidationError } from "../places/places-category-validation.js";
import type { PlacesRepository } from "../places/places.repo.js";
import type { EntityAdminAreaService } from "../entity-admin-area/entity-admin-area.service.js";

const testUser = { sub: "1", email: "test@example.com", roles: ["admin"] as string[] };

const mockEntityAdminArea = {
    resolveForWrite: async () => ({ admin_area_id: null, manual_override: false }),
    resolveTownshipAdminAreaForOmittedUpdate: async () => ({ admin_area_id: undefined }),
} as unknown as EntityAdminAreaService;

describe("core review place category write", () => {
    it("accepts categoryId as numeric string and maps to bigint for places service", () => {
        const normalized = normalizeWriteBodyAliases({ categoryId: "12" });
        const parsed = coreReviewPatchPlaceSchema.parse(normalized);
        const mapped = mapCoreReviewPlacePatch(parsed as Record<string, unknown>);
        const body = updatePlaceBodySchema.parse(mapped);
        assert.equal(body.categoryId, 12n);
    });

    it("accepts category_id snake_case alias on patch", () => {
        const normalized = normalizeWriteBodyAliases({ category_id: "8" });
        const parsed = coreReviewPatchPlaceSchema.parse(normalized);
        const mapped = mapCoreReviewPlacePatch(parsed as Record<string, unknown>);
        const body = updatePlaceBodySchema.parse(mapped);
        assert.equal(body.categoryId, 8n);
    });

    it("rejects non-numeric categoryId at core-review schema with 400-style issue", () => {
        const normalized = normalizeWriteBodyAliases({ categoryId: "religion" });
        const parsed = coreReviewPatchPlaceSchema.safeParse(normalized);
        assert.equal(parsed.success, false);
    });

    it("valid category_id updates place when ref row exists", async () => {
        let writtenCategory: bigint | undefined;
        const repo = {
            hasCategory: async (id: bigint) => id === 5n,
            getPlaceDetailByPublicId: async () => ({
                lat: 16.8,
                lng: 96.1,
            }),
            updatePlace: async (_publicId: string, input: { category_id?: bigint }) => {
                writtenCategory = input.category_id;
                return {
                    id: 1n,
                    public_id: "00000000-0000-0000-0000-000000000001",
                    primary_name: "Test",
                    display_name: "Test",
                    category_id: 5n,
                    admin_area_id: null,
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
                    category_name: "Food",
                    admin_area_name: null,
                    names: [],
                };
            },
        } as unknown as PlacesRepository;

        const service = new PlacesService(repo, mockEntityAdminArea);
        const result = await service.updatePlace(
            "00000000-0000-0000-0000-000000000001",
            { categoryId: 5n },
            testUser
        );
        assert.equal(writtenCategory, 5n);
        assert.equal(result.category_id, "5");
    });

    it("invalid category_id throws validation error referencing ref.ref_poi_categories", async () => {
        const repo = {
            hasCategory: async () => false,
            updatePlace: async () => {
                throw new Error("updatePlace should not run");
            },
        } as unknown as PlacesRepository;

        const service = new PlacesService(repo, mockEntityAdminArea);
        await assert.rejects(
            () =>
                service.updatePlace(
                    "00000000-0000-0000-0000-000000000001",
                    { categoryId: 999_999n },
                    testUser
                ),
            (err: unknown) => {
                assert.ok(err instanceof PlaceValidationError);
                assert.match(err.message, /ref\.ref_poi_categories/);
                assert.match(err.message, /id=999999/);
                return true;
            }
        );
    });

    it("null category_id is rejected on update", async () => {
        const repo = {
            hasCategory: async () => true,
            updatePlace: async () => {
                throw new Error("updatePlace should not run");
            },
        } as unknown as PlacesRepository;

        const service = new PlacesService(repo, mockEntityAdminArea);
        await assert.rejects(
            () =>
                service.updatePlace(
                    "00000000-0000-0000-0000-000000000001",
                    { categoryId: null as unknown as bigint },
                    testUser
                ),
            (err: unknown) => {
                assert.ok(err instanceof PlaceValidationError);
                assert.match(err.message, /cannot be null/i);
                return true;
            }
        );
    });

    it("placeCategoryValidationError message is stable for API mapping", () => {
        assert.equal(
            placeCategoryValidationError(42n),
            "category_id does not exist in ref.ref_poi_categories (id=42)"
        );
    });
});

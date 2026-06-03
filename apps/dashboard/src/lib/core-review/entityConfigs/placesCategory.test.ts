import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPoiCategoryDropdownOptions } from "../../poi-category/display.js";
import { PLACES_ENTITY_CONFIG } from "./places.js";

describe("core review places category payload", () => {
    it("save payload includes numeric categoryId not category code", () => {
        const payload = PLACES_ENTITY_CONFIG.formValuesToUpdatePayload({
            myanmarName: "မြန်မာ",
            englishName: "Temple",
            categoryId: "12",
            adminAreaId: "",
            plusCode: "",
            importanceScore: 0,
            popularityScore: 0,
            confidenceScore: 50,
            isPublic: true,
            verification_status: "unverified",
            sourceTypeId: "1",
            publishStatusId: "",
            point_geom: { type: "Point", coordinates: [96.1, 16.8] },
        });
        assert.equal(payload.categoryId, "12");
        assert.equal(typeof payload.categoryId, "string");
        assert.equal(/^\d+$/.test(payload.categoryId ?? ""), true);
    });

    it("changing category updates payload categoryId", () => {
        const before = PLACES_ENTITY_CONFIG.formValuesToUpdatePayload({
            myanmarName: "A",
            englishName: "B",
            categoryId: "1",
            adminAreaId: "",
            plusCode: "",
            importanceScore: 0,
            popularityScore: 0,
            confidenceScore: 50,
            isPublic: true,
            verification_status: "unverified",
            sourceTypeId: "1",
            publishStatusId: "",
            point_geom: { type: "Point", coordinates: [96.1, 16.8] },
        });
        const after = PLACES_ENTITY_CONFIG.formValuesToUpdatePayload({
            myanmarName: "A",
            englishName: "B",
            categoryId: "2",
            adminAreaId: "",
            plusCode: "",
            importanceScore: 0,
            popularityScore: 0,
            confidenceScore: 50,
            isPublic: true,
            verification_status: "unverified",
            sourceTypeId: "1",
            publishStatusId: "",
            point_geom: { type: "Point", coordinates: [96.1, 16.8] },
        });
        assert.equal(before.categoryId, "1");
        assert.equal(after.categoryId, "2");
    });

    it("rejects category code strings in save payload builder", () => {
        assert.throws(
            () =>
                PLACES_ENTITY_CONFIG.formValuesToUpdatePayload({
                    myanmarName: "A",
                    englishName: "B",
                    categoryId: "religion",
                    adminAreaId: "",
                    plusCode: "",
                    importanceScore: 0,
                    popularityScore: 0,
                    confidenceScore: 50,
                    isPublic: true,
                    verification_status: "unverified",
                    sourceTypeId: "1",
                    publishStatusId: "",
                    point_geom: { type: "Point", coordinates: [96.1, 16.8] },
                }),
            /numeric id required/i
        );
    });

    it("buildPoiCategoryDropdownOptions uses category id as option value", () => {
        const options = buildPoiCategoryDropdownOptions([
            { id: "42", code: "hotel", name: "Hotel", name_mm: null, parent_id: null },
            { id: "43", code: "cafe", name: "Cafe", name_mm: null, parent_id: "43" },
        ]);
        assert.deepEqual(
            options.map((option) => option.value),
            ["42", "43"]
        );
        assert.equal(new Set(options.map((option) => option.value)).size, options.length);
    });

    it("detailToFormValues maps category_id to categoryId for the form", () => {
        const values = PLACES_ENTITY_CONFIG.detailToFormValues({
            category_id: "7",
            myanmarName: "",
            englishName: "Place",
            admin_area_id: null,
            plus_code: null,
            importance_score: 0,
            popularity_score: 0,
            confidence_score: 50,
            is_public: true,
            verification_status: "unverified",
            source_type_id: "1",
            publish_status_id: null,
            lat: 16.8,
            lng: 96.1,
            public_id: "00000000-0000-0000-0000-000000000099",
        } as never);
        assert.equal(values.categoryId, "7");
    });
});

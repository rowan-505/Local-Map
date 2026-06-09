import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildEntityAdminAreaInferCacheKey,
    getCachedEntityAdminAreaInferResult,
    resetEntityAdminAreaInferCacheForTests,
    setCachedEntityAdminAreaInferResult,
} from "./entity-admin-area.infer-cache.js";

describe("entity-admin-area infer cache", () => {
    it("builds stable keys for equivalent geometry coordinates", () => {
        const keyA = buildEntityAdminAreaInferCacheKey({
            kind: "street",
            entity_public_id: "b9a8902c-d202-46b6-8e89-0a3bab75a648",
            current_admin_area_id: "42",
            geometry: {
                type: "LineString",
                coordinates: [
                    [96.12345678901, 16.98765432109],
                    [96.22345678901, 16.88765432109],
                ],
            },
        });
        const keyB = buildEntityAdminAreaInferCacheKey({
            kind: "street",
            entity_public_id: "b9a8902c-d202-46b6-8e89-0a3bab75a648",
            current_admin_area_id: "42",
            geometry: {
                type: "LineString",
                coordinates: [
                    [96.12345678902, 16.98765432108],
                    [96.22345678902, 16.88765432108],
                ],
            },
        });

        assert.equal(keyA, keyB);
    });

    it("stores and returns cached infer results", () => {
        resetEntityAdminAreaInferCacheForTests();

        const key = buildEntityAdminAreaInferCacheKey({
            kind: "street",
            entity_public_id: "road-1",
            current_admin_area_id: "",
            geometry: {
                type: "LineString",
                coordinates: [
                    [96.1, 16.8],
                    [96.2, 16.9],
                ],
            },
        });

        const payload = {
            admin_area_id: "99",
            canonical_name: "Kyauktan",
            admin_level_code: "township",
            name_mm: null,
            name_en: null,
            geometry_contains: true,
            status: "recommendation_found" as const,
            message: null,
            currentAdminArea: null,
            recommendedTownship: null,
            recommendationMode: null,
            intersectingTownships: [],
            commonParentAdminArea: null,
            debugReason: null,
            fallbackReason: null,
            nearestTownshipDistanceM: null,
        };

        setCachedEntityAdminAreaInferResult(key, payload);
        assert.deepEqual(getCachedEntityAdminAreaInferResult(key), payload);
    });

    it("does not cache query_error infer results", () => {
        resetEntityAdminAreaInferCacheForTests();

        const key = buildEntityAdminAreaInferCacheKey({
            kind: "street",
            entity_public_id: "road-query-error",
            current_admin_area_id: "",
            geometry: {
                type: "LineString",
                coordinates: [
                    [96.1, 16.8],
                    [96.2, 16.9],
                ],
            },
        });

        setCachedEntityAdminAreaInferResult(key, {
            admin_area_id: null,
            canonical_name: null,
            admin_level_code: null,
            name_mm: null,
            name_en: null,
            geometry_contains: false,
            status: "no_match",
            message: "Township recommendation failed due to a query error (query_error).",
            currentAdminArea: null,
            recommendedTownship: null,
            recommendationMode: null,
            intersectingTownships: [],
            commonParentAdminArea: null,
            debugReason: "query_error",
            fallbackReason: null,
            nearestTownshipDistanceM: null,
        });

        assert.equal(getCachedEntityAdminAreaInferResult(key), undefined);
    });
});

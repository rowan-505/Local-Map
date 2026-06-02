import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";

import {
    assertFinalPatchedPlaceNameState,
    assertPersistableDirectColumnPatch,
    IMPORT_REVIEW_CANDIDATE_COLUMN_EDIT_TYPE,
    mapOverridePatchToColumnPatch,
    pickColumnSnapshot,
    resolveFinalPatchedPlaceNames,
    resolveCandidateColumnForOverrideKey,
    stringifyColumnAuditSnapshot,
} from "./import-review-candidate-column-patch.js";
import { ImportReviewDecisionRuleError } from "./import-review-errors.js";
import { isImportReviewColumnPatchEnabled } from "./import-review-column-patch-config.js";
import { sanitizeReviewOverridesPatch } from "./import-review-overrides-sanitize.js";
import {
    buildUpdateColumnAssignment,
    colRef,
} from "./import-review-candidate-sql.js";
import { getImportReviewEntityConfig } from "./import-review-config.js";

function sqlFragment(sql: Prisma.Sql): string {
    return sql.strings.join("?");
}

describe("import-review-candidate-column-patch", () => {
    it("maps alias keys to columns", () => {
        assert.equal(resolveCandidateColumnForOverrideKey("poi_category_id"), "category_id");
        assert.equal(resolveCandidateColumnForOverrideKey("waterway_class"), "class_code");
        assert.equal(resolveCandidateColumnForOverrideKey("parent_admin_area_id"), "parent_id");
    });

    it("maps places poi_category_id patch alias through sanitize to category_id column", () => {
        const sanitized = sanitizeReviewOverridesPatch("places", {
            poi_category_id: "39",
            name_mm: "နေရာ",
        });
        const mapped = mapOverridePatchToColumnPatch("places", sanitized);
        assert.equal(mapped.category_id, 39);
    });

    it("maps building override patch to columns", () => {
        const mapped = mapOverridePatchToColumnPatch("buildings", {
            building_type_id: 12,
            name_mm: "မြန်မာ",
        });
        assert.deepEqual(mapped, {
            building_type_id: 12,
            name_mm: "မြန်မာ",
        });
    });

    it("drops landuse admin_area_id (no column)", () => {
        const mapped = mapOverridePatchToColumnPatch("landuse", {
            class_code: "residential",
            admin_area_id: 99,
        });
        assert.deepEqual(mapped, { class_code: "residential" });
    });

    it("column patch enabled by default", () => {
        assert.equal(isImportReviewColumnPatchEnabled(), true);
    });

    it("uses valid review_candidate_edits edit_type for column PATCH audit", () => {
        assert.equal(IMPORT_REVIEW_CANDIDATE_COLUMN_EDIT_TYPE, "override_update");
    });

    it("assertPersistableDirectColumnPatch rejects empty fields and non-persistable keys", () => {
        assert.throws(
            () => assertPersistableDirectColumnPatch("buildings", {}, {}),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("at least one column update")
        );
        assert.throws(
            () => assertPersistableDirectColumnPatch("landuse", { admin_area_id: 9 }, {}),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("admin_area_id")
        );
        assert.doesNotThrow(() =>
            assertPersistableDirectColumnPatch(
                "roads",
                { surface: "asphalt" },
                { surface: "asphalt" }
            )
        );
    });

    it("stringifyColumnAuditSnapshot serializes bigint for jsonb audit", () => {
        const snap = pickColumnSnapshot(
            { building_type_id: 42n, name_en: "Tower" },
            ["building_type_id", "name_en"]
        );
        const json = stringifyColumnAuditSnapshot(snap);
        assert.doesNotThrow(() => JSON.parse(json));
        const parsed = JSON.parse(json) as Record<string, unknown>;
        assert.equal(parsed.building_type_id, "42");
        assert.equal(parsed.name_en, "Tower");
    });

    it("roads direct PATCH SET uses unqualified column names", () => {
        const roads = getImportReviewEntityConfig("roads");
        const fields = [
            { key: "name_mm", value: "x", expected: "name_mm = ?" },
            { key: "name_en", value: "x", expected: "name_en = ?" },
            { key: "road_class_id", value: 1, expected: "road_class_id = ?::bigint" },
            { key: "surface", value: "x", expected: "surface = ?" },
            { key: "is_oneway", value: true, expected: "is_oneway = ?::boolean" },
        ] as const;

        for (const field of fields) {
            const assignment = buildUpdateColumnAssignment(field.key, field.value);
            const sql = sqlFragment(assignment);
            assert.equal(sql, field.expected, `expected unqualified SET for ${field.key}`);
            assert.doesNotMatch(sql, /\w+\.\w+\s*=/, `SET must not use table alias for ${field.key}`);
            const qualified = sqlFragment(colRef(roads, field.key));
            assert.match(qualified, new RegExp(`^${roads.tableAlias}\\.${field.key}`));
        }
    });

    it("buildings and places direct PATCH SET use unqualified column names", () => {
        const cases = [
            {
                family: "buildings" as const,
                fields: [
                    ["name_mm", "name_mm = ?", "abc"],
                    ["building_type_id", "building_type_id = ?::bigint", 1],
                ] as const,
            },
            {
                family: "places" as const,
                fields: [
                    ["name_en", "name_en = ?", "abc"],
                    ["category_id", "category_id = ?::bigint", 1],
                ] as const,
            },
        ];

        for (const { family, fields } of cases) {
            const config = getImportReviewEntityConfig(family);
            for (const [field, expected, value] of fields) {
                const sql = sqlFragment(buildUpdateColumnAssignment(field, value));
                assert.equal(sql, expected);
                assert.doesNotMatch(sql, new RegExp(`${config.tableAlias}\\.`));
            }
        }
    });

    it("casts typed direct PATCH columns for all requested families", () => {
        const cases: Array<{ column: string; value: unknown; expected: string }> = [
            { column: "admin_area_id", value: 101, expected: "admin_area_id = ?::bigint" },
            { column: "category_id", value: "88", expected: "category_id = ?::bigint" },
            { column: "building_type_id", value: 7, expected: "building_type_id = ?::bigint" },
            { column: "road_class_id", value: 3, expected: "road_class_id = ?::bigint" },
            { column: "landuse_class_id", value: 5, expected: "landuse_class_id = ?::bigint" },
            { column: "admin_level_id", value: 4, expected: "admin_level_id = ?::bigint" },
            { column: "parent_id", value: 2, expected: "parent_id = ?::bigint" },
            { column: "speed_kph", value: 40, expected: "speed_kph = ?::numeric" },
            { column: "confidence_score", value: 80, expected: "confidence_score = ?::numeric" },
            { column: "importance_score", value: 70, expected: "importance_score = ?::numeric" },
            { column: "popularity_score", value: 60, expected: "popularity_score = ?::numeric" },
            { column: "is_oneway", value: true, expected: "is_oneway = ?::boolean" },
            { column: "bridge", value: false, expected: "bridge = ?::boolean" },
            { column: "tunnel", value: true, expected: "tunnel = ?::boolean" },
        ];

        for (const tc of cases) {
            const sql = sqlFragment(buildUpdateColumnAssignment(tc.column, tc.value));
            assert.equal(sql, tc.expected);
            assert.doesNotMatch(sql, /\w+\.\w+ =/, "SET must stay unqualified");
        }
    });

    it("place final-state validation succeeds when incoming name_mm exists", () => {
        const finalNames = resolveFinalPatchedPlaceNames({
            existingNameMm: null,
            existingNameEn: null,
            incomingPatch: { name_mm: "နေရာအမည်" },
        });
        assert.equal(finalNames.nameMm, "နေရာအမည်");
        assert.equal(finalNames.nameEn, null);
        assert.doesNotThrow(() =>
            assertFinalPatchedPlaceNameState({
                existingNameMm: null,
                existingNameEn: null,
                incomingPatch: { name_mm: "နေရာအမည်" },
            })
        );
    });

    it("place final-state validation succeeds when merged patch has name_en only", () => {
        assert.doesNotThrow(() =>
            assertFinalPatchedPlaceNameState({
                existingNameMm: null,
                existingNameEn: null,
                incomingPatch: { name_en: "Place Name", category_id: 10 },
            })
        );
    });

    it("place final-state validation succeeds when incoming name_en exists", () => {
        const finalNames = resolveFinalPatchedPlaceNames({
            existingNameMm: null,
            existingNameEn: null,
            incomingPatch: { name_en: "Place Name" },
        });
        assert.equal(finalNames.nameMm, null);
        assert.equal(finalNames.nameEn, "Place Name");
        assert.doesNotThrow(() =>
            assertFinalPatchedPlaceNameState({
                existingNameMm: null,
                existingNameEn: null,
                incomingPatch: { name_en: "Place Name" },
            })
        );
    });

    it("place final-state validation fails when no existing or incoming names", () => {
        assert.throws(
            () =>
                assertFinalPatchedPlaceNameState({
                    existingNameMm: null,
                    existingNameEn: null,
                    incomingPatch: { category_id: 10 },
                }),
            (err: unknown) =>
                err instanceof ImportReviewDecisionRuleError &&
                err.message.includes("At least one name is required")
        );
    });

    it("building/road payloads are not constrained by place name rule helper", () => {
        const buildingLikeFinal = resolveFinalPatchedPlaceNames({
            existingNameMm: "Existing MM",
            existingNameEn: null,
            incomingPatch: { building_type_id: 3 },
        });
        assert.equal(buildingLikeFinal.nameMm, "Existing MM");
        assert.equal(buildingLikeFinal.nameEn, null);

        const roadLikeFinal = resolveFinalPatchedPlaceNames({
            existingNameMm: null,
            existingNameEn: "Existing EN",
            incomingPatch: { road_class_id: 7, surface: "asphalt" },
        });
        assert.equal(roadLikeFinal.nameMm, null);
        assert.equal(roadLikeFinal.nameEn, "Existing EN");
    });
});

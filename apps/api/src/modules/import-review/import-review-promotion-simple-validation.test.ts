import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";

import {
    IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY,
    listPromotableFamilies,
    type ImportReviewSimplePromotionFamily,
} from "./import-review-promotion-simple-config.js";
import {
    ImportReviewSimplePromotionValidationRepository,
    extractSourceDisplayNamesFromRefs,
    resolveSimplePromotionValidationStatus,
    validateSimplePromotionCandidate,
    validateSimplePromotionCandidateRow,
    type SimplePromotionCandidateValidationRow,
    type SimplePromotionGeometryDiagnostics,
} from "./import-review-promotion-simple-validation.js";
import {
    buildPromotionValidationGeometrySelectSql,
    isPromotionValidationGeometryColumn,
    listPromotionValidationScalarColumnNames,
} from "./import-review-promotion-simple-validation-sql.js";

function sqlText(fragment: Prisma.Sql): string {
    return fragment.strings.join("?");
}

function okGeom(
    type: string,
    overrides: Partial<SimplePromotionGeometryDiagnostics> = {}
): SimplePromotionGeometryDiagnostics {
    return {
        present: true,
        valid: true,
        srid: 4326,
        type,
        empty: false,
        ...overrides,
    };
}

function baseRow(
    overrides: Partial<SimplePromotionCandidateValidationRow> = {}
): SimplePromotionCandidateValidationRow {
    return {
        id: 1n,
        review_batch_id: 2n,
        review_status: "approved",
        review_decision: "approved",
        promotion_status: "pending",
        promoted_core_id: null,
        external_id: "osm-way-1",
        source_refs: { source: "osm" },
        confidence_score: 80,
        ...overrides,
    };
}

function allFkExist(config: (typeof IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY)[keyof typeof IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY]): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (const check of config.fkChecks) {
        map[check.column] = true;
    }
    return map;
}

describe("resolveSimplePromotionValidationStatus", () => {
    it("maps errors and warnings to blocked, warning, ready", () => {
        assert.equal(resolveSimplePromotionValidationStatus([], []), "ready");
        assert.equal(
            resolveSimplePromotionValidationStatus([], [{ code: "w", message: "w" }]),
            "warning"
        );
        assert.equal(
            resolveSimplePromotionValidationStatus([{ code: "e", message: "e" }], [{ code: "w", message: "w" }]),
            "blocked"
        );
    });
});

describe("extractSourceDisplayNamesFromRefs", () => {
    it("reads names from source_refs tags only", () => {
        const names = extractSourceDisplayNamesFromRefs({
            tags: { name: "Pagoda", "name:en": "English", "name:my": "မြန်မာ" },
        });
        assert.equal(names.name, "Pagoda");
        assert.equal(names.nameEn, "English");
        assert.equal(names.nameMm, "မြန်မာ");
    });
});

describe("validateSimplePromotionCandidateRow review approval", () => {
    const family: ImportReviewSimplePromotionFamily = "places";
    const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY[family];

    it("accepts a valid approved review_status and review_decision pair", () => {
        const row = familyReadyRow(family, {
            review_status: "approved",
            review_decision: "approved",
        });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.errors.some((e) => e.code === "review_not_approved"), false);
        assert.equal(result.status, "ready");
    });

    it("blocks when review_status is null", () => {
        const row = familyReadyRow(family, { review_status: null });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "review_not_approved"));
    });

    it("blocks when review_decision is null", () => {
        const row = familyReadyRow(family, { review_decision: null });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "review_not_approved"));
    });

    it("blocks when review_status is blank", () => {
        const row = familyReadyRow(family, { review_status: "   " });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "review_not_approved"));
    });

    it("blocks when review_decision is blank", () => {
        const row = familyReadyRow(family, { review_decision: "" });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "review_not_approved"));
    });
});

describe("validateSimplePromotionCandidateRow per family", () => {
    for (const family of listPromotableFamilies()) {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY[family];

        it(`${family}: ready when minimal typed row satisfies contract`, () => {
            const row = familyReadyRow(family);
            const result = validateSimplePromotionCandidateRow(config, row, {
                fkExistsByColumn: allFkExist(config),
                nearbyCoreRoads: family === "routing_barriers" ? 1 : undefined,
            });
            assert.equal(result.status, "ready", JSON.stringify(result));
            assert.equal(result.errors.length, 0);
        });

        it(`${family}: blocked when already promoted`, () => {
            const row = familyReadyRow(family, { promotion_status: "promoted", promoted_core_id: 99n });
            const result = validateSimplePromotionCandidateRow(config, row, {
                fkExistsByColumn: allFkExist(config),
            });
            assert.equal(result.status, "blocked");
            assert.ok(result.errors.some((e) => e.code === "already_promoted"));
        });

        it(`${family}: blocked when review not approved`, () => {
            const row = familyReadyRow(family, { review_status: "pending" });
            const result = validateSimplePromotionCandidateRow(config, row, {
                fkExistsByColumn: allFkExist(config),
            });
            assert.equal(result.status, "blocked");
            assert.ok(result.errors.some((e) => e.code === "review_not_approved"));
        });

        it(`${family}: blocked when confidence out of range`, () => {
            const row = familyReadyRow(family, { confidence_score: 150 });
            const result = validateSimplePromotionCandidateRow(config, row, {
                fkExistsByColumn: allFkExist(config),
            });
            assert.equal(result.status, "blocked");
            assert.ok(result.errors.some((e) => e.code === "invalid_confidence"));
        });

        it(`${family}: warning when confidence is low`, () => {
            const row = familyReadyRow(family, { confidence_score: 10 });
            const result = validateSimplePromotionCandidateRow(config, row, {
                fkExistsByColumn: allFkExist(config),
                nearbyCoreRoads: family === "routing_barriers" ? 1 : undefined,
            });
            assert.equal(result.status, "warning");
            assert.ok(result.warnings.some((e) => e.code === "low_confidence"));
        });
    }

    it("places: blocked without category_id and admin_area_id", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.places;
        const row = familyReadyRow("places", {
            category_id: null,
            admin_area_id: null,
        });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.field === "category_id"));
        assert.ok(result.errors.some((e) => e.field === "admin_area_id"));
    });

    it("places: warning when display names empty but source_refs has name", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.places;
        const row = familyReadyRow("places", {
            name_en: null,
            name_mm: null,
            primary_name: null,
            display_name: null,
            source_refs: { tags: { name: "Source Only" } },
        });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "warning");
        assert.ok(result.warnings.some((e) => e.code === "missing_display_name"));
        assert.ok(result.warnings.some((e) => e.code === "source_fallback_name_available"));
    });

    it("buildings: blocked when FK missing in ref table", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings;
        const row = familyReadyRow("buildings");
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: { building_type_id: false, admin_area_id: true },
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "fk_not_found"));
    });

    it("buildings: warning when admin_area_id missing", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings;
        const row = familyReadyRow("buildings", { admin_area_id: null });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: { building_type_id: true },
        });
        assert.equal(result.status, "warning");
        assert.ok(result.warnings.some((e) => e.code === "admin_area_id_missing"));
    });

    it("roads: warning when computed length is very short", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.roads;
        const row = familyReadyRow("roads", {
            geomDiagnostics: okGeom("ST_LineString", { lengthM: 0.5 }),
        });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "warning");
        assert.ok(result.warnings.some((e) => e.code === "line_too_short"));
    });

    it("buildings: warning when computed area is unusually small", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings;
        const row = familyReadyRow("buildings", {
            geomDiagnostics: okGeom("ST_Polygon", { areaM2: 50 }),
        });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "warning");
        assert.ok(result.warnings.some((e) => e.code === "geometry_area_unusual"));
    });

    it("roads: warning for unknown surface and access", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.roads;
        const row = familyReadyRow("roads", { surface: "moon_dust", access: "hover_only" });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "warning");
        assert.ok(result.warnings.some((e) => e.code === "unknown_road_surface"));
        assert.ok(result.warnings.some((e) => e.code === "unknown_road_access"));
    });

    it("routing_barriers: warning when not near core road", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.routing_barriers;
        const row = familyReadyRow("routing_barriers");
        const result = validateSimplePromotionCandidateRow(config, row, {
            nearbyCoreRoads: 0,
        });
        assert.equal(result.status, "warning");
        assert.ok(result.warnings.some((e) => e.code === "barrier_not_near_road"));
    });

    it("admin_areas: blocked without typed name", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.admin_areas;
        const row = familyReadyRow("admin_areas", {
            name_en: null,
            name_mm: null,
            canonical_name: null,
        });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "missing_admin_name"));
    });

    it("buildings: blocked when manual_protected", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings;
        // Guard only fires when there is no Apply-batch decision yet.
        const row = familyReadyRow("buildings", {
            match_status: "manual_protected",
            review_decision: null,
        });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "manual_protected"));
    });

    it("buildings: blocked on insert target_conflict", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings;
        const row = familyReadyRow("buildings");
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
            insertTargetConflict: true,
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "target_conflict"));
    });

    it("addresses: blocked when promotion_blockers present", () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.addresses;
        const row = familyReadyRow("addresses", {
            promotion_blockers: [{ code: "x", message: "blocked" }],
        });
        const result = validateSimplePromotionCandidateRow(config, row, {
            fkExistsByColumn: allFkExist(config),
        });
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "promotion_blockers_present"));
    });
});

describe("validateSimplePromotionCandidate (repository)", () => {
    it("returns blocked when candidate row is missing", async () => {
        const prisma = {
            $queryRaw: mock.fn(async () => []),
        } as unknown as PrismaClient;

        const result = await validateSimplePromotionCandidate(
            { family: "places", candidateId: 9n, reviewBatchId: 2n },
            prisma
        );
        assert.equal(result.status, "blocked");
        assert.ok(result.errors.some((e) => e.code === "missing_candidate"));
    });
});

describe("ImportReviewSimplePromotionValidationRepository.loadCandidateRow", () => {
    it("issues SELECT without raw geometry columns (buildings)", async () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.buildings;
        const scalars = listPromotionValidationScalarColumnNames(config);
        assert.equal(scalars.includes("geom"), false);
        assert.equal(scalars.includes("centroid"), false);

        const queryRaw = async () => [
            {
                id: 12n,
                review_batch_id: 2n,
                review_status: "approved",
                review_decision: "approved",
                promotion_status: "not_ready",
                promoted_core_id: null,
                building_type_id: 1n,
                name_en: "B",
                external_id: "x",
                source_refs: {},
                has_geom: true,
                geom_is_valid: true,
                geom_srid: 4326,
                geom_type: "ST_Polygon",
                geom_is_empty: false,
                geom_length_m: null,
                geom_area_m2: 1200,
            },
        ];

        const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
        const repo = new ImportReviewSimplePromotionValidationRepository(prisma);
        const row = await repo.loadCandidateRow(config, 12n, 2n);

        assert.ok(row);
        assert.equal(row.geomDiagnostics?.present, true);
        assert.equal(row.geomDiagnostics?.type, "ST_Polygon");
        assert.equal(row.geomDiagnostics?.areaM2, 1200);
        assert.equal("geom" in row, false);

        const geomSql = sqlText(buildPromotionValidationGeometrySelectSql(config));
        assert.match(geomSql, /has_geom/i);
        assert.match(geomSql, /geom_area_m2/i);
        assert.match(geomSql, /ST_Area/i);
    });

    it("maps road length and type from scalar geometry facts", async () => {
        const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY.roads;
        const queryRaw = async () => [
            {
                id: 3n,
                review_batch_id: 2n,
                review_status: "approved",
                review_decision: "approved",
                promotion_status: "not_ready",
                promoted_core_id: null,
                road_class_id: 4n,
                name_en: "Road",
                external_id: "r1",
                source_refs: {},
                length_m: 100,
                has_geom: true,
                geom_is_valid: true,
                geom_srid: 4326,
                geom_type: "ST_LineString",
                geom_is_empty: false,
                geom_length_m: 250.5,
                geom_area_m2: null,
            },
        ];

        const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
        const repo = new ImportReviewSimplePromotionValidationRepository(prisma);
        const row = await repo.loadCandidateRow(config, 3n, 2n);

        assert.ok(row);
        assert.equal(row.geomDiagnostics?.type, "ST_LineString");
        assert.equal(row.geomDiagnostics?.lengthM, 250.5);
        assert.equal(row.length_m, 100);

        const geomSql = sqlText(buildPromotionValidationGeometrySelectSql(config));
        assert.match(geomSql, /geom_length_m/i);
        assert.match(geomSql, /ST_Length/i);
        assert.equal(listPromotionValidationScalarColumnNames(config).includes("geom"), false);
    });

    it("does not throw Prisma geometry deserialize when DB returns scalar facts only", async () => {
        let queryCalls = 0;
        const queryRaw = mock.fn(async () => {
            queryCalls += 1;
            if (queryCalls === 1) {
                return [
                    {
                        id: 1n,
                        review_batch_id: 2n,
                        review_status: "approved",
                        review_decision: "approved",
                        promotion_status: null,
                        promoted_core_id: null,
                        building_type_id: 1n,
                        admin_area_id: 2n,
                        name_en: "Tower",
                        external_id: "e",
                        source_refs: { osm: 1 },
                        has_geom: true,
                        geom_is_valid: true,
                        geom_srid: 4326,
                        geom_type: "ST_Polygon",
                        geom_is_empty: false,
                        geom_length_m: null,
                        geom_area_m2: 500,
                    },
                ];
            }
            return [{ exists: true }];
        });

        const prisma = { $queryRaw: queryRaw } as unknown as PrismaClient;
        const result = await validateSimplePromotionCandidate(
            { family: "buildings", candidateId: 1n, reviewBatchId: 2n },
            prisma
        );
        assert.equal(result.status, "ready");
        assert.ok(queryCalls >= 2);
    });

    for (const family of listPromotableFamilies()) {
        it(`${family}: loadCandidateRow scalar list excludes geometry promotion columns`, () => {
            const config = IMPORT_REVIEW_SIMPLE_PROMOTION_REGISTRY[family];
            const scalars = listPromotionValidationScalarColumnNames(config);
            for (const col of config.promotionColumns) {
                if (isPromotionValidationGeometryColumn(col)) {
                    assert.equal(scalars.includes(col), false, `must not select raw ${col}`);
                }
            }
        });
    }
});

function familyReadyRow(
    family: ImportReviewSimplePromotionFamily,
    overrides: Partial<SimplePromotionCandidateValidationRow> = {}
): SimplePromotionCandidateValidationRow {
    const row = baseRow(overrides);

    switch (family) {
        case "places":
            return {
                ...row,
                point_geom: "present",
                category_id: 1n,
                admin_area_id: 2n,
                name_en: "Place",
                geomDiagnostics: okGeom("ST_Point"),
                ...overrides,
            };
        case "buildings":
            return {
                ...row,
                geom: "present",
                building_type_id: 3n,
                admin_area_id: 2n,
                name_en: "Building",
                geomDiagnostics: okGeom("ST_Polygon"),
                ...overrides,
            };
        case "roads":
            return {
                ...row,
                geom: "present",
                road_class_id: 4n,
                admin_area_id: 2n,
                name_en: "Road",
                geomDiagnostics: okGeom("ST_LineString"),
                ...overrides,
            };
        case "land_areas":
            return {
                ...row,
                geom: "present",
                land_area_class_id: 5n,
                name_en: "Landuse",
                geomDiagnostics: okGeom("ST_MultiPolygon"),
                ...overrides,
            };
        case "water_lines":
            return {
                ...row,
                geom: "present",
                class_code: "river",
                name_en: "River",
                geomDiagnostics: okGeom("ST_LineString"),
                ...overrides,
            };
        case "water_polygons":
            return {
                ...row,
                geom: "present",
                class_code: "lake",
                name_en: "Lake",
                geomDiagnostics: okGeom("ST_Polygon"),
                ...overrides,
            };
        case "admin_areas":
            return {
                ...row,
                geom: "present",
                admin_level_id: 6n,
                name_mm: "မြို့",
                source_refs: { osm: 1 },
                geomDiagnostics: okGeom("ST_Polygon"),
                ...overrides,
            };
        case "routing_barriers":
            return {
                ...row,
                point_geom: "present",
                barrier_type: "gate",
                name_en: "Gate",
                source_refs: { osm: 1 },
                geomDiagnostics: okGeom("ST_Point"),
                ...overrides,
            };
        case "addresses":
            return {
                ...row,
                point_geom: "present",
                validation_status: "ready",
                address_strength: "strong",
                full_address: "1 Main St",
                promotion_blockers: [],
                geomDiagnostics: okGeom("ST_Point"),
                ...overrides,
            };
        default:
            return { ...row, ...overrides };
    }
}

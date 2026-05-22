import type { FastifyBaseLogger } from "fastify";

import type { ImportReviewBuildingSort } from "./import-review.schema.js";
import {
    getImportReviewDatabaseEnvSource,
    getImportReviewDatabaseUrlBase,
    parsePostgresUrlSanitized,
} from "./import-review-database-url.js";

export type { ParsedImportReviewDbTarget } from "./import-review-database-url.js";

export {
    getImportReviewDatabaseEnvSource,
    getImportReviewDatabaseUrlBase,
    logImportReviewBatchResolveHintsDev,
    parsePostgresUrlSanitized,
    throwIfImportReviewProductionLocalhostMismatch,
    verifyImportReviewSchemaOrThrow,
} from "./import-review-database-url.js";

/** Dev-only diagnostics (recent batch snapshots in logs — no response mutation). */
export function isImportReviewDevDiagnosticsEnabled(): boolean {
    return process.env.NODE_ENV !== "production";
}

/** When false, cleanup dry-run is allowed but execute is blocked. */
export function isImportReviewPermanentCleanupEnabled(): boolean {
    return process.env.ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP === "true";
}

/** When false, road publish batches may dry-run but must not promote to core. */
export function isImportReviewRoadPromotionEnabled(): boolean {
    return process.env.ENABLE_IMPORT_REVIEW_ROAD_PROMOTION === "true";
}

/** When false, address promotion dry-run is allowed but POST promote is blocked. */
export function isImportReviewAddressPromotionEnabled(): boolean {
    return process.env.ENABLE_IMPORT_REVIEW_ADDRESS_PROMOTION === "true";
}

/** Never logs passwords or raw URLs. */
export function logImportReviewDatabaseStartup(logger: FastifyBaseLogger): void {
    const identity = parsePostgresUrlSanitized(getImportReviewDatabaseUrlBase());

    if (!identity) {
        logger.error(
            {
                importReviewDatabaseTarget: {
                    host: "(unknown)",
                    port: "(unknown)",
                    database: "(unknown)",
                    user: "(unknown)",
                    selectedEnvSource: getImportReviewDatabaseEnvSource(),
                },
            },
            "import_review: could not parse DATABASE_URL / IMPORT_REVIEW_DATABASE_URL."
        );
        return;
    }

    logger.info(
        {
            importReviewDatabaseTarget: {
                host: identity.host,
                port: identity.port,
                database: identity.database,
                user: identity.user,
                sslmode: identity.sslmode,
                selectedEnvSource: getImportReviewDatabaseEnvSource(),
            },
        },
        "import-review database bootstrap"
    );
}

export const IMPORT_REVIEW_ENTITY_FAMILIES = [
    "buildings",
    "places",
    "roads",
    "bus_stops",
    "landuse",
    "water_lines",
    "water_polygons",
    "addresses",
    "admin_areas",
    "routing_barriers",
] as const;

export type ImportReviewEntityFamilySlug = (typeof IMPORT_REVIEW_ENTITY_FAMILIES)[number];

export type ImportReviewEntityFilterField =
    | "match_status"
    | "auto_action"
    | "review_status"
    | "review_decision"
    | "promotion_status"
    | "class_code";

export type ImportReviewEntityFamilyConfig = {
    routeFamily: ImportReviewEntityFamilySlug;
    importReviewTable: string;
    entityFamily: ImportReviewEntityFamilySlug;
    tableAlias: string;
    displayFields: readonly string[];
    searchableFields: readonly string[];
    filterFields: readonly ImportReviewEntityFilterField[];
    geometryColumns: {
        primary?: string;
        secondary?: string;
    };
    defaultSort: ImportReviewBuildingSort;
    riskLevel: "low" | "medium" | "high";
    bulkApprovalAllowed: boolean;
    validationRequiredBeforePromotion: boolean;
    supportsOverrides: boolean;
    listIncludeGeometryDefault: boolean;
    /** When true, list/detail SELECT joins ref.ref_road_classes for road class label. */
    roadClassJoin: boolean;
    /** When true, list/detail SELECT joins ref.ref_building_types on effective building_type_id. */
    buildingTypeJoin: boolean;
    /** When true, list/detail SELECT joins ref.ref_landuse_classes on effective landuse_class_id. */
    landuseClassJoin: boolean;
    /** When true, list/detail SELECT joins core.core_admin_areas on effective admin_area_id. */
    effectiveAdminAreaJoin: boolean;
    /** Maps BuildingListRowDb padding — null means NULL::type in SELECT. */
    listRowShape: {
        name: string | null;
        building_type: string | null;
        building_type_id: string | null;
        landuse_class_id: string | null;
        admin_area_id: string | null;
        levels: string | null;
        height_m: string | null;
        area_m2: string | null;
    };
};

const COMMON_FILTER_FIELDS = [
    "match_status",
    "auto_action",
    "review_status",
    "review_decision",
    "promotion_status",
] as const satisfies readonly ImportReviewEntityFilterField[];

function familyConfig(
    config: Omit<ImportReviewEntityFamilyConfig, "listIncludeGeometryDefault"> & {
        listIncludeGeometryDefault?: boolean;
    }
): ImportReviewEntityFamilyConfig {
    return {
        listIncludeGeometryDefault: false,
        ...config,
    };
}

export const IMPORT_REVIEW_ENTITY_FAMILY_CONFIG: Record<
    ImportReviewEntityFamilySlug,
    ImportReviewEntityFamilyConfig
> = {
    buildings: familyConfig({
        routeFamily: "buildings",
        importReviewTable: "building_candidates",
        entityFamily: "buildings",
        tableAlias: "b",
        displayFields: [
            "name",
            "building_type",
            "building_type_id",
            "admin_area_id",
            "levels",
            "height_m",
            "area_m2",
        ],
        searchableFields: ["canonical_name", "name", "external_id", "class_code"],
        filterFields: [...COMMON_FILTER_FIELDS, "class_code"],
        geometryColumns: { primary: "geom", secondary: "centroid" },
        defaultSort: "updated_at_desc",
        riskLevel: "low",
        bulkApprovalAllowed: true,
        validationRequiredBeforePromotion: false,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: true,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: true,
        listRowShape: {
            name: "name",
            building_type: "building_type",
            building_type_id: "building_type_id",
            landuse_class_id: null,
            admin_area_id: "admin_area_id",
            levels: "levels",
            height_m: "height_m",
            area_m2: "area_m2",
        },
    }),
    places: familyConfig({
        routeFamily: "places",
        importReviewTable: "place_candidates",
        entityFamily: "places",
        tableAlias: "p",
        displayFields: ["primary_name", "display_name", "lat", "lng"],
        searchableFields: ["canonical_name", "primary_name", "display_name", "external_id"],
        filterFields: [...COMMON_FILTER_FIELDS],
        geometryColumns: { primary: "point_geom" },
        defaultSort: "updated_at_desc",
        riskLevel: "low",
        bulkApprovalAllowed: true,
        validationRequiredBeforePromotion: false,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: false,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: true,
        listRowShape: {
            name: null,
            building_type: null,
            building_type_id: null,
            landuse_class_id: null,
            admin_area_id: "admin_area_id",
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
    roads: familyConfig({
        routeFamily: "roads",
        importReviewTable: "road_candidates",
        entityFamily: "roads",
        tableAlias: "r",
        displayFields: ["road_class_id", "surface", "is_oneway"],
        searchableFields: ["canonical_name", "external_id", "class_code", "road_class"],
        filterFields: [...COMMON_FILTER_FIELDS, "class_code"],
        geometryColumns: { primary: "geom" },
        defaultSort: "updated_at_desc",
        riskLevel: "high",
        bulkApprovalAllowed: false,
        validationRequiredBeforePromotion: true,
        supportsOverrides: true,
        roadClassJoin: true,
        buildingTypeJoin: false,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: true,
        listRowShape: {
            name: null,
            building_type: null,
            building_type_id: null,
            landuse_class_id: null,
            admin_area_id: null,
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
    bus_stops: familyConfig({
        routeFamily: "bus_stops",
        importReviewTable: "bus_stop_candidates",
        entityFamily: "bus_stops",
        tableAlias: "s",
        displayFields: ["name_mm", "name_en", "stop_code"],
        searchableFields: ["canonical_name", "stop_code", "external_id"],
        filterFields: [...COMMON_FILTER_FIELDS],
        geometryColumns: { primary: "geom" },
        defaultSort: "updated_at_desc",
        riskLevel: "low",
        bulkApprovalAllowed: true,
        validationRequiredBeforePromotion: false,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: false,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: true,
        listRowShape: {
            name: null,
            building_type: null,
            building_type_id: null,
            landuse_class_id: null,
            admin_area_id: "admin_area_id",
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
    landuse: familyConfig({
        routeFamily: "landuse",
        importReviewTable: "landuse_candidates",
        entityFamily: "landuse",
        tableAlias: "l",
        displayFields: ["name", "landuse_class_id"],
        searchableFields: ["canonical_name", "name", "external_id", "class_code"],
        filterFields: [...COMMON_FILTER_FIELDS, "class_code"],
        geometryColumns: { primary: "geom", secondary: "centroid" },
        defaultSort: "updated_at_desc",
        riskLevel: "low",
        bulkApprovalAllowed: true,
        validationRequiredBeforePromotion: false,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: false,
        landuseClassJoin: true,
        effectiveAdminAreaJoin: false,
        listRowShape: {
            name: "name",
            building_type: null,
            building_type_id: null,
            landuse_class_id: "landuse_class_id",
            admin_area_id: null,
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
    water_lines: familyConfig({
        routeFamily: "water_lines",
        importReviewTable: "water_line_candidates",
        entityFamily: "water_lines",
        tableAlias: "wl",
        displayFields: ["name"],
        searchableFields: ["canonical_name", "name", "external_id"],
        filterFields: [...COMMON_FILTER_FIELDS],
        geometryColumns: { primary: "geom" },
        defaultSort: "updated_at_desc",
        riskLevel: "low",
        bulkApprovalAllowed: true,
        validationRequiredBeforePromotion: false,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: false,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: false,
        listRowShape: {
            name: "name",
            building_type: null,
            building_type_id: null,
            landuse_class_id: null,
            admin_area_id: null,
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
    water_polygons: familyConfig({
        routeFamily: "water_polygons",
        importReviewTable: "water_polygon_candidates",
        entityFamily: "water_polygons",
        tableAlias: "wp",
        displayFields: ["name"],
        searchableFields: ["canonical_name", "name", "external_id"],
        filterFields: [...COMMON_FILTER_FIELDS],
        geometryColumns: { primary: "geom", secondary: "centroid" },
        defaultSort: "updated_at_desc",
        riskLevel: "low",
        bulkApprovalAllowed: true,
        validationRequiredBeforePromotion: false,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: false,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: false,
        listRowShape: {
            name: "name",
            building_type: null,
            building_type_id: null,
            landuse_class_id: null,
            admin_area_id: null,
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
    addresses: familyConfig({
        routeFamily: "addresses",
        importReviewTable: "address_candidates",
        entityFamily: "addresses",
        tableAlias: "a",
        displayFields: [
            "full_address",
            "house_number",
            "street_name",
            "unit_number",
            "quarter",
            "suburb",
            "township",
            "city",
        ],
        searchableFields: [
            "canonical_name",
            "full_address",
            "house_number",
            "street_name",
            "external_id",
        ],
        filterFields: [...COMMON_FILTER_FIELDS, "class_code"],
        geometryColumns: { primary: "point_geom", secondary: "entrance_geom" },
        defaultSort: "updated_at_desc",
        riskLevel: "medium",
        bulkApprovalAllowed: true,
        validationRequiredBeforePromotion: false,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: false,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: false,
        listRowShape: {
            name: "full_address",
            building_type: null,
            building_type_id: null,
            landuse_class_id: null,
            admin_area_id: "admin_area_id",
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
    admin_areas: familyConfig({
        routeFamily: "admin_areas",
        importReviewTable: "admin_area_candidates",
        entityFamily: "admin_areas",
        tableAlias: "aa",
        displayFields: ["admin_level_id", "slug"],
        searchableFields: ["canonical_name", "slug", "external_id"],
        filterFields: [...COMMON_FILTER_FIELDS],
        geometryColumns: { primary: "geom", secondary: "centroid" },
        defaultSort: "updated_at_desc",
        riskLevel: "medium",
        bulkApprovalAllowed: true,
        validationRequiredBeforePromotion: false,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: false,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: false,
        listRowShape: {
            name: "slug",
            building_type: null,
            building_type_id: null,
            landuse_class_id: null,
            admin_area_id: "admin_level_id",
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
    routing_barriers: familyConfig({
        routeFamily: "routing_barriers",
        importReviewTable: "routing_barrier_candidates",
        entityFamily: "routing_barriers",
        tableAlias: "rb",
        displayFields: ["barrier_type"],
        searchableFields: ["canonical_name", "barrier_type", "external_id"],
        filterFields: [...COMMON_FILTER_FIELDS],
        geometryColumns: { primary: "point_geom" },
        defaultSort: "updated_at_desc",
        riskLevel: "high",
        bulkApprovalAllowed: false,
        validationRequiredBeforePromotion: true,
        supportsOverrides: true,
        roadClassJoin: false,
        buildingTypeJoin: false,
        landuseClassJoin: false,
        effectiveAdminAreaJoin: false,
        listRowShape: {
            name: "barrier_type",
            building_type: null,
            building_type_id: null,
            landuse_class_id: null,
            admin_area_id: null,
            levels: null,
            height_m: null,
            area_m2: null,
        },
    }),
};

export function isImportReviewEntityFamily(value: string): value is ImportReviewEntityFamilySlug {
    return (IMPORT_REVIEW_ENTITY_FAMILIES as readonly string[]).includes(value);
}

export function assertImportReviewEntityFamily(value: string): ImportReviewEntityFamilySlug {
    if (!isImportReviewEntityFamily(value)) {
        throw new Error(`Unknown import-review entity family: ${value}`);
    }
    return value;
}

export function getImportReviewEntityConfig(
    family: ImportReviewEntityFamilySlug
): ImportReviewEntityFamilyConfig {
    return IMPORT_REVIEW_ENTITY_FAMILY_CONFIG[family];
}

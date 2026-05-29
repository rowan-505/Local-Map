export const IMPORT_TRANSPORT_FAMILIES = ["routes", "stops", "variants", "route_stops"] as const;

export type ImportTransportFamily = (typeof IMPORT_TRANSPORT_FAMILIES)[number];

export const IMPORT_TRANSPORT_MODE_TYPES = [
    "local_bus",
    "express_bus",
    "train",
    "ferry",
    "airport_access",
] as const;

export type ImportTransportModeType = (typeof IMPORT_TRANSPORT_MODE_TYPES)[number];

export const IMPORT_TRANSPORT_DEFAULT_SORT = "updated_at_desc";

export const IMPORT_TRANSPORT_SORT_OPTIONS = [
    "updated_at_desc",
    "updated_at_asc",
    "confidence_score_desc",
    "confidence_score_asc",
    "stop_sequence_asc",
    "stop_sequence_desc",
    "id_desc",
    "id_asc",
] as const;

export type ImportTransportSort = (typeof IMPORT_TRANSPORT_SORT_OPTIONS)[number];

export type ImportTransportFamilyTableConfig = {
    family: ImportTransportFamily;
    schema: "import_transport";
    tableName: string;
    alias: string;
    externalIdExpression: string;
    searchColumns: readonly string[];
    hasGeometry: boolean;
};

export const IMPORT_TRANSPORT_FAMILY_TABLE_CONFIG: Record<
    ImportTransportFamily,
    ImportTransportFamilyTableConfig
> = {
    routes: {
        family: "routes",
        schema: "import_transport",
        tableName: "raw_routes",
        alias: "t",
        externalIdExpression: "COALESCE(NULLIF(BTRIM(t.external_id), ''), t.source_route_id)",
        searchColumns: ["route_code", "public_name", "route_name", "source_route_id", "external_id"],
        hasGeometry: false,
    },
    stops: {
        family: "stops",
        schema: "import_transport",
        tableName: "raw_stops",
        alias: "t",
        externalIdExpression: "COALESCE(NULLIF(BTRIM(t.external_id), ''), t.source_stop_id)",
        searchColumns: ["stop_code", "stop_name", "stop_name_local", "source_stop_id", "external_id"],
        hasGeometry: true,
    },
    variants: {
        family: "variants",
        schema: "import_transport",
        tableName: "raw_route_variants",
        alias: "t",
        externalIdExpression: "COALESCE(NULLIF(BTRIM(t.external_id), ''), t.source_variant_id)",
        searchColumns: ["variant_code", "direction_name", "origin_name", "destination_name", "source_variant_id", "external_id"],
        hasGeometry: true,
    },
    route_stops: {
        family: "route_stops",
        schema: "import_transport",
        tableName: "raw_route_stops",
        alias: "t",
        externalIdExpression:
            "COALESCE(NULLIF(BTRIM(t.external_id), ''), NULLIF(BTRIM(t.source_route_stop_id), ''), t.source_variant_id || ':' || t.source_stop_id)",
        searchColumns: [
            "source_route_stop_id",
            "source_variant_id",
            "source_stop_id",
            "external_id",
            "stop_code",
            "stop_name",
            "variant_code",
            "route_code",
        ],
        hasGeometry: false,
    },
};

export function isImportTransportFamily(value: string): value is ImportTransportFamily {
    return (IMPORT_TRANSPORT_FAMILIES as readonly string[]).includes(value.trim().toLowerCase());
}

export function getImportTransportFamilyConfig(family: ImportTransportFamily): ImportTransportFamilyTableConfig {
    return IMPORT_TRANSPORT_FAMILY_TABLE_CONFIG[family];
}

export function qualifiedImportTransportTable(family: ImportTransportFamily): string {
    const cfg = getImportTransportFamilyConfig(family);
    return `${cfg.schema}.${cfg.tableName}`;
}

export function importTransportOrderBySql(family: ImportTransportFamily, sort: string): string {
    const alias = getImportTransportFamilyConfig(family).alias;
    switch (sort) {
        case "updated_at_asc":
            return `${alias}.updated_at ASC NULLS LAST, ${alias}.id ASC`;
        case "confidence_score_desc":
            return `${alias}.confidence_score DESC NULLS LAST, ${alias}.id DESC`;
        case "confidence_score_asc":
            return `${alias}.confidence_score ASC NULLS LAST, ${alias}.id ASC`;
        case "id_desc":
            return `${alias}.id DESC`;
        case "id_asc":
            return `${alias}.id ASC`;
        case "stop_sequence_asc":
            return family === "route_stops" ? `${alias}.stop_sequence ASC, ${alias}.id ASC` : `${alias}.updated_at ASC NULLS LAST, ${alias}.id ASC`;
        case "stop_sequence_desc":
            return family === "route_stops" ? `${alias}.stop_sequence DESC, ${alias}.id DESC` : `${alias}.updated_at DESC NULLS LAST, ${alias}.id DESC`;
        case "updated_at_desc":
        default:
            return `${alias}.updated_at DESC NULLS LAST, ${alias}.id DESC`;
    }
}

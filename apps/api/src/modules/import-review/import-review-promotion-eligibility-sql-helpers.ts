import { Prisma } from "@prisma/client";

import type { ImportReviewPromotionAllowedFamily } from "./import-review-promotion-config.js";

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

/** Preferred display-name columns per family (filtered to columns that exist on the table). */
export const ELIGIBILITY_DETAILS_DISPLAY_NAME_COLUMNS: Record<
    ImportReviewPromotionAllowedFamily,
    readonly string[]
> = {
    buildings: ["canonical_name", "name", "building_type", "external_id"],
    places: [
        "primary_name",
        "display_name",
        "canonical_name",
        "name",
        "name_en",
        "name_mm",
        "external_id",
    ],
    roads: ["canonical_name", "name", "road_name", "name_en", "name_mm", "external_id"],
    landuse: ["name", "canonical_name", "class_code", "landuse_class", "external_id"],
    water_lines: ["name", "canonical_name", "water_class", "class_code", "external_id"],
    water_polygons: ["name", "canonical_name", "water_class", "class_code", "external_id"],
    addresses: ["full_address", "address_text", "external_id"],
    admin_areas: ["canonical_name", "name", "name_en", "name_mm", "external_id"],
    routing_barriers: ["canonical_name", "name", "barrier_type", "external_id"],
};

/** Active-row predicate for core duplicate-exists checks (no generic is_active). */
const CORE_TARGET_ACTIVE_WHERE: Record<string, Prisma.Sql> = {
    "core.core_map_buildings": Prisma.sql`
        coalesce(core_row.is_active, true)
        AND core_row.deleted_at IS NULL
    `,
    "core.core_places": Prisma.sql`core_row.deleted_at IS NULL`,
    "core.core_streets": Prisma.sql`
        coalesce(core_row.is_active, true)
        AND core_row.deleted_at IS NULL
    `,
    "core.core_map_landuse": Prisma.sql`
        coalesce(core_row.is_active, true)
        AND core_row.deleted_at IS NULL
    `,
    "core.core_map_water_lines": Prisma.sql`
        coalesce(core_row.is_active, true)
        AND core_row.deleted_at IS NULL
    `,
    "core.core_map_water_polygons": Prisma.sql`
        coalesce(core_row.is_active, true)
        AND core_row.deleted_at IS NULL
    `,
    "core.core_addresses": Prisma.sql`
        coalesce(core_row.is_active, true)
        AND core_row.deleted_at IS NULL
    `,
    "core.core_admin_areas": Prisma.sql`
        coalesce(core_row.is_active, true)
        AND core_row.deleted_at IS NULL
    `,
    "routing.routing_barriers": Prisma.sql`coalesce(core_row.is_active, true)`,
};

export function optionalCandidateColumn(
    alias: string,
    columns: ReadonlySet<string>,
    column: string,
    pgType: string
): Prisma.Sql {
    if (!columns.has(column)) {
        return Prisma.sql`NULL::${Prisma.raw(pgType)}`;
    }
    return col(alias, column);
}

export function trimmedTextExpr(alias: string, columns: ReadonlySet<string>, column: string): Prisma.Sql {
    if (!columns.has(column)) {
        return Prisma.sql`NULL::text`;
    }
    return Prisma.sql`nullif(trim(coalesce(${col(alias, column)}, '')), '')`;
}

export function normalizedTextField(alias: string, field: string): Prisma.Sql {
    return Prisma.sql`nullif(trim(coalesce(${col(alias, "normalized_data")}->>${field}, '')), '')`;
}

export function buildExistingColumnCoalesce(
    alias: string,
    columns: ReadonlySet<string>,
    columnNames: readonly string[],
    includeIdFallback = true
): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    for (const name of columnNames) {
        if (columns.has(name)) {
            parts.push(trimmedTextExpr(alias, columns, name));
        }
    }
    if (includeIdFallback && columns.has("id")) {
        parts.push(Prisma.sql`${col(alias, "id")}::text`);
    }
    if (columns.has("public_id")) {
        parts.push(Prisma.sql`${col(alias, "public_id")}::text`);
    }
    if (parts.length === 0) {
        return Prisma.sql`NULL::text`;
    }
    return Prisma.sql`coalesce(${Prisma.join(parts, ", ")})`;
}

export function buildEligibilityDetailsDisplayNameExpr(
    alias: string,
    family: ImportReviewPromotionAllowedFamily,
    columns: ReadonlySet<string>
): Prisma.Sql {
    const preferred = ELIGIBILITY_DETAILS_DISPLAY_NAME_COLUMNS[family];
    return buildExistingColumnCoalesce(alias, columns, preferred, true);
}

export function coreTargetActiveWhereSql(coreTargetTable: string): Prisma.Sql {
    return CORE_TARGET_ACTIVE_WHERE[coreTargetTable] ?? Prisma.sql`TRUE`;
}

/** Insert blocked when the same external_id exists on the promotion core target (column-safe). */
export function duplicateCoreExternalIdSql(
    coreTargetTable: string,
    alias: string,
    columns: ReadonlySet<string>
): Prisma.Sql {
    if (!CORE_TARGET_ACTIVE_WHERE[coreTargetTable]) {
        return Prisma.sql`FALSE`;
    }
    if (!columns.has("external_id") || !columns.has("matched_core_id")) {
        return Prisma.sql`FALSE`;
    }
    const [schema, table] = coreTargetTable.split(".");
    if (!schema || !table) {
        return Prisma.sql`FALSE`;
    }
    const core = Prisma.raw(`${schema}.${table}`);
    const activeWhere = coreTargetActiveWhereSql(coreTargetTable);
    return Prisma.sql`(
        ${col(alias, "external_id")} IS NOT NULL
        AND trim(${col(alias, "external_id")}) <> ''
        AND ${col(alias, "matched_core_id")} IS NULL
        AND EXISTS (
            SELECT 1
            FROM ${core} AS core_row
            WHERE core_row.external_id = ${col(alias, "external_id")}
              AND ${activeWhere}
        )
    )`;
}

function effectiveGeomPresentSql(
    alias: string,
    columns: ReadonlySet<string>,
    geomColumn: string
): Prisma.Sql {
    if (!columns.has(geomColumn)) {
        return Prisma.sql`FALSE`;
    }
    return Prisma.sql`(${col(alias, geomColumn)} IS NOT NULL)`;
}

export function missingRequiredGeometrySql(
    family: ImportReviewPromotionAllowedFamily,
    alias: string,
    columns: ReadonlySet<string>
): Prisma.Sql {
    switch (family) {
        case "buildings":
        case "landuse":
        case "water_lines":
        case "water_polygons":
        case "admin_areas":
        case "roads":
            return Prisma.sql`NOT ${effectiveGeomPresentSql(alias, columns, "geom")}`;
        case "places": {
            const clauses: Prisma.Sql[] = [];
            if (columns.has("point_geom")) {
                clauses.push(Prisma.sql`${col(alias, "point_geom")} IS NULL`);
            }
            if (columns.has("lat") && columns.has("lng")) {
                clauses.push(
                    Prisma.sql`(${col(alias, "lat")} IS NULL OR ${col(alias, "lng")} IS NULL)`
                );
            }
            if (clauses.length === 0) {
                return Prisma.sql`FALSE`;
            }
            return Prisma.join(clauses, " AND ");
        }
        case "routing_barriers": {
            if (!columns.has("point_geom")) {
                return Prisma.sql`FALSE`;
            }
            return Prisma.sql`${col(alias, "point_geom")} IS NULL`;
        }
        case "addresses": {
            const parts: Prisma.Sql[] = [];
            if (columns.has("geom")) {
                parts.push(Prisma.sql`NOT ${effectiveGeomPresentSql(alias, columns, "geom")}`);
            }
            if (columns.has("point_geom")) {
                parts.push(Prisma.sql`${col(alias, "point_geom")} IS NULL`);
            }
            if (columns.has("lat") && columns.has("lng")) {
                parts.push(Prisma.sql`(${col(alias, "lat")} IS NULL OR ${col(alias, "lng")} IS NULL)`);
            }
            if (parts.length === 0) {
                return Prisma.sql`FALSE`;
            }
            return Prisma.join(parts, " AND ");
        }
        default:
            return Prisma.sql`FALSE`;
    }
}

export function missingRequiredTypeCategoryClassSql(
    family: ImportReviewPromotionAllowedFamily,
    alias: string,
    columns: ReadonlySet<string>
): Prisma.Sql {
    switch (family) {
        case "roads": {
            if (!columns.has("road_class_id")) {
                return Prisma.sql`FALSE`;
            }
            const parts: Prisma.Sql[] = [
                Prisma.sql`${col(alias, "road_class_id")} IS NULL`,
                Prisma.sql`${trimmedTextExpr(alias, columns, "class_code")} IS NULL`,
            ];
            if (columns.has("normalized_data")) {
                parts.push(Prisma.sql`${normalizedTextField(alias, "highway")} IS NULL`);
            }
            return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
        }
        case "buildings": {
            const parts: Prisma.Sql[] = [
                Prisma.sql`${optionalCandidateColumn(alias, columns, "building_type_id", "bigint")} IS NULL`,
                Prisma.sql`${trimmedTextExpr(alias, columns, "building_type")} IS NULL`,
            ];
            if (columns.has("normalized_data")) {
                parts.push(Prisma.sql`${normalizedTextField(alias, "building_type")} IS NULL`);
            }
            return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
        }
        case "places": {
            const parts: Prisma.Sql[] = [
                Prisma.sql`${optionalCandidateColumn(alias, columns, "category_id", "bigint")} IS NULL`,
                Prisma.sql`${trimmedTextExpr(alias, columns, "class_code")} IS NULL`,
            ];
            if (columns.has("normalized_data")) {
                parts.push(
                    Prisma.sql`${normalizedTextField(alias, "category_id")} IS NULL`,
                    Prisma.sql`${normalizedTextField(alias, "category_code")} IS NULL`,
                    Prisma.sql`${normalizedTextField(alias, "class_code")} IS NULL`
                );
            }
            return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
        }
        case "landuse": {
            const parts: Prisma.Sql[] = [
                Prisma.sql`${optionalCandidateColumn(alias, columns, "landuse_class_id", "bigint")} IS NULL`,
                Prisma.sql`${trimmedTextExpr(alias, columns, "class_code")} IS NULL`,
            ];
            if (columns.has("normalized_data")) {
                parts.push(Prisma.sql`${normalizedTextField(alias, "landuse_class_id")} IS NULL`);
            }
            return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
        }
        case "admin_areas": {
            const parts: Prisma.Sql[] = [
                Prisma.sql`${optionalCandidateColumn(alias, columns, "admin_level_id", "bigint")} IS NULL`,
            ];
            if (columns.has("normalized_data")) {
                parts.push(Prisma.sql`${normalizedTextField(alias, "admin_level_id")} IS NULL`);
            }
            if (parts.length === 0) {
                return Prisma.sql`FALSE`;
            }
            return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
        }
        case "routing_barriers": {
            const parts: Prisma.Sql[] = [
                Prisma.sql`${trimmedTextExpr(alias, columns, "barrier_type")} IS NULL`,
            ];
            if (columns.has("normalized_data")) {
                parts.push(Prisma.sql`${normalizedTextField(alias, "barrier_type")} IS NULL`);
            }
            return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
        }
        case "water_lines":
        case "water_polygons": {
            const parts: Prisma.Sql[] = [
                Prisma.sql`${trimmedTextExpr(alias, columns, "class_code")} IS NULL`,
            ];
            if (columns.has("normalized_data")) {
                parts.push(Prisma.sql`${normalizedTextField(alias, "class_code")} IS NULL`);
            }
            return Prisma.sql`(${Prisma.join(parts, " AND ")})`;
        }
        case "addresses":
            return Prisma.sql`FALSE`;
        default:
            return Prisma.sql`FALSE`;
    }
}

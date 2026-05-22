import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    ImportReviewAdminAreaFormOption,
    ImportReviewFormOption,
    ImportReviewFormOptionsResponse,
} from "./import-review-options.types.js";

const ADMIN_AREA_OPTIONS_LIMIT = 2000;
const DISTINCT_CLASS_LIMIT = 150;

/** Common OSM-style surface values — merged with observed import-review values. */
const STATIC_SURFACE_PRESETS = [
    "asphalt",
    "concrete",
    "paved",
    "paving_stones",
    "unpaved",
    "gravel",
    "ground",
    "dirt",
    "grass",
    "cobblestone",
] as const;

async function tableExists(prisma: PrismaClient, qualified: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT to_regclass(${qualified}) IS NOT NULL AS ok
    `;
    return rows[0]?.ok === true;
}

function refRowToOption(row: { id: bigint; code?: string | null; name?: string | null }): ImportReviewFormOption {
    const code = row.code?.trim() || null;
    const name = row.name?.trim() || null;
    const label = code && name ? `${code} — ${name}` : code || name || row.id.toString();
    return {
        value: row.id.toString(),
        label,
        code,
    };
}

function stringValuesToOptions(values: string[]): ImportReviewFormOption[] {
    return values.map((value) => ({
        value,
        label: value,
        code: value,
    }));
}

function formatAdminAreaLabel(row: {
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
}): string {
    const mm = row.name_mm?.trim();
    const en = row.name_en?.trim();
    const canonical = row.canonical_name?.trim();
    if (mm && en) {
        return `${mm} — ${en}`;
    }
    if (mm) {
        return mm;
    }
    if (en) {
        return en;
    }
    return canonical ?? "";
}

export class ImportReviewOptionsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async fetchAll(): Promise<ImportReviewFormOptionsResponse> {
        const [
            admin_areas,
            admin_levels,
            road_classes,
            poi_categories,
            building_types,
            landuse_classes,
            waterway_classes,
            water_classes,
            barrier_types,
            observedSurfaces,
        ] = await Promise.all([
            this.fetchAdminAreas(),
            this.fetchRefTable("ref.ref_admin_levels", "rank ASC NULLS LAST, name ASC"),
            this.fetchRefTable("ref.ref_road_classes", "code ASC"),
            this.fetchRefTable("ref.ref_poi_categories", "sort_order ASC NULLS LAST, name ASC"),
            this.fetchBuildingTypes(),
            this.fetchLanduseClasses(),
            this.fetchDistinctClassValues("import_review.water_line_candidates", ["waterway"]),
            this.fetchDistinctClassValues("import_review.water_polygon_candidates", ["water", "natural"]),
            this.fetchDistinctBarrierValues(),
            this.fetchDistinctSurfaceValues(),
        ]);

        const surfaceSet = new Set<string>(STATIC_SURFACE_PRESETS);
        for (const s of observedSurfaces) {
            surfaceSet.add(s);
        }
        const surface_presets = stringValuesToOptions(
            [...surfaceSet].sort((a, b) => a.localeCompare(b))
        );

        return {
            admin_areas,
            admin_levels,
            road_classes,
            poi_categories,
            building_types,
            landuse_classes,
            waterway_classes,
            water_classes,
            barrier_types,
            surface_presets,
        };
    }

    private async fetchAdminAreas(): Promise<ImportReviewAdminAreaFormOption[]> {
        if (!(await tableExists(this.prisma, "core.core_admin_areas"))) {
            return [];
        }

        const rows = await this.prisma.$queryRaw<
            {
                id: bigint;
                canonical_name: string;
                name_mm: string | null;
                name_en: string | null;
                admin_level_id: bigint;
                parent_id: bigint | null;
            }[]
        >`
            SELECT
                a.id,
                a.canonical_name,
                an_mm.name AS name_mm,
                an_en.name AS name_en,
                a.admin_level_id,
                a.parent_id
            FROM core.core_admin_areas AS a
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
                      OR upper(trim(coalesce(n.script_code, ''))) = 'MYMR'
                  )
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.search_weight DESC NULLS LAST,
                    n.name ASC
                LIMIT 1
            ) AS an_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'en'
                      OR upper(trim(coalesce(n.script_code, ''))) = 'LATN'
                  )
                ORDER BY
                    CASE
                        WHEN n.name_type = 'official' AND n.is_primary = true THEN 1
                        WHEN n.is_primary = true THEN 2
                        WHEN n.name_type = 'official' THEN 3
                        ELSE 4
                    END,
                    n.search_weight DESC NULLS LAST,
                    n.name ASC
                LIMIT 1
            ) AS an_en ON true
            WHERE a.is_active = true
            ORDER BY a.canonical_name ASC
            LIMIT ${ADMIN_AREA_OPTIONS_LIMIT}
        `;

        return rows.map((row) => ({
            id: row.id.toString(),
            value: row.id.toString(),
            canonical_name: row.canonical_name,
            name_mm: row.name_mm,
            name_en: row.name_en,
            admin_level_id: row.admin_level_id.toString(),
            parent_id: row.parent_id?.toString() ?? null,
            label: formatAdminAreaLabel(row),
        }));
    }

    private async fetchRefTable(
        qualified: string,
        orderBy: string
    ): Promise<ImportReviewFormOption[]> {
        if (!(await tableExists(this.prisma, qualified))) {
            return [];
        }
        const [schema, table] = qualified.split(".");
        const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string | null }[]>`
            SELECT id, code, name
            FROM ${Prisma.raw(`${schema}.${table}`)}
            ORDER BY ${Prisma.raw(orderBy)}
        `;
        return rows.map((row) => refRowToOption(row));
    }

    private async fetchBuildingTypes(): Promise<ImportReviewFormOption[]> {
        if (!(await tableExists(this.prisma, "ref.ref_building_types"))) {
            return [];
        }
        const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
            SELECT id, code, name
            FROM ref.ref_building_types
            WHERE is_active IS TRUE
            ORDER BY sort_order ASC NULLS LAST, name ASC
        `;
        return rows.map((row) => refRowToOption(row));
    }

    private async fetchLanduseClasses(): Promise<ImportReviewFormOption[]> {
        if (!(await tableExists(this.prisma, "ref.ref_landuse_classes"))) {
            return this.fetchDistinctClassValues("import_review.landuse_candidates", ["landuse"]);
        }

        const rows = await this.prisma.$queryRaw<
            { id: bigint; code: string; name_en: string; name_mm: string | null }[]
        >`
            SELECT id, code, name_en, name_mm
            FROM ref.ref_landuse_classes
            WHERE is_active IS TRUE
            ORDER BY sort_order ASC NULLS LAST, name_en ASC
        `;

        return rows.map((row) => {
            const mm = row.name_mm?.trim() || null;
            const en = row.name_en?.trim() || null;
            const label = en && mm ? `${en} — ${mm}` : en ?? mm ?? row.code ?? row.id.toString();
            return {
                value: row.id.toString(),
                label,
                code: row.code,
            };
        });
    }

    private async fetchDistinctClassValues(
        qualifiedTable: string,
        tagKeys: readonly string[]
    ): Promise<ImportReviewFormOption[]> {
        if (!(await tableExists(this.prisma, qualifiedTable))) {
            return [];
        }

        const tagSelects = tagKeys.map(
            (key) =>
                Prisma.sql`SELECT NULLIF(trim(normalized_data->'tags'->>${key}), '') AS val FROM ${Prisma.raw(qualifiedTable)}`
        );

        const unionParts: Prisma.Sql[] = [
            Prisma.sql`SELECT NULLIF(trim(class_code), '') AS val FROM ${Prisma.raw(qualifiedTable)}`,
            ...tagSelects,
        ];

        const rows = await this.prisma.$queryRaw<{ val: string }[]>`
            SELECT DISTINCT val
            FROM (
                ${Prisma.join(unionParts, " UNION ALL ")}
            ) AS observed
            WHERE val IS NOT NULL
            ORDER BY val ASC
            LIMIT ${DISTINCT_CLASS_LIMIT}
        `;

        return stringValuesToOptions(rows.map((r) => r.val));
    }

    private async fetchDistinctBarrierValues(): Promise<ImportReviewFormOption[]> {
        const qualifiedTable = "import_review.routing_barrier_candidates";
        if (!(await tableExists(this.prisma, qualifiedTable))) {
            return [];
        }

        const rows = await this.prisma.$queryRaw<{ val: string }[]>`
            SELECT DISTINCT val
            FROM (
                SELECT NULLIF(trim(class_code), '') AS val FROM ${Prisma.raw(qualifiedTable)}
                UNION ALL
                SELECT NULLIF(trim(barrier_type), '') AS val FROM ${Prisma.raw(qualifiedTable)}
                UNION ALL
                SELECT NULLIF(trim(normalized_data->'tags'->>'barrier'), '') AS val FROM ${Prisma.raw(qualifiedTable)}
                UNION ALL
                SELECT NULLIF(trim(normalized_data->>'barrier_type'), '') AS val FROM ${Prisma.raw(qualifiedTable)}
            ) AS observed
            WHERE val IS NOT NULL
            ORDER BY val ASC
            LIMIT ${DISTINCT_CLASS_LIMIT}
        `;

        return stringValuesToOptions(rows.map((r) => r.val));
    }

    private async fetchDistinctSurfaceValues(): Promise<string[]> {
        const qualifiedTable = "import_review.road_candidates";
        if (!(await tableExists(this.prisma, qualifiedTable))) {
            return [];
        }

        const rows = await this.prisma.$queryRaw<{ val: string }[]>`
            SELECT DISTINCT val
            FROM (
                SELECT NULLIF(trim(review_overrides->>'surface'), '') AS val FROM ${Prisma.raw(qualifiedTable)}
                UNION ALL
                SELECT NULLIF(trim(normalized_data->'tags'->>'surface'), '') AS val FROM ${Prisma.raw(qualifiedTable)}
                UNION ALL
                SELECT NULLIF(trim(normalized_data->>'surface'), '') AS val FROM ${Prisma.raw(qualifiedTable)}
            ) AS observed
            WHERE val IS NOT NULL
            ORDER BY val ASC
            LIMIT ${DISTINCT_CLASS_LIMIT}
        `;

        return rows.map((r) => r.val);
    }
}

/** Map unified options to legacy reference-options bundle shape. */
export function toLegacyReferenceOptionsBundle(
    options: ImportReviewFormOptionsResponse
): {
    ref_poi_categories: { id: string; code: string | null; name: string | null }[];
    ref_road_classes: { id: string; code: string | null; name: string | null }[];
    ref_building_types: { id: string; code: string | null; name: string | null }[];
    ref_admin_levels: { id: string; code: string | null; name: string | null }[];
    ref_address_component_types: { id: string; code: string | null; name: string | null }[];
    ref_source_types: { id: string; code: string | null; name: string | null }[];
    core_admin_areas: { id: string; code: string | null; name: string | null }[];
} {
    const mapRef = (rows: ImportReviewFormOption[]) =>
        rows.map((r) => ({
            id: String(r.value),
            code: r.code ?? null,
            name: r.label,
        }));

    return {
        ref_poi_categories: mapRef(options.poi_categories),
        ref_road_classes: mapRef(options.road_classes),
        ref_building_types: mapRef(options.building_types),
        ref_admin_levels: mapRef(options.admin_levels),
        ref_address_component_types: [],
        ref_source_types: [],
        core_admin_areas: options.admin_areas.map((a) => ({
            id: a.id,
            code: a.canonical_name,
            name: a.label,
        })),
    };
}

import { Prisma, type PrismaClient } from "@prisma/client";

export type ImportReviewReferenceOptionRow = {
    id: string;
    code: string | null;
    name: string | null;
};

export type ImportReviewReferenceOptionsBundle = {
    ref_poi_categories: ImportReviewReferenceOptionRow[];
    ref_road_classes: ImportReviewReferenceOptionRow[];
    ref_building_types: ImportReviewReferenceOptionRow[];
    ref_admin_levels: ImportReviewReferenceOptionRow[];
    ref_address_component_types: ImportReviewReferenceOptionRow[];
    ref_source_types: ImportReviewReferenceOptionRow[];
    core_admin_areas: ImportReviewReferenceOptionRow[];
};

async function tableExists(prisma: PrismaClient, qualified: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<{ ok: boolean }[]>`
        SELECT to_regclass(${qualified}) IS NOT NULL AS ok
    `;
    return rows[0]?.ok === true;
}

function mapIdLabel(rows: { id: bigint; code?: string | null; name?: string | null }[]): ImportReviewReferenceOptionRow[] {
    return rows.map((r) => ({
        id: r.id.toString(),
        code: r.code ?? null,
        name: r.name ?? null,
    }));
}

export class ImportReviewReferenceOptionsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async fetchAll(): Promise<ImportReviewReferenceOptionsBundle> {
        const empty: ImportReviewReferenceOptionsBundle = {
            ref_poi_categories: [],
            ref_road_classes: [],
            ref_building_types: [],
            ref_admin_levels: [],
            ref_address_component_types: [],
            ref_source_types: [],
            core_admin_areas: [],
        };

        if (await tableExists(this.prisma, "ref.ref_poi_categories")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_poi_categories
                ORDER BY sort_order ASC NULLS LAST, name ASC
            `;
            empty.ref_poi_categories = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_road_classes")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string | null }[]>`
                SELECT id, code, name
                FROM ref.ref_road_classes
                ORDER BY code ASC
            `;
            empty.ref_road_classes = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_building_types")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_building_types
                WHERE is_active IS TRUE
                ORDER BY sort_order ASC NULLS LAST, name ASC
            `;
            empty.ref_building_types = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_admin_levels")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_admin_levels
                ORDER BY rank ASC NULLS LAST, name ASC
            `;
            empty.ref_admin_levels = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_address_component_types")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_address_component_types
                ORDER BY rank ASC NULLS LAST, name ASC
            `;
            empty.ref_address_component_types = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "ref.ref_source_types")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
                SELECT id, code, name
                FROM ref.ref_source_types
                ORDER BY code ASC
            `;
            empty.ref_source_types = mapIdLabel(rows);
        }

        if (await tableExists(this.prisma, "core.core_admin_areas")) {
            const rows = await this.prisma.$queryRaw<{ id: bigint; code: string | null; name: string | null }[]>`
                SELECT id, slug AS code, canonical_name AS name
                FROM core.core_admin_areas
                WHERE is_active = true
                ORDER BY canonical_name ASC NULLS LAST
                LIMIT 500
            `;
            empty.core_admin_areas = mapIdLabel(rows);
        }

        return empty;
    }

    async getActiveBuildingTypeById(id: bigint): Promise<{ id: bigint; code: string; name: string } | null> {
        if (!(await tableExists(this.prisma, "ref.ref_building_types"))) {
            return null;
        }
        const rows = await this.prisma.$queryRaw<{ id: bigint; code: string; name: string }[]>`
            SELECT id, code, name
            FROM ref.ref_building_types
            WHERE id = ${id}
              AND is_active IS TRUE
            LIMIT 1
        `;
        return rows[0] ?? null;
    }
}

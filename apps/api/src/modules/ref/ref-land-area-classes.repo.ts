import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

export type RefLandAreaClassRow = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    parent_id: string | null;
    sort_order: number | null;
    min_zoom: number | null;
    is_active: boolean;
};

export class RefLandAreaClassesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listActiveLandAreaClasses(): Promise<RefLandAreaClassRow[]> {
        return this.prisma.$queryRaw<RefLandAreaClassRow[]>(Prisma.sql`
            SELECT
                id::text AS id,
                code,
                name_en,
                name_mm,
                parent_id::text AS parent_id,
                sort_order,
                min_zoom,
                is_active
            FROM ref.ref_land_area_classes
            WHERE is_active IS TRUE
            ORDER BY sort_order ASC NULLS LAST, name_en ASC
        `);
    }
}

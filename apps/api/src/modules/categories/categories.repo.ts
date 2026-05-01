import { Prisma, type PrismaClient } from "@prisma/client";

export type CategoryRecord = {
    id: bigint;
    code: string;
    name: string;
    name_mm: string | null;
    sort_order: number;
};

export class CategoriesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listCategories() {
        return this.prisma.$queryRaw<CategoryRecord[]>(Prisma.sql`
            SELECT
                id,
                code,
                name,
                name_mm,
                sort_order
            FROM ref.ref_poi_categories
            WHERE parent_id IS NULL
              AND is_public = true
              AND is_searchable = true
            ORDER BY sort_order ASC, name ASC
        `);
    }
}

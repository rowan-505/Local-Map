import { Prisma, type PrismaClient } from "@prisma/client";

type SourceTypeRow = {
    id: bigint;
    code: string;
    name: string;
};

type PublishStatusRow = {
    id: bigint;
    code: string;
    name: string;
};

export class PlaceFormOptionsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listCategories() {
        return this.prisma.$queryRaw<
            {
                id: bigint;
                code: string;
                name: string;
                name_mm: string | null;
                parent_id: bigint | null;
                sort_order: number;
                is_public: boolean;
                is_searchable: boolean;
            }[]
        >`
            SELECT
                id,
                parent_id,
                code,
                name,
                name_mm,
                sort_order,
                is_public,
                is_searchable
            FROM ref.ref_poi_categories
            WHERE is_public = true
              AND is_searchable = true
            ORDER BY
                (parent_id IS NULL) DESC,
                sort_order ASC NULLS LAST,
                name ASC,
                id ASC
        `;
    }

    async listAdminAreas() {
        return this.prisma.coreAdminArea.findMany({
            where: {
                isActive: true,
            },
            select: {
                id: true,
                canonicalName: true,
                slug: true,
                adminLevelId: true,
            },
            orderBy: [
                {
                    canonicalName: "asc",
                },
            ],
            take: 100,
        });
    }

    async listSourceTypes() {
        return this.prisma.$queryRaw<SourceTypeRow[]>(Prisma.sql`
            SELECT
                id,
                code,
                name
            FROM ref.ref_source_types
            ORDER BY name ASC
        `);
    }

    async listPublishStatuses() {
        return this.prisma.$queryRaw<PublishStatusRow[]>(Prisma.sql`
            SELECT
                id,
                code,
                name
            FROM ref.ref_publish_statuses
            ORDER BY name ASC
        `);
    }
}

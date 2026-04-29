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
        return this.prisma.refPoiCategory.findMany({
            select: {
                id: true,
                code: true,
                name: true,
            },
            orderBy: [
                {
                    sortOrder: "asc",
                },
                {
                    name: "asc",
                },
            ],
        });
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

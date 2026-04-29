import type { PrismaClient } from "@prisma/client";

export type AdminAreaRecord = {
    id: bigint;
    parentId: bigint | null;
    adminLevelId: bigint;
    canonicalName: string;
    slug: string;
    isActive: boolean;
};

export class AdminAreasRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listAdminAreas(limit: number) {
        return this.prisma.coreAdminArea.findMany({
            where: {
                isActive: true,
            },
            select: {
                id: true,
                parentId: true,
                adminLevelId: true,
                canonicalName: true,
                slug: true,
                isActive: true,
            },
            orderBy: [
                {
                    canonicalName: "asc",
                },
            ],
            take: limit,
        });
    }
}

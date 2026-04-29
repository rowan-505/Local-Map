import type { PrismaClient } from "@prisma/client";

export type CategoryRecord = {
    id: bigint;
    parentId: bigint | null;
    code: string;
    name: string;
    sortOrder: number;
    isSearchable: boolean;
    isPublic: boolean;
};

export class CategoriesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listCategories() {
        return this.prisma.refPoiCategory.findMany({
            select: {
                id: true,
                parentId: true,
                code: true,
                name: true,
                sortOrder: true,
                isSearchable: true,
                isPublic: true,
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
}

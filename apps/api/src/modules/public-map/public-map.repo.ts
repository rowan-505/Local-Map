import { Prisma, type PrismaClient } from "@prisma/client";

type ListPublicPlacesParams = {
    q?: string;
    categoryId?: bigint;
    limit: number;
};

export type PublicPlaceRow = {
    id: bigint;
    public_id: string;
    display_name: string;
    primary_name: string;
    category_id: bigint;
    category_code: string | null;
    category_name: string | null;
    lat: number;
    lng: number;
    importance_score: number | null;
    is_verified: boolean;
};

export type PublicCategoryRow = {
    id: bigint;
    code: string;
    name: string;
    sortOrder: number;
};

export class PublicMapRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listPlaces(params: ListPublicPlacesParams): Promise<PublicPlaceRow[]> {
        const conditions = buildPublicPlaceConditions(params);

        return this.prisma.$queryRaw<PublicPlaceRow[]>(Prisma.sql`
            SELECT
                p.id,
                p.public_id,
                p.display_name,
                p.primary_name,
                p.category_id,
                c.code AS category_code,
                c.name AS category_name,
                p.lat,
                p.lng,
                p.importance_score::double precision AS importance_score,
                p.is_verified
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            WHERE ${Prisma.join(conditions, " AND ")}
            ORDER BY p.importance_score DESC, p.display_name ASC, p.public_id ASC
            LIMIT ${params.limit}
        `);
    }

    async getPlaceByPublicId(publicId: string): Promise<PublicPlaceRow | null> {
        const rows = await this.prisma.$queryRaw<PublicPlaceRow[]>(Prisma.sql`
            SELECT
                p.id,
                p.public_id,
                p.display_name,
                p.primary_name,
                p.category_id,
                c.code AS category_code,
                c.name AS category_name,
                p.lat,
                p.lng,
                p.importance_score::double precision AS importance_score,
                p.is_verified
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            WHERE p.public_id = CAST(${publicId} AS uuid)
              AND p.deleted_at IS NULL
              AND p.is_public = true
              AND p.lat IS NOT NULL
              AND p.lng IS NOT NULL
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async listCategories(): Promise<PublicCategoryRow[]> {
        return this.prisma.refPoiCategory.findMany({
            where: {
                isPublic: true,
                isSearchable: true,
            },
            select: {
                id: true,
                code: true,
                name: true,
                sortOrder: true,
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });
    }
}

function buildPublicPlaceConditions(params: ListPublicPlacesParams) {
    const conditions: Prisma.Sql[] = [
        Prisma.sql`p.deleted_at IS NULL`,
        Prisma.sql`p.is_public = true`,
        Prisma.sql`p.lat IS NOT NULL`,
        Prisma.sql`p.lng IS NOT NULL`,
    ];

    if (params.q) {
        const searchTerm = `%${params.q}%`;
        conditions.push(Prisma.sql`(
            p.display_name ILIKE ${searchTerm}
            OR p.primary_name ILIKE ${searchTerm}
            OR p.secondary_name ILIKE ${searchTerm}
            OR p.name_local ILIKE ${searchTerm}
        )`);
    }

    if (params.categoryId !== undefined) {
        conditions.push(Prisma.sql`p.category_id = ${params.categoryId}`);
    }

    return conditions;
}

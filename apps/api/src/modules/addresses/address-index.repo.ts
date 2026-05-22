import { Prisma, type PrismaClient } from "@prisma/client";

export type AddressIndexSearchRow = {
    address_id: bigint;
    public_id: string;
    language_code: string;
    search_text: string;
    display_address: string;
    house_number: string | null;
    street_text: string | null;
    admin_text: string | null;
    postcode: string | null;
    rank_score: number;
    match_priority: number;
    point_geom: unknown;
};

export class AddressIndexRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async refresh(addressIds: readonly bigint[] | null): Promise<bigint> {
        if (addressIds === null) {
            const rows = await this.prisma.$queryRaw<Array<{ refresh_address_index: bigint }>>`
                SELECT search.refresh_address_index(NULL::bigint[]) AS refresh_address_index
            `;
            return rows[0]?.refresh_address_index ?? BigInt(0);
        }

        if (addressIds.length === 0) {
            return BigInt(0);
        }

        const rows = await this.prisma.$queryRaw<Array<{ refresh_address_index: bigint }>>`
            SELECT search.refresh_address_index(${addressIds}::bigint[]) AS refresh_address_index
        `;
        return rows[0]?.refresh_address_index ?? BigInt(0);
    }

    async search(params: {
        q: string;
        lang: "en" | "my";
        limit: number;
        adminAreaId: bigint | null;
    }): Promise<AddressIndexSearchRow[]> {
        const q = params.q.trim();
        if (q.length < 1) {
            return [];
        }

        const pattern = `%${q}%`;
        const qLower = q.toLowerCase();
        const langFilter =
            params.lang === "my"
                ? Prisma.sql`ai.language_code IN ('my', 'und')`
                : Prisma.sql`ai.language_code IN ('en', 'und')`;

        const adminFilter =
            params.adminAreaId !== null
                ? Prisma.sql`AND ai.admin_area_id = ${params.adminAreaId}`
                : Prisma.empty;

        return this.prisma.$queryRaw<AddressIndexSearchRow[]>`
            SELECT
                ai.address_id,
                a.public_id::text AS public_id,
                ai.language_code,
                ai.search_text,
                coalesce(nullif(btrim(a.full_address), ''), ai.search_text) AS display_address,
                ai.house_number,
                ai.street_text,
                ai.admin_text,
                ai.postcode,
                ai.rank_score::float8 AS rank_score,
                (
                    CASE
                        WHEN ai.house_number IS NOT NULL
                             AND lower(ai.house_number) = ${qLower} THEN 0
                        WHEN ai.postcode IS NOT NULL
                             AND lower(ai.postcode) = ${qLower} THEN 1
                        WHEN ai.street_text IS NOT NULL
                             AND lower(ai.street_text) LIKE ${pattern} THEN 2
                        WHEN ai.search_text ILIKE ${pattern} THEN 3
                        WHEN ai.admin_text IS NOT NULL
                             AND lower(ai.admin_text) LIKE ${pattern} THEN 4
                        ELSE 5
                    END
                )::int AS match_priority,
                CASE
                    WHEN ai.point_geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(ai.point_geom)::json
                END AS point_geom
            FROM search.address_index AS ai
            INNER JOIN core.core_addresses AS a
                ON a.id = ai.address_id AND a.deleted_at IS NULL
            WHERE ${langFilter}
              ${adminFilter}
              AND (
                  ai.search_text ILIKE ${pattern}
                  OR ai.house_number ILIKE ${pattern}
                  OR ai.street_text ILIKE ${pattern}
                  OR ai.admin_text ILIKE ${pattern}
                  OR ai.postcode ILIKE ${pattern}
                  OR ${qLower} = ANY (ai.search_tokens)
              )
            ORDER BY match_priority ASC, ai.rank_score DESC, ai.search_text ASC
            LIMIT ${params.limit}
        `;
    }
}

import { Prisma, type PrismaClient } from "@prisma/client";

import { roadTownshipAdminLevelWhereSql } from "./admin-areas.road-township-level.js";

export type AdminAreaRecord = {
    id: bigint;
    parentId: bigint | null;
    adminLevelId: bigint;
    canonicalName: string;
    slug: string;
    isActive: boolean;
};

export type AdminAreaOptionRow = {
    id: bigint;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_id: bigint;
    admin_level_code: string;
    admin_level_name: string | null;
    parent_id: bigint | null;
    parent_label: string | null;
    boundary_status: string | null;
    address_usage: string | null;
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

    async listAdminAreaOptions(args: {
        limit: number;
        q?: string | undefined;
        adminLevelCode?: "township";
    }): Promise<AdminAreaOptionRow[]> {
        const pattern = args.q?.trim() ? `%${args.q.trim()}%` : null;

        const searchClause =
            pattern === null
                ? Prisma.empty
                : Prisma.sql`
                      AND (
                          a.canonical_name ILIKE ${pattern}
                          OR coalesce(an_mm.name, '') ILIKE ${pattern}
                          OR coalesce(an_en.name, '') ILIKE ${pattern}
                          OR a.slug ILIKE ${pattern}
                      )
                  `;

        const townshipOnlyClause =
            args.adminLevelCode === "township"
                ? Prisma.sql`
                      AND (
                          lower(btrim(al.code)) IN ('township', 'town')
                          OR lower(btrim(al.name)) IN ('township', 'town')
                      )
                  `
                : Prisma.empty;

        return this.prisma.$queryRaw<AdminAreaOptionRow[]>`
            SELECT
                a.id,
                a.canonical_name,
                an_mm.name AS name_mm,
                an_en.name AS name_en,
                a.admin_level_id,
                al.code AS admin_level_code,
                al.name AS admin_level_name,
                a.parent_id,
                COALESCE(
                    NULLIF(trim(parent_mm.name), ''),
                    NULLIF(trim(parent_en.name), ''),
                    NULLIF(trim(parent.canonical_name), '')
                ) AS parent_label,
                a.boundary_status,
                a.address_usage
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al
                ON al.id = a.admin_level_id
            LEFT JOIN core.core_admin_areas AS parent
                ON parent.id = a.parent_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = parent.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
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
            ) AS parent_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = parent.id
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
            ) AS parent_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
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
              AND a.deleted_at IS NULL
              AND a.address_usage <> 'disabled'
            ${townshipOnlyClause}
            ${searchClause}
            ORDER BY a.canonical_name ASC
            LIMIT ${args.limit}
        `;
    }

    /**
     * Road/street manual township override search: active townships only, ranked matches, capped results.
     */
    async searchRoadTownshipAdminAreaOptions(args: {
        q: string;
        limit: number;
    }): Promise<AdminAreaOptionRow[]> {
        const q = args.q.trim();
        const pattern = `%${q}%`;
        const isNumericId = /^\d+$/.test(q);
        const numericId = isNumericId ? BigInt(q) : null;
        const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q);

        const idMatchClause =
            numericId !== null ? Prisma.sql`OR a.id = ${numericId}` : Prisma.empty;

        const publicIdMatchClause = isUuid
            ? Prisma.sql`OR lower(a.public_id::text) = lower(${q})`
            : Prisma.empty;

        const orderRankSql =
            numericId !== null
                ? Prisma.sql`
                      CASE
                          WHEN a.id = ${numericId} THEN 0
                          WHEN ${isUuid} AND lower(a.public_id::text) = lower(${q}) THEN 1
                          WHEN a.external_id IS NOT NULL AND lower(btrim(a.external_id)) = lower(${q}) THEN 2
                          WHEN lower(btrim(a.slug)) = lower(${q}) THEN 3
                          ELSE 4
                      END
                  `
                : Prisma.sql`
                      CASE
                          WHEN ${isUuid} AND lower(a.public_id::text) = lower(${q}) THEN 0
                          WHEN a.external_id IS NOT NULL AND lower(btrim(a.external_id)) = lower(${q}) THEN 1
                          WHEN lower(btrim(a.slug)) = lower(${q}) THEN 2
                          ELSE 3
                      END
                  `;

        return this.prisma.$queryRaw<AdminAreaOptionRow[]>`
            SELECT
                a.id,
                a.canonical_name,
                an_mm.name AS name_mm,
                an_en.name AS name_en,
                a.admin_level_id,
                al.code AS admin_level_code,
                al.name AS admin_level_name,
                a.parent_id,
                COALESCE(
                    NULLIF(trim(parent_mm.name), ''),
                    NULLIF(trim(parent_en.name), ''),
                    NULLIF(trim(parent.canonical_name), '')
                ) AS parent_label,
                a.boundary_status,
                a.address_usage
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al
                ON al.id = a.admin_level_id
            LEFT JOIN core.core_admin_areas AS parent
                ON parent.id = a.parent_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = parent.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
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
            ) AS parent_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = parent.id
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
            ) AS parent_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
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
              AND a.deleted_at IS NULL
              AND a.address_usage <> 'disabled'
              AND ${roadTownshipAdminLevelWhereSql}
              AND (
                  a.canonical_name ILIKE ${pattern}
                  OR lower(btrim(coalesce(a.slug, ''))) = lower(${q})
                  OR coalesce(a.slug, '') ILIKE ${pattern}
                  OR (a.external_id IS NOT NULL AND (
                      lower(btrim(a.external_id)) = lower(${q})
                      OR a.external_id ILIKE ${pattern}
                  ))
                  ${idMatchClause}
                  ${publicIdMatchClause}
                  OR EXISTS (
                      SELECT 1
                      FROM core.core_admin_area_names AS n
                      WHERE n.admin_area_id = a.id
                        AND lower(trim(coalesce(n.language_code, ''))) = 'my'
                        AND n.name ILIKE ${pattern}
                  )
                  OR EXISTS (
                      SELECT 1
                      FROM core.core_admin_area_names AS n
                      WHERE n.admin_area_id = a.id
                        AND lower(trim(coalesce(n.language_code, ''))) = 'en'
                        AND n.name ILIKE ${pattern}
                  )
              )
            ORDER BY
                ${orderRankSql},
                a.canonical_name ASC
            LIMIT ${args.limit}
        `;
    }

    async getActiveAdminAreaById(id: bigint): Promise<AdminAreaOptionRow | null> {
        const found = await this.prisma.$queryRaw<AdminAreaOptionRow[]>`
            SELECT
                a.id,
                a.canonical_name,
                an_mm.name AS name_mm,
                an_en.name AS name_en,
                a.admin_level_id,
                al.code AS admin_level_code,
                al.name AS admin_level_name,
                a.parent_id,
                COALESCE(
                    NULLIF(trim(parent_mm.name), ''),
                    NULLIF(trim(parent_en.name), ''),
                    NULLIF(trim(parent.canonical_name), '')
                ) AS parent_label,
                a.boundary_status,
                a.address_usage
            FROM core.core_admin_areas AS a
            INNER JOIN ref.ref_admin_levels AS al
                ON al.id = a.admin_level_id
            LEFT JOIN core.core_admin_areas AS parent
                ON parent.id = a.parent_id
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = parent.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
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
            ) AS parent_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = parent.id
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
            ) AS parent_en ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM core.core_admin_area_names AS n
                WHERE n.admin_area_id = a.id
                  AND (
                      lower(trim(coalesce(n.language_code, ''))) = 'my'
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
            WHERE a.id = ${id}
              AND a.is_active = true
              AND a.deleted_at IS NULL
            LIMIT 1
        `;
        return found[0] ?? null;
    }

    async hasActiveAdminArea(id: bigint): Promise<boolean> {
        const row = await this.getActiveAdminAreaById(id);
        return row !== null;
    }
}

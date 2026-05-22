import { Prisma, type PrismaClient } from "@prisma/client";

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

    async listAdminAreaOptions(args: { limit: number; q?: string | undefined }): Promise<AdminAreaOptionRow[]> {
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
                      lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
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
                      lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
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
            ${searchClause}
            ORDER BY a.canonical_name ASC
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
                      lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
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
                      lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
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

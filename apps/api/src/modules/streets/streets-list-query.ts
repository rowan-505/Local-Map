import { Prisma } from "@prisma/client";

export type StreetsListSearchInput = {
    trimmed: string;
    textPattern: string;
    numericId: bigint | null;
    publicIdPattern: string | null;
};

/** Parse core-review streets list search text (trimmed, non-empty). */
export function parseStreetsListSearchInput(q: string): StreetsListSearchInput {
    const trimmed = q.trim();
    const textPattern = `%${trimmed}%`;
    const isNumericId = /^\d+$/.test(trimmed);
    const numericId = isNumericId ? BigInt(trimmed) : null;
    const publicIdPattern = trimmed.length > 0 ? textPattern : null;

    return {
        trimmed,
        textPattern,
        numericId,
        publicIdPattern,
    };
}

/** Streets core-review text search — id/public_id/canonical/names only. */
export function streetsCoreReviewTextSearchClause(q: string): Prisma.Sql {
    const parsed = parseStreetsListSearchInput(q);

    const idMatchClause =
        parsed.numericId !== null ? Prisma.sql`OR s.id = ${parsed.numericId}` : Prisma.empty;

    const publicIdClause =
        parsed.publicIdPattern !== null
            ? Prisma.sql`OR s.public_id::text ILIKE ${parsed.publicIdPattern}`
            : Prisma.empty;

    return Prisma.sql`(
        COALESCE(s.canonical_name, '') ILIKE ${parsed.textPattern}
        OR EXISTS (
            SELECT 1
            FROM core.core_street_names AS sn
            WHERE sn.street_id = s.id
              AND lower(trim(coalesce(sn.language_code, ''))) = 'my'
              AND sn.name ILIKE ${parsed.textPattern}
        )
        OR EXISTS (
            SELECT 1
            FROM core.core_street_names AS sn
            WHERE sn.street_id = s.id
              AND lower(trim(coalesce(sn.language_code, ''))) = 'en'
              AND sn.name ILIKE ${parsed.textPattern}
        )
        ${idMatchClause}
        ${publicIdClause}
    )`;
}

/** Roads list admin_area_id filter — only active township-level admin areas. */
export function streetsTownshipAdminAreaFilterClause(adminAreaId: bigint): Prisma.Sql {
    return Prisma.sql`(
        s.admin_area_id = ${adminAreaId}
        AND EXISTS (
            SELECT 1
            FROM core.core_admin_areas AS aa
            INNER JOIN ref.ref_admin_levels AS al ON al.id = aa.admin_level_id
            WHERE aa.id = ${adminAreaId}
              AND aa.is_active IS TRUE
              AND aa.deleted_at IS NULL
              AND lower(btrim(al.code)) IN ('township', 'town')
        )
    )`;
}

export type StreetsCoreReviewSortColumn =
    | "name"
    | "admin_area"
    | "created"
    | "created_at"
    | "updated"
    | "updated_at"
    | "id";

const STREETS_CORE_REVIEW_SORT_COLUMNS = new Set<StreetsCoreReviewSortColumn>([
    "name",
    "admin_area",
    "created",
    "created_at",
    "updated",
    "updated_at",
    "id",
]);

export function resolveStreetsCoreReviewSortColumn(
    sortBy: string | undefined,
    defaultSort: StreetsCoreReviewSortColumn = "updated_at",
): StreetsCoreReviewSortColumn {
    const raw = (sortBy?.trim() || defaultSort) as StreetsCoreReviewSortColumn;
    return STREETS_CORE_REVIEW_SORT_COLUMNS.has(raw) ? raw : defaultSort;
}

export function streetsCoreReviewOrderBy(
    sortBy: StreetsCoreReviewSortColumn,
    sortOrder: "asc" | "desc",
): Prisma.Sql {
    const dir = sortOrder === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

    switch (sortBy) {
        case "name":
            return Prisma.sql`LOWER(COALESCE(s.canonical_name, '')) ${dir} NULLS LAST, s.id ${dir}`;
        case "admin_area":
            return Prisma.sql`LOWER(COALESCE(aa.canonical_name, '')) ${dir} NULLS LAST, s.id ${dir}`;
        case "created":
        case "created_at":
            return Prisma.sql`s.created_at ${dir} NULLS LAST, s.id ${dir}`;
        case "id":
            return Prisma.sql`s.id ${dir}, s.public_id ASC`;
        case "updated":
        case "updated_at":
            return Prisma.sql`s.updated_at ${dir} NULLS LAST, s.id ${dir}`;
        default:
            return Prisma.sql`s.updated_at DESC NULLS LAST, s.id DESC`;
    }
}

export function streetsCoreReviewUpdatedAtKeysetOrderBy(sortOrder: "asc" | "desc"): Prisma.Sql {
    const dir = sortOrder === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    return Prisma.sql`s.updated_at ${dir}, s.id ${dir}`;
}

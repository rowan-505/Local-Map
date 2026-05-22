import { Prisma, type PrismaClient } from "@prisma/client";

import {
    coreReviewListStatusClause,
    type CoreReviewListStatus,
} from "../core-review-list-status.js";
import { getCoreReviewLifecycleConfig } from "../core-review-lifecycle.config.js";
import type { CoreReviewEntityListParams } from "../core-review-entities.repo.js";

export type CoreAddressComponentRowDb = {
    id: bigint;
    address_id: bigint;
    component_type_code: string;
    component_value: string;
    language_code: string;
    sort_order: number | null;
    confidence_score: unknown;
    match_type: string | null;
    source_admin_area_id: bigint | null;
    boundary_status: string | null;
    address_usage: string | null;
    source_refs: unknown;
};

export type CoreReviewAddressListRowDb = {
    id: bigint;
    public_id: string;
    cached_full_address: string | null;
    house_number: string | null;
    unit_number: string | null;
    postal_code: string | null;
    street_id: bigint | null;
    street_public_id: string | null;
    street_name_en: string | null;
    street_name_my: string | null;
    admin_area_id: bigint | null;
    admin_area_canonical_name: string | null;
    admin_area_name_en: string | null;
    admin_area_name_my: string | null;
    is_public: boolean;
    is_verified: boolean;
    confidence_score: unknown;
    source_type_id: bigint | null;
    source_refs: unknown;
    normalized_data: unknown;
    created_at: Date;
    updated_at: Date;
    geometry: unknown;
    entrance_geometry: unknown;
};

export type CoreReviewAddressDetailRowDb = CoreReviewAddressListRowDb;

const ADDRESS_LIFECYCLE = getCoreReviewLifecycleConfig("addresses");

const STREET_NAME_JOINS = Prisma.sql`
    LEFT JOIN core.core_streets AS s ON s.id = a.street_id
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_street_names AS n
        WHERE n.street_id = s.id
          AND lower(trim(coalesce(n.language_code, ''))) = 'en'
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS sn_en ON true
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_street_names AS n
        WHERE n.street_id = s.id
          AND lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS sn_my ON true
`;

const ADMIN_NAME_JOINS = Prisma.sql`
    LEFT JOIN core.core_admin_areas AS aa ON aa.id = a.admin_area_id
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_admin_area_names AS n
        WHERE n.admin_area_id = aa.id
          AND lower(trim(coalesce(n.language_code, ''))) = 'en'
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS an_en ON true
    LEFT JOIN LATERAL (
        SELECT n.name
        FROM core.core_admin_area_names AS n
        WHERE n.admin_area_id = aa.id
          AND lower(trim(coalesce(n.language_code, ''))) IN ('my', 'mm')
        ORDER BY n.is_primary DESC NULLS LAST, n.name ASC
        LIMIT 1
    ) AS an_mm ON true
`;

const ADDRESS_SELECT = Prisma.sql`
    a.id,
    a.public_id::text AS public_id,
    a.full_address AS cached_full_address,
    a.house_number,
    a.unit_number,
    coalesce(a.postal_code, a.postcode) AS postal_code,
    a.street_id,
    s.public_id::text AS street_public_id,
    sn_en.name AS street_name_en,
    sn_my.name AS street_name_my,
    a.admin_area_id,
    aa.canonical_name AS admin_area_canonical_name,
    an_en.name AS admin_area_name_en,
    an_mm.name AS admin_area_name_my,
    a.is_public,
    a.is_verified,
    a.confidence_score,
    a.source_type_id,
    a.source_refs,
    a.normalized_data,
    a.created_at,
    a.updated_at,
    CASE WHEN a.point_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(a.point_geom)::json END AS geometry,
    CASE WHEN a.entrance_geom IS NULL THEN NULL ELSE ST_AsGeoJSON(a.entrance_geom)::json END AS entrance_geometry
`;

function sortDir(order: "asc" | "desc"): Prisma.Sql {
    return order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
}

function verifiedClause(isVerified?: boolean): Prisma.Sql {
    if (isVerified === undefined) {
        return Prisma.empty;
    }
    return Prisma.sql`AND a.is_verified = ${isVerified}`;
}

function adminAreaClause(adminAreaId?: bigint): Prisma.Sql {
    if (adminAreaId === undefined) {
        return Prisma.empty;
    }
    return Prisma.sql`AND a.admin_area_id = ${adminAreaId}`;
}

function isPublicClause(isPublic?: boolean): Prisma.Sql {
    if (isPublic === undefined) {
        return Prisma.empty;
    }
    return Prisma.sql`AND a.is_public = ${isPublic}`;
}

function statusClause(status?: CoreReviewListStatus): Prisma.Sql {
    return coreReviewListStatusClause("a", status ?? "active", ADDRESS_LIFECYCLE);
}

function searchClause(search?: string): Prisma.Sql {
    if (!search?.trim()) {
        return Prisma.empty;
    }
    const q = `%${search.trim()}%`;
    return Prisma.sql`
        AND (
            COALESCE(a.house_number, '') ILIKE ${q}
            OR COALESCE(a.unit_number, '') ILIKE ${q}
            OR COALESCE(a.full_address, '') ILIKE ${q}
            OR COALESCE(aa.canonical_name, '') ILIKE ${q}
            OR COALESCE(an_en.name, '') ILIKE ${q}
            OR COALESCE(an_mm.name, '') ILIKE ${q}
            OR COALESCE(sn_en.name, '') ILIKE ${q}
            OR COALESCE(sn_my.name, '') ILIKE ${q}
            OR EXISTS (
                SELECT 1
                FROM core.core_address_components AS ac
                WHERE ac.address_id = a.id
                  AND ac.component_value ILIKE ${q}
            )
        )
    `;
}

function orderClause(sortBy: string, sortOrder: "asc" | "desc"): Prisma.Sql {
    const dir = sortDir(sortOrder);
    switch (sortBy) {
        case "admin_area":
            return Prisma.sql`aa.canonical_name ${dir} NULLS LAST, a.updated_at DESC`;
        case "name":
            return Prisma.sql`a.full_address ${dir} NULLS LAST, a.house_number ${dir} NULLS LAST`;
        case "created":
        case "created_at":
            return Prisma.sql`a.created_at ${dir} NULLS LAST`;
        case "house_number":
            return Prisma.sql`a.house_number ${dir} NULLS LAST, a.updated_at DESC`;
        case "updated_at":
        case "updated":
        default:
            return Prisma.sql`a.updated_at ${dir} NULLS LAST`;
    }
}

export class CoreReviewAddressesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listAddresses(params: CoreReviewEntityListParams): Promise<CoreReviewAddressListRowDb[]> {
        return this.prisma.$queryRaw<CoreReviewAddressListRowDb[]>`
            SELECT ${ADDRESS_SELECT}
            FROM core.core_addresses AS a
            ${ADMIN_NAME_JOINS}
            ${STREET_NAME_JOINS}
            WHERE ${statusClause(params.status)}
              ${verifiedClause(params.isVerified)}
              ${adminAreaClause(params.adminAreaId)}
              ${isPublicClause(params.isPublic)}
              ${searchClause(params.search)}
            ORDER BY ${orderClause(params.sortBy, params.sortOrder)}, a.public_id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `;
    }

    async countAddresses(params: CoreReviewEntityListParams): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM core.core_addresses AS a
            ${ADMIN_NAME_JOINS}
            ${STREET_NAME_JOINS}
            WHERE ${statusClause(params.status)}
              ${verifiedClause(params.isVerified)}
              ${adminAreaClause(params.adminAreaId)}
              ${isPublicClause(params.isPublic)}
              ${searchClause(params.search)}
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async getAddressByPublicId(
        publicId: string,
        options: { anyStatus?: boolean } = {}
    ): Promise<CoreReviewAddressDetailRowDb | null> {
        const status = options.anyStatus
            ? Prisma.sql`TRUE`
            : statusClause("active");
        const rows = await this.prisma.$queryRaw<CoreReviewAddressDetailRowDb[]>`
            SELECT ${ADDRESS_SELECT}
            FROM core.core_addresses AS a
            ${ADMIN_NAME_JOINS}
            ${STREET_NAME_JOINS}
            WHERE a.public_id = CAST(${publicId} AS uuid)
              AND ${status}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async getAddressInternalId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM core.core_addresses WHERE public_id = CAST(${publicId} AS uuid) LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    async listComponentsByAddressIds(
        addressIds: readonly bigint[]
    ): Promise<CoreAddressComponentRowDb[]> {
        if (addressIds.length === 0) {
            return [];
        }
        return this.prisma.$queryRaw<CoreAddressComponentRowDb[]>`
            SELECT
                c.id,
                c.address_id,
                coalesce(c.component_type_code, rt.code) AS component_type_code,
                c.component_value,
                coalesce(c.language_code, 'und') AS language_code,
                c.sort_order,
                c.confidence_score,
                c.match_type,
                c.source_admin_area_id,
                c.boundary_status,
                c.address_usage,
                c.source_refs
            FROM core.core_address_components AS c
            LEFT JOIN ref.ref_address_component_types AS rt ON rt.id = c.component_type_id
            WHERE c.address_id = ANY(${addressIds}::bigint[])
            ORDER BY c.address_id ASC, coalesce(c.sort_order, 100) ASC, c.id ASC
        `;
    }
}

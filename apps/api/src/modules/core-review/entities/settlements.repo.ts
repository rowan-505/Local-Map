import { Prisma, type PrismaClient } from "@prisma/client";

import { geojsonSqlParam, pointGeomExpr } from "../../../lib/geo/postgis-geometry.js";
import { parseCoreReviewExactIdSearch } from "../core-review-id-search.js";
import { getCoreReviewLifecycleConfig } from "../core-review-lifecycle.config.js";
import type { CoreReviewListStatus } from "../core-review-list-status.js";
import { coreReviewListStatusClause } from "../core-review-list-status.js";
import {
    coreReviewVerificationFilterCondition,
    type CoreReviewVerificationStatus,
} from "../core-review-verification-filter.js";
import {
    effectiveVerificationStatusFromRow,
    isVerifiedFromVerificationStatus,
    pickCoreReviewVerificationWrite,
    resolveCoreReviewVerificationWrite,
} from "../core-review-verification-write.js";
import { CoreReviewValidationError } from "../core-review-write.errors.js";
import { pickTrimmedAlias } from "../core-review-write.helpers.js";
import { pickAlias, pickGeometry } from "../core-review-write.schema.js";
import {
    SETTLEMENT_DUPLICATE_NAME_SIMILARITY,
    SETTLEMENT_DUPLICATE_NEARBY_METERS,
    isSettlementTypeCode,
    type SettlementTypeCode,
} from "./settlements.constants.js";

const DASHBOARD_SOURCE_REFS = JSON.stringify({ source: "dashboard" });

export type CoreReviewSettlementsListParams = {
    limit: number;
    offset: number;
    search?: string;
    sortBy: string;
    sortOrder: "asc" | "desc";
    verificationStatus?: CoreReviewVerificationStatus;
    townshipId?: bigint;
    settlementType?: SettlementTypeCode;
    status?: CoreReviewListStatus;
};

export type CoreReviewSettlementRow = {
    id: string;
    public_id: string;
    settlement_type_id: string;
    settlement_type_code: string;
    settlement_type_name: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    township_id: string | null;
    township_name: string | null;
    population: number | null;
    importance_score: number | null;
    source_type_id: string | null;
    has_footprint: boolean;
    verification_status: string | null;
    is_verified: boolean;
    is_public: boolean;
    deleted_at: Date | string | null;
    created_at: Date | string | null;
    updated_at: Date | string | null;
    geometry: unknown;
    lat: number | null;
    lng: number | null;
};

export type SettlementDuplicateWarningRow = {
    public_id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    settlement_type_code: string;
    township_id: string | null;
    township_name: string | null;
    distance_m: number | null;
    name_similarity: number | null;
    same_township: boolean;
};

export type SettlementDuplicateWarningParams = {
    canonicalName?: string;
    nameMm?: string;
    nameEn?: string;
    lat: number;
    lng: number;
    townshipId?: bigint;
    excludePublicId?: string;
};

function sortDir(order: "asc" | "desc"): Prisma.Sql {
    return order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
}

function listStatusClause(status?: CoreReviewListStatus): Prisma.Sql {
    const config = getCoreReviewLifecycleConfig("settlements");
    return coreReviewListStatusClause("s", status ?? "active", config);
}

function settlementIdWhere(id: string): Prisma.Sql {
    const trimmed = id.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
        return Prisma.sql`s.public_id = CAST(${trimmed} AS uuid)`;
    }
    if (/^\d+$/.test(trimmed)) {
        return Prisma.sql`s.id = ${BigInt(trimmed)}`;
    }
    return Prisma.sql`FALSE`;
}

function settlementSelectSql(extraWhere = Prisma.empty): Prisma.Sql {
    return Prisma.sql`
        SELECT
            s.id::text AS id,
            s.public_id::text AS public_id,
            s.settlement_type_id::text AS settlement_type_id,
            st.code AS settlement_type_code,
            st.name AS settlement_type_name,
            s.canonical_name,
            s.name_mm,
            s.name_en,
            s.township_id::text AS township_id,
            tw.canonical_name AS township_name,
            s.population,
            s.importance_score::float8 AS importance_score,
            s.source_type_id::text AS source_type_id,
            (s.footprint_geom IS NOT NULL) AS has_footprint,
            s.verification_status,
            s.is_verified,
            s.is_public,
            s.deleted_at,
            s.created_at,
            s.updated_at,
            ST_AsGeoJSON(s.point_geom)::json AS geometry,
            ST_Y(s.point_geom)::float8 AS lat,
            ST_X(s.point_geom)::float8 AS lng
        FROM core.core_settlements AS s
        INNER JOIN ref.ref_settlement_types AS st ON st.id = s.settlement_type_id
        LEFT JOIN core.core_admin_areas AS tw ON tw.id = s.township_id
        WHERE ${extraWhere}
    `;
}

function listFilters(params: CoreReviewSettlementsListParams): Prisma.Sql {
    const parts: Prisma.Sql[] = [listStatusClause(params.status)];

    if (params.search) {
        const exactId = parseCoreReviewExactIdSearch(params.search);
        if (exactId.numericId !== null) {
            parts.push(Prisma.sql`s.id = ${exactId.numericId}`);
        } else if (exactId.publicId) {
            parts.push(Prisma.sql`s.public_id = CAST(${exactId.publicId} AS uuid)`);
        } else {
            const q = `%${params.search}%`;
            parts.push(Prisma.sql`(
                s.canonical_name ILIKE ${q}
                OR COALESCE(s.name_mm, '') ILIKE ${q}
                OR COALESCE(s.name_en, '') ILIKE ${q}
                OR COALESCE(tw.canonical_name, '') ILIKE ${q}
                OR COALESCE(st.name, '') ILIKE ${q}
                OR COALESCE(st.code, '') ILIKE ${q}
            )`);
        }
    }

    const verificationCondition = coreReviewVerificationFilterCondition("s", params);
    if (verificationCondition) {
        parts.push(verificationCondition);
    }
    if (params.townshipId !== undefined) {
        parts.push(Prisma.sql`s.township_id = ${params.townshipId}`);
    }
    if (params.settlementType) {
        parts.push(Prisma.sql`st.code = ${params.settlementType}`);
    }

    return Prisma.join(parts, " AND ");
}

function listOrder(params: CoreReviewSettlementsListParams): Prisma.Sql {
    switch (params.sortBy) {
        case "name":
            return Prisma.sql`LOWER(s.canonical_name) ${sortDir(params.sortOrder)} NULLS LAST`;
        case "settlement_type":
        case "type":
            return Prisma.sql`st.sort_order ${sortDir(params.sortOrder)}, LOWER(s.canonical_name) ASC`;
        case "township":
        case "admin_area":
            return Prisma.sql`LOWER(COALESCE(tw.canonical_name, '')) ${sortDir(params.sortOrder)} NULLS LAST`;
        case "created":
        case "created_at":
            return Prisma.sql`s.created_at ${sortDir(params.sortOrder)} NULLS LAST`;
        case "updated":
        case "updated_at":
        default:
            return Prisma.sql`s.updated_at ${sortDir(params.sortOrder)} NULLS LAST`;
    }
}

function nullableTrimmedFromBody(
    body: Record<string, unknown>,
    camel: string,
    snake: string,
): string | null | undefined {
    if (body[camel] === undefined && body[snake] === undefined) {
        return undefined;
    }
    return pickTrimmedAlias(body, camel, snake) ?? null;
}

function requirePointGeometry(body: Record<string, unknown>): unknown {
    const geom = pickGeometry(body);
    if (!geom || typeof geom !== "object" || Array.isArray(geom)) {
        throw new CoreReviewValidationError("point geometry is required", [
            { path: "geometry", message: "Click the map to set a location" },
        ]);
    }
    const g = geom as { type?: unknown };
    if (g.type !== "Point") {
        throw new CoreReviewValidationError("geometry must be a Point", [
            { path: "geometry", message: "Settlements use a point, not a polygon" },
        ]);
    }
    return geom;
}

export class CoreReviewSettlementsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listSettlements(params: CoreReviewSettlementsListParams): Promise<CoreReviewSettlementRow[]> {
        return this.prisma.$queryRaw<CoreReviewSettlementRow[]>`
            ${settlementSelectSql(listFilters(params))}
            ORDER BY ${listOrder(params)}, s.id DESC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `;
    }

    async countSettlements(params: CoreReviewSettlementsListParams): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ total: bigint }[]>`
            SELECT COUNT(*)::bigint AS total
            FROM core.core_settlements AS s
            INNER JOIN ref.ref_settlement_types AS st ON st.id = s.settlement_type_id
            LEFT JOIN core.core_admin_areas AS tw ON tw.id = s.township_id
            WHERE ${listFilters(params)}
        `;
        return Number(rows[0]?.total ?? 0n);
    }

    async getSettlementById(
        id: string,
        options: { anyStatus?: boolean } = {},
    ): Promise<CoreReviewSettlementRow | null> {
        const statusClause = options.anyStatus ? Prisma.sql`TRUE` : listStatusClause("active");
        const rows = await this.prisma.$queryRaw<CoreReviewSettlementRow[]>`
            ${settlementSelectSql(Prisma.sql`${settlementIdWhere(id)} AND ${statusClause}`)}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    async resolveSettlementTypeId(
        body: Record<string, unknown>,
        required: boolean,
    ): Promise<bigint | undefined> {
        const typeId = pickAlias<bigint>(body, "settlementTypeId", "settlement_type_id");
        const typeCodeRaw =
            pickTrimmedAlias(body, "settlementType", "settlement_type") ??
            pickTrimmedAlias(body, "settlementTypeCode", "settlement_type_code");

        if (typeId !== undefined) {
            const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM ref.ref_settlement_types WHERE id = ${typeId} LIMIT 1
            `;
            if (rows.length === 0) {
                throw new CoreReviewValidationError("settlement_type_id is invalid", [
                    { path: "settlementTypeId", message: "Unknown settlement type" },
                ]);
            }
            return typeId;
        }

        if (typeCodeRaw) {
            const code = typeCodeRaw.trim().toLowerCase().replace(/[\s-]+/g, "_");
            if (!isSettlementTypeCode(code)) {
                throw new CoreReviewValidationError("settlement_type is invalid", [
                    { path: "settlementType", message: "Must be city, town, village, or local_area" },
                ]);
            }
            const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM ref.ref_settlement_types WHERE code = ${code} LIMIT 1
            `;
            if (!rows[0]) {
                throw new CoreReviewValidationError("settlement_type is invalid", [
                    { path: "settlementType", message: "Unknown settlement type" },
                ]);
            }
            return rows[0].id;
        }

        if (required) {
            throw new CoreReviewValidationError("settlement type is required", [
                { path: "settlementType", message: "Required" },
            ]);
        }
        return undefined;
    }

    async createSettlement(body: Record<string, unknown>): Promise<string | null> {
        const geom = requirePointGeometry(body);
        const settlementTypeId = await this.resolveSettlementTypeId(body, true);
        const canonicalName = pickTrimmedAlias(body, "canonicalName", "canonical_name");
        if (!canonicalName) {
            throw new CoreReviewValidationError("canonical_name is required", [
                { path: "canonicalName", message: "Required" },
            ]);
        }

        const { verificationStatus, isVerified } = resolveCoreReviewVerificationWrite(body);
        const geojson = geojsonSqlParam(geom);
        const geomExpr = pointGeomExpr(geojson);
        const townshipId = pickAlias<bigint | null>(body, "townshipId", "township_id") ?? null;
        const sourceTypeId = pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id") ?? null;
        const population = pickAlias<number | null>(body, "population", "population") ?? null;
        const nameMm = pickTrimmedAlias(body, "nameMm", "name_mm") ?? null;
        const nameEn = pickTrimmedAlias(body, "nameEn", "name_en") ?? null;

        const rows = await this.prisma.$queryRaw<{ public_id: string }[]>`
            INSERT INTO core.core_settlements (
                settlement_type_id,
                canonical_name,
                name_mm,
                name_en,
                point_geom,
                township_id,
                population,
                source_type_id,
                source_refs,
                is_public,
                is_verified,
                verification_status,
                created_at,
                updated_at
            ) VALUES (
                ${settlementTypeId},
                ${canonicalName},
                ${nameMm},
                ${nameEn},
                ${geomExpr},
                ${townshipId},
                ${population},
                ${sourceTypeId},
                ${DASHBOARD_SOURCE_REFS}::jsonb,
                true,
                ${isVerified},
                ${verificationStatus},
                now(),
                now()
            )
            RETURNING public_id::text AS public_id
        `;
        return rows[0]?.public_id ?? null;
    }

    async updateSettlement(id: string, body: Record<string, unknown>): Promise<boolean> {
        const existing = await this.getSettlementById(id, { anyStatus: true });
        if (!existing) {
            return false;
        }

        const sets: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];

        if (
            pickAlias(body, "settlementTypeId", "settlement_type_id") !== undefined ||
            pickTrimmedAlias(body, "settlementType", "settlement_type") !== undefined ||
            pickTrimmedAlias(body, "settlementTypeCode", "settlement_type_code") !== undefined
        ) {
            const typeId = await this.resolveSettlementTypeId(body, true);
            sets.push(Prisma.sql`settlement_type_id = ${typeId}`);
        }

        const canonicalName = nullableTrimmedFromBody(body, "canonicalName", "canonical_name");
        if (canonicalName !== undefined) {
            if (!canonicalName) {
                throw new CoreReviewValidationError("canonical_name cannot be empty", [
                    { path: "canonicalName", message: "Required" },
                ]);
            }
            sets.push(Prisma.sql`canonical_name = ${canonicalName}`);
        }

        const nameMm = nullableTrimmedFromBody(body, "nameMm", "name_mm");
        if (nameMm !== undefined) {
            sets.push(Prisma.sql`name_mm = ${nameMm}`);
        }
        const nameEn = nullableTrimmedFromBody(body, "nameEn", "name_en");
        if (nameEn !== undefined) {
            sets.push(Prisma.sql`name_en = ${nameEn}`);
        }

        if (
            body.townshipId !== undefined ||
            body.township_id !== undefined ||
            body.adminAreaId !== undefined ||
            body.admin_area_id !== undefined
        ) {
            const townshipId =
                pickAlias<bigint | null>(body, "townshipId", "township_id") ??
                pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ??
                null;
            sets.push(Prisma.sql`township_id = ${townshipId}`);
        }

        if (body.population !== undefined) {
            const population = pickAlias<number | null>(body, "population", "population") ?? null;
            sets.push(Prisma.sql`population = ${population}`);
        }

        if (pickAlias(body, "sourceTypeId", "source_type_id") !== undefined) {
            const sourceTypeId = pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id") ?? null;
            sets.push(Prisma.sql`source_type_id = ${sourceTypeId}`);
        }

        const geom = pickGeometry(body);
        if (geom !== undefined && geom !== null) {
            const point = requirePointGeometry(body);
            const geojson = geojsonSqlParam(point);
            sets.push(Prisma.sql`point_geom = ${pointGeomExpr(geojson)}`);
        }

        const verification = pickCoreReviewVerificationWrite(body);
        if (verification) {
            sets.push(Prisma.sql`verification_status = ${verification.verificationStatus}`);
            sets.push(Prisma.sql`is_verified = ${verification.isVerified}`);
        }

        if (sets.length <= 1) {
            return true;
        }

        const updated = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE core.core_settlements AS s
            SET ${Prisma.join(sets, ", ")}
            WHERE ${settlementIdWhere(id)}
        `);
        return Number(updated) > 0;
    }

    async findDuplicateWarnings(
        params: SettlementDuplicateWarningParams,
    ): Promise<SettlementDuplicateWarningRow[]> {
        const names = [params.canonicalName, params.nameMm, params.nameEn]
            .map((value) => value?.trim())
            .filter((value): value is string => Boolean(value));
        const primaryName = names[0] ?? "";
        const like = primaryName ? `%${primaryName}%` : "";
        const townshipId = params.townshipId ?? null;
        const excludePublicId = params.excludePublicId?.trim() || null;

        return this.prisma.$queryRaw<SettlementDuplicateWarningRow[]>`
            SELECT
                s.public_id::text AS public_id,
                s.canonical_name,
                s.name_mm,
                s.name_en,
                st.code AS settlement_type_code,
                s.township_id::text AS township_id,
                tw.canonical_name AS township_name,
                ST_Distance(
                    s.point_geom::geography,
                    ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography
                )::float8 AS distance_m,
                CASE
                    WHEN ${primaryName} = '' THEN NULL
                    ELSE GREATEST(
                        similarity(lower(s.canonical_name), lower(${primaryName})),
                        similarity(lower(COALESCE(s.name_mm, '')), lower(${primaryName})),
                        similarity(lower(COALESCE(s.name_en, '')), lower(${primaryName}))
                    )::float8
                END AS name_similarity,
                (${townshipId}::bigint IS NOT NULL AND s.township_id IS NOT DISTINCT FROM ${townshipId}::bigint) AS same_township
            FROM core.core_settlements AS s
            INNER JOIN ref.ref_settlement_types AS st ON st.id = s.settlement_type_id
            LEFT JOIN core.core_admin_areas AS tw ON tw.id = s.township_id
            WHERE s.deleted_at IS NULL
              AND (
                    ${excludePublicId}::text IS NULL
                    OR s.public_id::text <> ${excludePublicId}
                  )
              AND (
                    ST_DWithin(
                        s.point_geom::geography,
                        ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography,
                        ${SETTLEMENT_DUPLICATE_NEARBY_METERS}
                    )
                    OR (
                        ${primaryName} <> ''
                        AND (
                            s.canonical_name ILIKE ${like}
                            OR COALESCE(s.name_mm, '') ILIKE ${like}
                            OR COALESCE(s.name_en, '') ILIKE ${like}
                            OR similarity(lower(s.canonical_name), lower(${primaryName}))
                                >= ${SETTLEMENT_DUPLICATE_NAME_SIMILARITY}
                        )
                        AND ${townshipId}::bigint IS NOT NULL
                        AND s.township_id IS NOT DISTINCT FROM ${townshipId}::bigint
                    )
                  )
            ORDER BY
                ST_Distance(
                    s.point_geom::geography,
                    ST_SetSRID(ST_MakePoint(${params.lng}, ${params.lat}), 4326)::geography
                ) ASC NULLS LAST,
                s.updated_at DESC
            LIMIT 8
        `;
    }
}

export function serializeCoreReviewSettlement(row: CoreReviewSettlementRow) {
    const verificationStatus = effectiveVerificationStatusFromRow(row);
    return {
        id: row.id,
        publicId: row.public_id,
        settlementTypeId: row.settlement_type_id,
        settlementTypeCode: row.settlement_type_code,
        settlementTypeName: row.settlement_type_name,
        canonicalName: row.canonical_name,
        nameMm: row.name_mm,
        nameEn: row.name_en,
        townshipId: row.township_id,
        townshipName: row.township_name,
        adminAreaId: row.township_id,
        adminAreaName: row.township_name,
        population: row.population,
        importanceScore: row.importance_score,
        sourceTypeId: row.source_type_id,
        hasFootprint: row.has_footprint,
        verificationStatus,
        isVerified: isVerifiedFromVerificationStatus(verificationStatus),
        isPublic: row.is_public,
        deletedAt: row.deleted_at ? String(row.deleted_at) : null,
        createdAt: row.created_at ? String(row.created_at) : null,
        updatedAt: row.updated_at ? String(row.updated_at) : null,
        geometry: row.geometry,
        lat: row.lat,
        lng: row.lng,
    };
}

export function serializeSettlementDuplicateWarning(row: SettlementDuplicateWarningRow) {
    return {
        publicId: row.public_id,
        canonicalName: row.canonical_name,
        nameMm: row.name_mm,
        nameEn: row.name_en,
        settlementTypeCode: row.settlement_type_code,
        townshipId: row.township_id,
        townshipName: row.township_name,
        distanceM: row.distance_m == null ? null : Math.round(row.distance_m),
        nameSimilarity: row.name_similarity,
        sameTownship: row.same_township,
    };
}

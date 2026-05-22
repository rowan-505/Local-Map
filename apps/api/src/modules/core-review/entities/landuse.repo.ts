import { Prisma, type PrismaClient, type Prisma as PrismaNamespace } from "@prisma/client";

import {
    landuseNameLabelSelectSql,
    mapLanduseNameFields,
} from "../../../lib/entity-names/landuse-detail-select-sql.js";
import {
    syncLanduseFeatureNames,
    type LanduseFeatureNameSlots,
} from "../../../lib/entity-names/sync-primary-names.js";
import {
    analyzePolygonGeometry,
    centroidFromGeomExpr,
    geojsonSqlParam,
    polygonGeomExpr,
} from "../../../lib/geo/postgis-geometry.js";
import { normalizePolygonGeoJsonForSave } from "../../../lib/geo/normalize-polygon-geojson.js";
import type { CoreReviewListStatus } from "../core-review-list-status.js";
import { coreReviewListStatusClause } from "../core-review-list-status.js";
import { getCoreReviewLifecycleConfig } from "../core-review-lifecycle.config.js";
import { CoreReviewValidationError } from "../core-review-write.errors.js";
import { pickAlias, pickGeometry } from "../core-review-write.schema.js";

const DASHBOARD_SOURCE_REFS = JSON.stringify({ source: "dashboard" });

export type CoreReviewLanduseListParams = {
    limit: number;
    offset: number;
    search?: string;
    sortBy: string;
    sortOrder: "asc" | "desc";
    isVerified?: boolean;
    adminAreaId?: bigint;
    landuseClassId?: bigint;
    detailLevel?: "zone" | "parcel";
    cropCode?: string;
    status?: CoreReviewListStatus;
};

export type CoreReviewLanduseRow = {
    id: string;
    public_id: string;
    external_id: string | null;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    name_und: string | null;
    class_code: string | null;
    landuse_class_id: string | null;
    landuse_class_code: string | null;
    landuse_class_name_en: string | null;
    landuse_class_name_mm: string | null;
    admin_area_id: string | null;
    admin_area_name: string | null;
    detail_level: string;
    crop_code: string | null;
    irrigated: boolean | null;
    seasonality: string | null;
    area_m2: number | null;
    confidence_score: number | null;
    manual_override: boolean;
    is_verified: boolean;
    is_active: boolean;
    deleted_at: Date | string | null;
    created_at: Date | string | null;
    updated_at: Date | string | null;
    geometry: unknown;
    centroid: unknown;
    source_tags: unknown;
    normalized_data: unknown;
    source_refs: unknown;
    source_staging_id: string | null;
};

type DbClient = PrismaClient | PrismaNamespace.TransactionClient;

function sortDir(order: "asc" | "desc"): Prisma.Sql {
    return order === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
}

function listStatusClause(status?: CoreReviewListStatus): Prisma.Sql {
    const config = getCoreReviewLifecycleConfig("landuse");
    return coreReviewListStatusClause("lu", status ?? "active", config);
}

function landuseIdWhere(id: string): Prisma.Sql {
    const trimmed = id.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)) {
        return Prisma.sql`lu.public_id = CAST(${trimmed} AS uuid)`;
    }
    if (/^\d+$/.test(trimmed)) {
        return Prisma.sql`lu.id = ${BigInt(trimmed)}`;
    }
    return Prisma.sql`FALSE`;
}

function landuseSelectSql(extraWhere = Prisma.empty): Prisma.Sql {
    return Prisma.sql`
        SELECT
            lu.id::text AS id,
            lu.public_id::text AS public_id,
            lu.external_id,
            ${landuseNameLabelSelectSql},
            lu.class_code,
            lu.landuse_class_id::text AS landuse_class_id,
            lc.code AS landuse_class_code,
            lc.name_en AS landuse_class_name_en,
            lc.name_mm AS landuse_class_name_mm,
            lu.admin_area_id::text AS admin_area_id,
            aa.canonical_name AS admin_area_name,
            lu.detail_level,
            lu.crop_code,
            lu.irrigated,
            lu.seasonality,
            lu.area_m2::float8 AS area_m2,
            lu.confidence_score::float8 AS confidence_score,
            lu.manual_override,
            lu.is_verified,
            lu.is_active,
            lu.deleted_at,
            lu.created_at,
            lu.updated_at,
            ST_AsGeoJSON(lu.geom)::json AS geometry,
            ST_AsGeoJSON(lu.centroid)::json AS centroid,
            lu.source_tags,
            lu.normalized_data,
            lu.source_refs,
            lu.source_staging_id::text AS source_staging_id
        FROM core.core_map_landuse AS lu
        LEFT JOIN ref.ref_landuse_classes AS lc ON lc.id = lu.landuse_class_id
        LEFT JOIN core.core_admin_areas AS aa ON aa.id = lu.admin_area_id
        WHERE ${extraWhere}
    `;
}

function listFilters(params: CoreReviewLanduseListParams): Prisma.Sql {
    const parts: Prisma.Sql[] = [listStatusClause(params.status)];

    if (params.search) {
        const q = `%${params.search}%`;
        parts.push(Prisma.sql`(
            COALESCE(lu.name, '') ILIKE ${q}
            OR COALESCE(lu.class_code, '') ILIKE ${q}
            OR COALESCE(lc.name_en, '') ILIKE ${q}
            OR COALESCE(lc.name_mm, '') ILIKE ${q}
            OR COALESCE(lu.external_id, '') ILIKE ${q}
            OR EXISTS (
                SELECT 1 FROM core.core_map_landuse_names AS n
                WHERE n.landuse_id = lu.id AND n.name ILIKE ${q}
            )
        )`);
    }
    if (params.isVerified !== undefined) {
        parts.push(Prisma.sql`lu.is_verified = ${params.isVerified}`);
    }
    if (params.adminAreaId !== undefined) {
        parts.push(Prisma.sql`lu.admin_area_id = ${params.adminAreaId}`);
    }
    if (params.landuseClassId !== undefined) {
        parts.push(Prisma.sql`lu.landuse_class_id = ${params.landuseClassId}`);
    }
    if (params.detailLevel !== undefined) {
        parts.push(Prisma.sql`lu.detail_level = ${params.detailLevel}`);
    }
    if (params.cropCode !== undefined && params.cropCode.trim() !== "") {
        parts.push(Prisma.sql`lower(trim(lu.crop_code)) = lower(trim(${params.cropCode}))`);
    }

    return Prisma.join(parts, " AND ");
}

function listOrder(params: CoreReviewLanduseListParams): Prisma.Sql {
    switch (params.sortBy) {
        case "name":
            return Prisma.sql`LOWER(COALESCE(
                (SELECT n.name FROM core.core_map_landuse_names AS n
                 WHERE n.landuse_id = lu.id AND n.is_primary IS TRUE AND n.name_type = 'official'
                   AND lower(trim(n.language_code)) = 'en' LIMIT 1),
                lu.name, ''
            )) ${sortDir(params.sortOrder)} NULLS LAST`;
        case "class_code":
        case "landuse_class":
            return Prisma.sql`LOWER(COALESCE(lc.name_en, lc.code, lu.class_code, '')) ${sortDir(params.sortOrder)} NULLS LAST`;
        case "admin_area":
            return Prisma.sql`LOWER(COALESCE(aa.canonical_name, '')) ${sortDir(params.sortOrder)} NULLS LAST`;
        case "detail_level":
            return Prisma.sql`lu.detail_level ${sortDir(params.sortOrder)} NULLS LAST`;
        case "area_m2":
            return Prisma.sql`lu.area_m2 ${sortDir(params.sortOrder)} NULLS LAST`;
        case "confidence_score":
            return Prisma.sql`lu.confidence_score ${sortDir(params.sortOrder)} NULLS LAST`;
        case "created":
        case "created_at":
            return Prisma.sql`lu.created_at ${sortDir(params.sortOrder)} NULLS LAST`;
        default:
            return Prisma.sql`lu.updated_at ${sortDir(params.sortOrder)} NULLS LAST`;
    }
}

function clampConfidence(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.min(100, Math.max(0, n));
}

function pickNameSlots(body: Record<string, unknown>): LanduseFeatureNameSlots {
    const slots: LanduseFeatureNameSlots = {};
    if (pickAlias(body, "nameMm", "name_mm") !== undefined) {
        slots.name_mm = (pickAlias<string | null>(body, "nameMm", "name_mm") ?? null) as string | null;
    }
    if (pickAlias(body, "nameEn", "name_en") !== undefined) {
        slots.name_en = (pickAlias<string | null>(body, "nameEn", "name_en") ?? null) as string | null;
    }
    if (pickAlias(body, "nameUnd", "name_und") !== undefined) {
        slots.name_und = (pickAlias<string | null>(body, "nameUnd", "name_und") ?? null) as string | null;
    }
    return slots;
}

function legacyDisplayName(slots: LanduseFeatureNameSlots): string | null {
    const en = slots.name_en === undefined ? null : (slots.name_en?.trim() || null);
    const mm = slots.name_mm === undefined ? null : (slots.name_mm?.trim() || null);
    const und = slots.name_und === undefined ? null : (slots.name_und?.trim() || null);
    return en ?? mm ?? und ?? null;
}

export class CoreReviewLanduseRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async hasActiveLanduseClass(landuseClassId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM ref.ref_landuse_classes
            WHERE id = ${landuseClassId} AND is_active IS TRUE
            LIMIT 1
        `;
        return rows.length > 0;
    }

    async listLanduse(params: CoreReviewLanduseListParams): Promise<CoreReviewLanduseRow[]> {
        const where = listFilters(params);
        const rows = await this.prisma.$queryRaw<CoreReviewLanduseRow[]>`
            ${landuseSelectSql(where)}
            ORDER BY ${listOrder(params)}, lu.id ASC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `;
        return rows;
    }

    async countLanduse(params: CoreReviewLanduseListParams): Promise<number> {
        const where = listFilters(params);
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT COUNT(*)::bigint AS count
            FROM core.core_map_landuse AS lu
            LEFT JOIN ref.ref_landuse_classes AS lc ON lc.id = lu.landuse_class_id
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = lu.admin_area_id
            WHERE ${where}
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async getLanduseById(id: string, options: { anyStatus?: boolean } = {}): Promise<CoreReviewLanduseRow | null> {
        const statusClause = options.anyStatus ? Prisma.sql`TRUE` : listStatusClause("active");
        const rows = await this.prisma.$queryRaw<CoreReviewLanduseRow[]>`
            ${landuseSelectSql(Prisma.sql`${landuseIdWhere(id)} AND ${statusClause}`)}
            LIMIT 1
        `;
        return rows[0] ?? null;
    }

    private async validatePolygon(geojson: unknown): Promise<unknown> {
        const normalized = normalizePolygonGeoJsonForSave(geojson);
        const analysis = await analyzePolygonGeometry(this.prisma, geojsonSqlParam(normalized));
        if (!analysis?.allowed_type) {
            throw new CoreReviewValidationError("geometry must be Polygon or MultiPolygon", [
                { path: "geometry", message: "Invalid polygon type" },
            ]);
        }
        if (!analysis.is_valid) {
            throw new CoreReviewValidationError(analysis.invalid_reason ?? "Invalid polygon geometry", [
                { path: "geometry", message: analysis.invalid_reason ?? "Invalid polygon" },
            ]);
        }
        return normalized;
    }

    async createLanduse(body: Record<string, unknown>): Promise<string | null> {
        const geom = pickGeometry(body);
        if (!geom) {
            throw new CoreReviewValidationError("geometry is required", [
                { path: "geometry", message: "Required" },
            ]);
        }
        const landuseClassIdRaw =
            pickAlias<bigint>(body, "landuseClassId", "landuse_class_id") ??
            pickAlias<bigint>(body, "landuse_class_id", "landuse_class_id");
        if (landuseClassIdRaw === undefined) {
            throw new CoreReviewValidationError("landuse_class_id is required", [
                { path: "landuseClassId", message: "Required" },
            ]);
        }
        const landuseClassId = landuseClassIdRaw;
        if (!(await this.hasActiveLanduseClass(landuseClassId))) {
            throw new CoreReviewValidationError("landuse_class_id is invalid", [
                { path: "landuseClassId", message: "Invalid or inactive landuse class" },
            ]);
        }

        const detailLevel =
            (pickAlias<string>(body, "detailLevel", "detail_level") ?? "zone").trim() || "zone";
        if (detailLevel !== "zone" && detailLevel !== "parcel") {
            throw new CoreReviewValidationError("detail_level must be zone or parcel", [
                { path: "detailLevel", message: "Must be zone or parcel" },
            ]);
        }

        const normalizedGeom = await this.validatePolygon(geom);
        const geojson = geojsonSqlParam(normalizedGeom);
        const geomExpr = polygonGeomExpr(geojson);
        const confidence = clampConfidence(
            pickAlias(body, "confidenceScore", "confidence_score") ?? 90,
            90
        );

        const classCodeRow = await this.prisma.$queryRaw<{ code: string }[]>`
            SELECT code FROM ref.ref_landuse_classes WHERE id = ${landuseClassId} LIMIT 1
        `;
        const refCode = classCodeRow[0]?.code ?? null;
        let cropCode =
            (pickAlias<string | null>(body, "cropCode", "crop_code") ?? null)?.trim() || null;
        if (!cropCode && (refCode === "paddy" || refCode === "rice")) {
            cropCode = "rice";
        }

        const nameSlots: LanduseFeatureNameSlots = {
            name_mm: (pickAlias<string | null>(body, "nameMm", "name_mm") ?? null) as string | null,
            name_en: (pickAlias<string | null>(body, "nameEn", "name_en") ?? null) as string | null,
            name_und: (pickAlias<string | null>(body, "nameUnd", "name_und") ?? null) as string | null,
        };
        const legacyName = legacyDisplayName(nameSlots);

        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<{ public_id: string; id: bigint }[]>`
                INSERT INTO core.core_map_landuse (
                    source_staging_id, external_id,
                    public_id, name, class_code, landuse_class_id, admin_area_id,
                    geom, centroid, area_m2, confidence_score, manual_override,
                    source_tags, crop_code, irrigated, seasonality, detail_level,
                    is_active, is_verified, source_refs, normalized_data,
                    created_at, updated_at
                ) VALUES (
                    NULL, NULL,
                    gen_random_uuid(),
                    ${legacyName},
                    coalesce(
                        nullif(trim(${pickAlias(body, "classCode", "class_code") ?? refCode ?? ""}), ''),
                        ${refCode}
                    ),
                    ${landuseClassId},
                    ${pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ?? null},
                    ${geomExpr},
                    ${centroidFromGeomExpr(geomExpr)},
                    ST_Area(${geomExpr}::geography),
                    ${confidence},
                    true,
                    '{}'::jsonb,
                    ${cropCode},
                    ${pickAlias<boolean | null>(body, "irrigated", "irrigated") ?? null},
                    ${pickAlias<string | null>(body, "seasonality", "seasonality") ?? null},
                    ${detailLevel},
                    true,
                    ${Boolean(pickAlias(body, "isVerified", "is_verified") ?? false)},
                    ${DASHBOARD_SOURCE_REFS}::jsonb,
                    jsonb_build_object('source', 'dashboard'),
                    now(),
                    now()
                )
                RETURNING public_id::text AS public_id, id
            `;
            const row = rows[0];
            if (!row) {
                return null;
            }
            await syncLanduseFeatureNames(tx, row.id, nameSlots);
            return row.public_id;
        });
    }

    async updateLanduse(id: string, body: Record<string, unknown>): Promise<boolean> {
        const existing = await this.getLanduseById(id, { anyStatus: true });
        if (!existing) {
            return false;
        }

        const sets: Prisma.Sql[] = [];
        const internalId = BigInt(existing.id);

        if (pickAlias(body, "landuseClassId", "landuse_class_id") !== undefined) {
            const classId = pickAlias<bigint | null>(body, "landuseClassId", "landuse_class_id") ?? null;
            if (classId !== null && !(await this.hasActiveLanduseClass(classId))) {
                throw new CoreReviewValidationError("landuse_class_id is invalid", [
                    { path: "landuseClassId", message: "Invalid or inactive landuse class" },
                ]);
            }
            sets.push(Prisma.sql`landuse_class_id = ${classId}`);
            if (classId !== null) {
                sets.push(Prisma.sql`class_code = (
                    SELECT code FROM ref.ref_landuse_classes WHERE id = ${classId} LIMIT 1
                )`);
            }
        }
        if (pickAlias(body, "classCode", "class_code") !== undefined) {
            sets.push(Prisma.sql`class_code = ${pickAlias(body, "classCode", "class_code") ?? null}`);
        }
        if (pickAlias(body, "adminAreaId", "admin_area_id") !== undefined) {
            sets.push(
                Prisma.sql`admin_area_id = ${pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ?? null}`
            );
        }
        if (pickAlias(body, "confidenceScore", "confidence_score") !== undefined) {
            sets.push(
                Prisma.sql`confidence_score = ${clampConfidence(
                    pickAlias(body, "confidenceScore", "confidence_score"),
                    Number(existing.confidence_score ?? 70)
                )}`
            );
        }
        if (pickAlias(body, "isVerified", "is_verified") !== undefined) {
            sets.push(
                Prisma.sql`is_verified = ${Boolean(pickAlias(body, "isVerified", "is_verified"))}`
            );
        }
        if (pickAlias(body, "detailLevel", "detail_level") !== undefined) {
            const dl = String(pickAlias(body, "detailLevel", "detail_level") ?? "").trim();
            if (dl !== "zone" && dl !== "parcel") {
                throw new CoreReviewValidationError("detail_level must be zone or parcel", [
                    { path: "detailLevel", message: "Must be zone or parcel" },
                ]);
            }
            sets.push(Prisma.sql`detail_level = ${dl}`);
        }
        if (pickAlias(body, "cropCode", "crop_code") !== undefined) {
            sets.push(Prisma.sql`crop_code = ${pickAlias(body, "cropCode", "crop_code") ?? null}`);
        }
        if (pickAlias(body, "irrigated", "irrigated") !== undefined) {
            sets.push(Prisma.sql`irrigated = ${pickAlias(body, "irrigated", "irrigated") ?? null}`);
        }
        if (pickAlias(body, "seasonality", "seasonality") !== undefined) {
            sets.push(Prisma.sql`seasonality = ${pickAlias(body, "seasonality", "seasonality") ?? null}`);
        }
        if (pickAlias(body, "isActive", "is_active") !== undefined) {
            sets.push(Prisma.sql`is_active = ${Boolean(pickAlias(body, "isActive", "is_active"))}`);
        }

        const geom = pickGeometry(body);
        if (geom) {
            const normalizedGeom = await this.validatePolygon(geom);
            const geojson = geojsonSqlParam(normalizedGeom);
            const geomExpr = polygonGeomExpr(geojson);
            sets.push(Prisma.sql`geom = ${geomExpr}`);
            sets.push(Prisma.sql`centroid = ${centroidFromGeomExpr(geomExpr)}`);
            sets.push(Prisma.sql`area_m2 = ST_Area(${geomExpr}::geography)`);
        }

        const nameSlots = pickNameSlots(body);
        const hasNameUpdate =
            nameSlots.name_mm !== undefined ||
            nameSlots.name_en !== undefined ||
            nameSlots.name_und !== undefined;
        if (hasNameUpdate) {
            const legacyName = legacyDisplayName(nameSlots);
            sets.push(Prisma.sql`name = ${legacyName}`);
        }

        if (sets.length === 0 && !hasNameUpdate) {
            return false;
        }

        sets.push(Prisma.sql`manual_override = true`);
        sets.push(Prisma.sql`updated_at = NOW()`);

        await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                UPDATE core.core_map_landuse AS lu
                SET ${Prisma.join(sets, ", ")}
                WHERE ${landuseIdWhere(id)}
            `);
            if (hasNameUpdate) {
                await syncLanduseFeatureNames(tx, internalId, nameSlots);
            }
        });
        return true;
    }
}

export function serializeCoreReviewLanduse(row: CoreReviewLanduseRow) {
    const names = mapLanduseNameFields({
        name_mm: row.name_mm,
        name_en: row.name_en,
        name_und: row.name_und,
        fallback_name: row.name,
    });
    return {
        id: row.id,
        publicId: row.public_id,
        externalId: row.external_id,
        name: names.name,
        nameMm: names.name_mm,
        nameEn: names.name_en,
        nameUnd: names.name_und,
        classCode: row.class_code,
        landuseClassId: row.landuse_class_id,
        landuseClassCode: row.landuse_class_code,
        landuseClassNameEn: row.landuse_class_name_en,
        landuseClassNameMm: row.landuse_class_name_mm,
        adminAreaId: row.admin_area_id,
        adminAreaName: row.admin_area_name,
        detailLevel: row.detail_level,
        cropCode: row.crop_code,
        irrigated: row.irrigated,
        seasonality: row.seasonality,
        areaM2: row.area_m2,
        confidenceScore: row.confidence_score,
        manualOverride: row.manual_override,
        isVerified: row.is_verified,
        isActive: row.is_active,
        deletedAt: row.deleted_at ? String(row.deleted_at) : null,
        createdAt: row.created_at ? String(row.created_at) : null,
        updatedAt: row.updated_at ? String(row.updated_at) : null,
        geometry: row.geometry,
        centroid: row.centroid,
        sourceTags: row.source_tags,
        normalizedData: row.normalized_data,
        sourceRefs: row.source_refs,
        sourceStagingId: row.source_staging_id,
    };
}

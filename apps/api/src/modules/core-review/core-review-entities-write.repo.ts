import { Prisma, type PrismaClient } from "@prisma/client";

import {
    analyzeLineGeometry,
    analyzePointGeometry,
    analyzePolygonGeometry,
    centroidFromGeomExpr,
    geojsonSqlParam,
    multiLineStringGeomExpr,
    pointGeomExpr,
    polygonGeomExpr,
} from "../../lib/geo/postgis-geometry.js";
import { normalizePolygonGeoJsonForSave } from "../../lib/geo/normalize-polygon-geojson.js";
import {
    syncAdminAreaPrimaryNames,
    type PrimaryNameSlots,
} from "../../lib/entity-names/sync-primary-names.js";
import { CoreReviewValidationError } from "./core-review-write.errors.js";
import { pickTrimmedAlias, slugFromCanonicalName } from "./core-review-write.helpers.js";
import { pickAlias, pickGeometry } from "./core-review-write.schema.js";
import {
    appendCoreReviewVerificationSets,
    resolveCoreReviewVerificationWrite,
} from "./core-review-verification-write.js";

const DASHBOARD_SOURCE_REFS = JSON.stringify({ source: "dashboard" });

function boolOr(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/** When omitEmpty is true, blank name fields are ignored (existing rows are not cleared). */
function pickAdminAreaNameSlots(
    body: Record<string, unknown>,
    options: { omitEmpty: boolean },
): PrimaryNameSlots {
    const slots: PrimaryNameSlots = {};
    if (pickAlias(body, "nameMm", "name_mm") !== undefined) {
        const raw = pickAlias<string | null>(body, "nameMm", "name_mm") ?? null;
        const trimmed = raw?.trim() ?? "";
        if (!options.omitEmpty || trimmed) {
            slots.name_mm = trimmed || null;
        }
    }
    if (pickAlias(body, "nameEn", "name_en") !== undefined) {
        const raw = pickAlias<string | null>(body, "nameEn", "name_en") ?? null;
        const trimmed = raw?.trim() ?? "";
        if (!options.omitEmpty || trimmed) {
            slots.name_en = trimmed || null;
        }
    }
    return slots;
}

export class CoreReviewEntitiesWriteRepository {
    constructor(private readonly prisma: PrismaClient) {}

    private async validatePoint(prisma: PrismaClient, geojson: unknown, label: string) {
        const analysis = await analyzePointGeometry(prisma, geojsonSqlParam(geojson));
        if (!analysis?.allowed_type) {
            throw new CoreReviewValidationError(`${label} must be a GeoJSON Point`, [
                { path: "geometry", message: "Invalid point geometry type" },
            ]);
        }
        if (!analysis.is_valid) {
            throw new CoreReviewValidationError(`${label} geometry is invalid`, [
                { path: "geometry", message: "Invalid point geometry" },
            ]);
        }
    }

    private async validatePolygon(prisma: PrismaClient, geojson: unknown): Promise<unknown> {
        const normalized = normalizePolygonGeoJsonForSave(geojson);
        const analysis = await analyzePolygonGeometry(prisma, geojsonSqlParam(normalized));
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

    private async validateLineString(prisma: PrismaClient, geojson: unknown, multiLine = false) {
        const analysis = await analyzeLineGeometry(prisma, geojsonSqlParam(geojson), multiLine);
        if (!analysis?.allowed_type) {
            throw new CoreReviewValidationError(
                multiLine ? "geometry must be LineString or MultiLineString" : "geometry must be LineString",
                [{ path: "geometry", message: "Invalid line geometry type" }],
            );
        }
        if (!analysis.is_valid) {
            throw new CoreReviewValidationError(analysis.invalid_reason ?? "Invalid line geometry", [
                { path: "geometry", message: analysis.invalid_reason ?? "Invalid line" },
            ]);
        }
    }

    async createMapPolygon(
        table: "core.core_map_landuse" | "core.core_map_water_polygons",
        body: Record<string, unknown>,
    ) {
        const geom = pickGeometry(body);
        if (!geom) {
            throw new CoreReviewValidationError("geometry is required", [
                { path: "geometry", message: "Required" },
            ]);
        }
        const classCode =
            pickTrimmedAlias(body, "classCode", "class_code") ??
            pickTrimmedAlias(body, "class_code", "class_code");
        if (!classCode) {
            throw new CoreReviewValidationError("class_code is required", [
                { path: "classCode", message: "Required" },
            ]);
        }
        const normalizedGeom = await this.validatePolygon(this.prisma, geom);
        const geojson = geojsonSqlParam(normalizedGeom);
        const { isVerified, verificationStatus } = resolveCoreReviewVerificationWrite(body);
        const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            INSERT INTO ${Prisma.raw(table)} (
                source_staging_id, external_id,
                name, class_code, geom, is_active, is_verified, verification_status, source_refs, normalized_data
            ) VALUES (
                NULL, NULL,
                ${pickAlias(body, "name", "name") ?? null},
                ${classCode},
                ${polygonGeomExpr(geojson)},
                ${boolOr(pickAlias(body, "isActive", "is_active"), true)},
                ${isVerified},
                ${verificationStatus},
                ${DASHBOARD_SOURCE_REFS}::jsonb,
                jsonb_build_object('source', 'dashboard')
            )
            RETURNING id::text AS id
        `);
        return rows[0]?.id ?? null;
    }

    async updateMapPolygon(
        table: "core.core_map_landuse" | "core.core_map_water_polygons",
        id: string,
        body: Record<string, unknown>,
    ) {
        const sets: Prisma.Sql[] = [];
        if (pickAlias(body, "name", "name") !== undefined) {
            sets.push(Prisma.sql`name = ${pickAlias(body, "name", "name") ?? null}`);
        }
        if (pickAlias(body, "classCode", "class_code") !== undefined) {
            sets.push(Prisma.sql`class_code = ${pickAlias(body, "classCode", "class_code") ?? null}`);
        }
        if (pickAlias(body, "isActive", "is_active") !== undefined) {
            sets.push(Prisma.sql`is_active = ${boolOr(pickAlias(body, "isActive", "is_active"), true)}`);
        }
        appendCoreReviewVerificationSets(sets, body);
        const geom = pickGeometry(body);
        if (geom) {
            const normalizedGeom = await this.validatePolygon(this.prisma, geom);
            sets.push(Prisma.sql`geom = ${polygonGeomExpr(geojsonSqlParam(normalizedGeom))}`);
        }
        if (sets.length === 0) return false;
        sets.push(Prisma.sql`updated_at = NOW()`);
        const result = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE ${Prisma.raw(table)} SET ${Prisma.join(sets, ", ")}
            WHERE id = ${BigInt(id)}
        `);
        return result > 0;
    }

    async createWaterLine(body: Record<string, unknown>) {
        const geom = pickGeometry(body);
        if (!geom) {
            throw new CoreReviewValidationError("geometry is required", [
                { path: "geometry", message: "Required" },
            ]);
        }
        const classCode =
            pickTrimmedAlias(body, "classCode", "class_code") ??
            pickTrimmedAlias(body, "class_code", "class_code");
        if (!classCode) {
            throw new CoreReviewValidationError("class_code is required", [
                { path: "classCode", message: "Required" },
            ]);
        }
        await this.validateLineString(this.prisma, geom, true);
        const geojson = geojsonSqlParam(geom);
        const { isVerified, verificationStatus } = resolveCoreReviewVerificationWrite(body);
        const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            INSERT INTO core.core_map_water_lines (
                source_staging_id, external_id,
                name, class_code, geom, is_active, is_verified, verification_status, source_refs, normalized_data
            ) VALUES (
                NULL, NULL,
                ${pickAlias(body, "name", "name") ?? null},
                ${classCode},
                ${multiLineStringGeomExpr(geojson)},
                ${boolOr(pickAlias(body, "isActive", "is_active"), true)},
                ${isVerified},
                ${verificationStatus},
                ${DASHBOARD_SOURCE_REFS}::jsonb,
                jsonb_build_object('source', 'dashboard')
            )
            RETURNING id::text AS id
        `);
        return rows[0]?.id ?? null;
    }

    async updateWaterLine(id: string, body: Record<string, unknown>) {
        const sets: Prisma.Sql[] = [];
        if (pickAlias(body, "name", "name") !== undefined) {
            sets.push(Prisma.sql`name = ${pickAlias(body, "name", "name") ?? null}`);
        }
        if (pickAlias(body, "classCode", "class_code") !== undefined) {
            sets.push(Prisma.sql`class_code = ${pickAlias(body, "classCode", "class_code") ?? null}`);
        }
        if (pickAlias(body, "isActive", "is_active") !== undefined) {
            sets.push(Prisma.sql`is_active = ${boolOr(pickAlias(body, "isActive", "is_active"), true)}`);
        }
        appendCoreReviewVerificationSets(sets, body);
        const geom = pickGeometry(body);
        if (geom) {
            await this.validateLineString(this.prisma, geom, true);
            sets.push(Prisma.sql`geom = ${multiLineStringGeomExpr(geojsonSqlParam(geom))}`);
        }
        if (sets.length === 0) return false;
        sets.push(Prisma.sql`updated_at = NOW()`);
        const result = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE core.core_map_water_lines SET ${Prisma.join(sets, ", ")}
            WHERE id = ${BigInt(id)}
        `);
        return result > 0;
    }

    async createAddress(body: Record<string, unknown>, sourceTypeId: bigint, streetInternalId: bigint | null) {
        const pointGeom = pickGeometry(body);
        if (!pointGeom) {
            throw new CoreReviewValidationError("point geometry is required", [
                { path: "pointGeom", message: "Required" },
            ]);
        }
        await this.validatePoint(this.prisma, pointGeom, "pointGeom");
        const entrance =
            pickAlias(body, "entranceGeom", "entrance_geom") ??
            (body.entranceGeom as unknown) ??
            (body.entrance_geom as unknown);
        if (entrance) {
            await this.validatePoint(this.prisma, entrance, "entranceGeom");
        }
        const pointJson = geojsonSqlParam(pointGeom);
        const entranceSql = entrance
            ? pointGeomExpr(geojsonSqlParam(entrance))
            : Prisma.sql`NULL::geometry(Point, 4326)`;

        const { isVerified, verificationStatus } = resolveCoreReviewVerificationWrite(body);

        const rows = await this.prisma.$queryRaw<{ public_id: string }[]>(Prisma.sql`
            INSERT INTO core.core_addresses (
                public_id, full_address, house_number, unit_number, postal_code,
                street_id, admin_area_id, source_type_id, point_geom, entrance_geom,
                is_public, is_verified, verification_status, source_refs
            ) VALUES (
                gen_random_uuid(),
                ${pickAlias(body, "fullAddress", "full_address") ?? null},
                ${pickAlias(body, "houseNumber", "house_number") ?? null},
                ${pickAlias(body, "unitNumber", "unit_number") ?? null},
                ${pickAlias(body, "postalCode", "postal_code") ?? null},
                ${streetInternalId},
                ${pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ?? null},
                ${sourceTypeId},
                ${pointGeomExpr(pointJson)},
                ${entranceSql},
                ${boolOr(pickAlias(body, "isPublic", "is_public"), true)},
                ${isVerified},
                ${verificationStatus},
                ${DASHBOARD_SOURCE_REFS}::jsonb
            )
            RETURNING public_id::text AS public_id
        `);
        return rows[0]?.public_id ?? null;
    }

    async updateAddress(publicId: string, body: Record<string, unknown>, streetInternalId?: bigint | null) {
        const sets: Prisma.Sql[] = [];
        const strFields: [string, string, string][] = [
            ["fullAddress", "full_address", "full_address"],
            ["houseNumber", "house_number", "house_number"],
            ["unitNumber", "unit_number", "unit_number"],
            ["postalCode", "postal_code", "postal_code"],
        ];
        for (const [camel, snake, col] of strFields) {
            if (pickAlias(body, camel, snake) !== undefined) {
                sets.push(Prisma.sql`${Prisma.raw(col)} = ${pickAlias(body, camel, snake) ?? null}`);
            }
        }
        if (streetInternalId !== undefined) {
            sets.push(Prisma.sql`street_id = ${streetInternalId}`);
        }
        if (pickAlias(body, "adminAreaId", "admin_area_id") !== undefined) {
            sets.push(
                Prisma.sql`admin_area_id = ${pickAlias<bigint | null>(body, "adminAreaId", "admin_area_id") ?? null}`,
            );
        }
        if (pickAlias(body, "sourceTypeId", "source_type_id") !== undefined) {
            sets.push(
                Prisma.sql`source_type_id = ${pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id") ?? null}`,
            );
        }
        if (pickAlias(body, "isPublic", "is_public") !== undefined) {
            sets.push(Prisma.sql`is_public = ${boolOr(pickAlias(body, "isPublic", "is_public"), true)}`);
        }
        appendCoreReviewVerificationSets(sets, body);
        const pointGeom = pickGeometry(body);
        if (pointGeom) {
            await this.validatePoint(this.prisma, pointGeom, "pointGeom");
            sets.push(Prisma.sql`point_geom = ${pointGeomExpr(geojsonSqlParam(pointGeom))}`);
        }
        const entrance =
            pickAlias(body, "entranceGeom", "entrance_geom") ??
            (body.entranceGeom as unknown) ??
            (body.entrance_geom as unknown);
        if (entrance !== undefined) {
            if (entrance) {
                await this.validatePoint(this.prisma, entrance, "entranceGeom");
                sets.push(Prisma.sql`entrance_geom = ${pointGeomExpr(geojsonSqlParam(entrance))}`);
            } else {
                sets.push(Prisma.sql`entrance_geom = NULL`);
            }
        }
        if (sets.length === 0) return false;
        sets.push(Prisma.sql`updated_at = NOW()`);
        const result = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE core.core_addresses SET ${Prisma.join(sets, ", ")}
            WHERE public_id = CAST(${publicId} AS uuid)
        `);
        return result > 0;
    }

    async createAdminArea(body: Record<string, unknown>, sourceTypeId: bigint) {
        const geom = pickGeometry(body);
        if (!geom) {
            throw new CoreReviewValidationError("geometry is required", [
                { path: "geometry", message: "Required" },
            ]);
        }

        const canonicalName = pickTrimmedAlias(body, "canonicalName", "canonical_name");
        if (!canonicalName) {
            throw new CoreReviewValidationError("canonical_name is required", [
                { path: "canonicalName", message: "Required" },
            ]);
        }

        let slug = pickTrimmedAlias(body, "slug", "slug");
        if (!slug) {
            slug = slugFromCanonicalName(canonicalName);
        }

        const normalizedGeom = await this.validatePolygon(this.prisma, geom);
        const geojson = geojsonSqlParam(normalizedGeom);
        const geomExpr = polygonGeomExpr(geojson);
        const boundaryStatus = pickTrimmedAlias(body, "boundaryStatus", "boundary_status");
        const addressUsage = pickTrimmedAlias(body, "addressUsage", "address_usage");
        const boundaryConfidenceScore = pickAlias<number>(
            body,
            "boundaryConfidenceScore",
            "boundary_confidence_score",
        );
        const boundaryNote = pickAlias<string | null>(body, "boundaryNote", "boundary_note") ?? null;
        const { isVerified, verificationStatus } = resolveCoreReviewVerificationWrite(body);
        const nameSlots = pickAdminAreaNameSlots(body, { omitEmpty: true });
        const hasNameUpdate = nameSlots.name_mm !== undefined || nameSlots.name_en !== undefined;

        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<{ id: bigint; public_id: string }[]>(Prisma.sql`
                INSERT INTO core.core_admin_areas (
                    public_id, canonical_name, slug, parent_id, admin_level_id,
                    source_type_id, geom, centroid, is_active, is_verified, verification_status, source_refs,
                    boundary_status, is_official_boundary, boundary_confidence_score,
                    address_usage, boundary_note
                ) VALUES (
                    gen_random_uuid(),
                    ${canonicalName},
                    ${slug},
                    ${pickAlias<bigint | null>(body, "parentId", "parent_id") ?? null},
                    ${pickAlias<bigint>(body, "adminLevelId", "admin_level_id")},
                    ${sourceTypeId},
                    ${geomExpr},
                    ${centroidFromGeomExpr(geomExpr)},
                    ${boolOr(pickAlias(body, "isActive", "is_active"), true)},
                    ${isVerified},
                    ${verificationStatus},
                    ${DASHBOARD_SOURCE_REFS}::jsonb,
                    ${boundaryStatus},
                    ${boolOr(pickAlias(body, "isOfficialBoundary", "is_official_boundary"), false)},
                    ${boundaryConfidenceScore},
                    ${addressUsage},
                    ${boundaryNote}
                )
                RETURNING id, public_id::text AS public_id
            `);
            const row = rows[0];
            if (!row) {
                return null;
            }
            if (hasNameUpdate) {
                await syncAdminAreaPrimaryNames(tx, row.id, nameSlots);
            }
            return row.public_id;
        });
    }

    async updateAdminArea(publicId: string, body: Record<string, unknown>) {
        const nameSlots = pickAdminAreaNameSlots(body, { omitEmpty: true });
        const hasNameUpdate = nameSlots.name_mm !== undefined || nameSlots.name_en !== undefined;
        const sets: Prisma.Sql[] = [];
        if (pickAlias(body, "canonicalName", "canonical_name") !== undefined) {
            sets.push(
                Prisma.sql`canonical_name = ${pickAlias(body, "canonicalName", "canonical_name") ?? null}`,
            );
        }
        if (pickAlias(body, "slug", "slug") !== undefined) {
            sets.push(Prisma.sql`slug = ${pickAlias(body, "slug", "slug") ?? null}`);
        }
        if (pickAlias(body, "parentId", "parent_id") !== undefined) {
            sets.push(Prisma.sql`parent_id = ${pickAlias<bigint | null>(body, "parentId", "parent_id") ?? null}`);
        }
        if (pickAlias(body, "adminLevelId", "admin_level_id") !== undefined) {
            sets.push(Prisma.sql`admin_level_id = ${pickAlias<bigint>(body, "adminLevelId", "admin_level_id")}`);
        }
        if (pickAlias(body, "sourceTypeId", "source_type_id") !== undefined) {
            sets.push(
                Prisma.sql`source_type_id = ${pickAlias<bigint | null>(body, "sourceTypeId", "source_type_id") ?? null}`,
            );
        }
        if (pickAlias(body, "isActive", "is_active") !== undefined) {
            sets.push(Prisma.sql`is_active = ${boolOr(pickAlias(body, "isActive", "is_active"), true)}`);
        }
        appendCoreReviewVerificationSets(sets, body);
        if (pickAlias(body, "boundaryStatus", "boundary_status") !== undefined) {
            sets.push(
                Prisma.sql`boundary_status = ${pickAlias(body, "boundaryStatus", "boundary_status") ?? null}`,
            );
        }
        if (pickAlias(body, "isOfficialBoundary", "is_official_boundary") !== undefined) {
            sets.push(
                Prisma.sql`is_official_boundary = ${boolOr(
                    pickAlias(body, "isOfficialBoundary", "is_official_boundary"),
                    false,
                )}`,
            );
        }
        if (pickAlias(body, "boundaryConfidenceScore", "boundary_confidence_score") !== undefined) {
            sets.push(
                Prisma.sql`boundary_confidence_score = ${pickAlias(
                    body,
                    "boundaryConfidenceScore",
                    "boundary_confidence_score",
                ) ?? null}`,
            );
        }
        if (pickAlias(body, "addressUsage", "address_usage") !== undefined) {
            sets.push(
                Prisma.sql`address_usage = ${pickAlias(body, "addressUsage", "address_usage") ?? null}`,
            );
        }
        if (pickAlias(body, "boundaryNote", "boundary_note") !== undefined) {
            sets.push(
                Prisma.sql`boundary_note = ${pickAlias<string | null>(body, "boundaryNote", "boundary_note") ?? null}`,
            );
        }
        const geom = pickGeometry(body);
        if (geom) {
            const normalizedGeom = await this.validatePolygon(this.prisma, geom);
            const geojson = geojsonSqlParam(normalizedGeom);
            const geomExpr = polygonGeomExpr(geojson);
            sets.push(Prisma.sql`geom = ${geomExpr}`);
            sets.push(Prisma.sql`centroid = ${centroidFromGeomExpr(geomExpr)}`);
        }
        if (sets.length === 0 && !hasNameUpdate) return false;

        if (sets.length > 0) {
            sets.push(Prisma.sql`updated_at = NOW()`);
        }

        await this.prisma.$transaction(async (tx) => {
            if (sets.length > 0) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_admin_areas SET ${Prisma.join(sets, ", ")}
                    WHERE public_id = CAST(${publicId} AS uuid)
                `);
            } else if (hasNameUpdate) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_admin_areas SET updated_at = NOW()
                    WHERE public_id = CAST(${publicId} AS uuid)
                `);
            }
            if (hasNameUpdate) {
                const idRows = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                    SELECT id FROM core.core_admin_areas
                    WHERE public_id = CAST(${publicId} AS uuid)
                    LIMIT 1
                `);
                const internalId = idRows[0]?.id;
                if (internalId !== undefined) {
                    await syncAdminAreaPrimaryNames(tx, internalId, nameSlots);
                }
            }
        });
        return true;
    }
}

import { Prisma, type PrismaClient } from "@prisma/client";

import {
    coreReviewListStatusClause,
    type CoreReviewListStatus,
} from "../core-review/core-review-list-status.js";
import {
    coreReviewVerificationFilterCondition,
    effectiveVerificationStatusExpr,
    type CoreReviewVerificationStatus,
} from "../core-review/core-review-verification-filter.js";
import {
    resolveStreetsCoreReviewSortColumn,
    streetsCoreReviewOrderBy,
    streetsCoreReviewTextSearchClause,
    streetsCoreReviewUpdatedAtKeysetOrderBy,
    streetsTownshipAdminAreaFilterClause,
    type StreetsCoreReviewSortColumn,
} from "./streets-list-query.js";
import {
    applyStreetRowAfterScalarUpdate,
    deriveCanonicalNameAfterNameEdits,
    streetOfficialNameShouldSync,
    streetRoadClassIdChanged,
    streetUpdateNeedsDetailReload,
    streetUpdateTouchesRoutingGraph,
} from "./streets-update-plan.js";

type DbClient = PrismaClient | Prisma.TransactionClient;

export class StreetCrudValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StreetCrudValidationError";
    }
}

export type ListStreetsParams = {
    limit: number;
    offset?: number;
    /** Keyset cursor for updated_at sort (use with sortBy updated/updated_at). */
    cursor_updated_at?: Date;
    cursor_id?: bigint;
    /** When true, index-friendly core SELECT + batch name/admin/road-class enrichment. */
    fast_list?: boolean;
    q?: string;
    sortBy: StreetsCoreReviewSortColumn;
    sortOrder: "asc" | "desc";
    /** @deprecated Prefer status; true maps to status=all */
    include_deleted: boolean;
    status?: CoreReviewListStatus;
    is_verified?: boolean;
    verification_status?: CoreReviewVerificationStatus;
    admin_area_id?: bigint;
    road_class_id?: bigint;
};

export function resolveStreetsListStatus(
    params: Pick<ListStreetsParams, "status" | "include_deleted">
): CoreReviewListStatus {
    if (params.status !== undefined) {
        return params.status;
    }
    return params.include_deleted ? "all" : "active";
}

/** GeoJSON LineString payload for dashboard CRUD only. */
export type StreetCenterlineGeoJson =
    | {
          type: "LineString";
          coordinates: number[][];
      }
    | null;

/** Geometry as returned from PostGIS GeoJSON (may include legacy MultiLineString). */
export type StreetGeometryJson =
    | {
          type: "LineString";
          coordinates: number[][];
      }
    | {
          type: "MultiLineString";
          coordinates: number[][][];
      }
    | null;

/** Core-review list row — no geometry or full names payload. */
export type StreetCoreReviewListRow = {
    id: string;
    public_id: string;
    canonical_name: string;
    admin_area_id: string | null;
    admin_area_name: string | null;
    road_class_id: string | null;
    road_class: string | null;
    road_class_name: string | null;
    surface: string | null;
    is_oneway: boolean;
    bridge: boolean;
    tunnel: boolean;
    routing_status: string;
    deleted_at: Date | null;
    is_active: boolean;
    verification_status: string | null;
    is_verified: boolean;
    created_at: Date;
    updated_at: Date;
    myanmar_name: string | null;
    english_name: string | null;
};

/** Phase-1 core-review list row — no joins or name lookups. */
type StreetCoreReviewListCoreRow = {
    id: string;
    public_id: string;
    canonical_name: string;
    admin_area_id: string | null;
    road_class_id: string | null;
    road_class: string | null;
    surface: string | null;
    is_oneway: boolean;
    bridge: boolean;
    tunnel: boolean;
    routing_status: string;
    deleted_at: Date | null;
    is_active: boolean;
    verification_status: string | null;
    is_verified: boolean;
    created_at: Date;
    updated_at: Date;
};

export const CORE_REVIEW_STREETS_MAX_PAGE_SIZE = 50;

export type StreetsCoreReviewScopeCounts = {
    total: number;
    verified: number;
    unverified: number;
};

/** Map editor bbox query row — geometry + display labels only. */
export type StreetMapBboxRow = {
    id: string;
    public_id: string;
    canonical_name: string;
    road_class: string | null;
    is_active: boolean;
    deleted_at: Date | null;
    geometry: StreetGeometryJson;
};

export type StreetRow = {
    public_id: string;
    canonical_name: string;
    admin_area_id: string | null;
    admin_area_name: string | null;
    source_type_id?: string;
    road_class_id: string | null;
    road_class: string | null;
    road_class_name: string | null;
    surface: string | null;
    is_oneway: boolean;
    bridge: boolean;
    tunnel: boolean;
    manual_override: boolean;
    edit_status: string;
    routing_status: string;
    deleted_at: Date | null;
    last_edited_at: Date | null;
    is_active: boolean;
    verification_status: string | null;
    is_verified: boolean;
    created_at: Date;
    updated_at: Date;
    geometry: StreetGeometryJson;
    names: StreetNameRow[];
    myanmar_name: string | null;
    english_name: string | null;
};

export type UpdateStreetInput = {
    myanmarName?: string;
    englishName?: string;
    geometry?: StreetCenterlineGeoJson;
    road_class_id?: bigint | null;
    admin_area_id?: bigint | null;
    is_oneway?: boolean;
    surface?: string | null;
    bridge?: boolean;
    tunnel?: boolean;
    verification_status?: string;
    is_verified?: boolean;
    manual_override?: boolean;
};

export type CreateStreetInput = {
    myanmarName?: string;
    englishName?: string;
    canonical_name: string;
    adminAreaId?: bigint | null;
    sourceTypeId?: bigint | null;
    admin_area_id?: bigint | null;
    source_type_id: bigint;
    road_class_id: bigint;
    is_oneway: boolean;
    surface?: string | null;
    bridge: boolean;
    tunnel: boolean;
    geometry: StreetCenterlineGeoJson;
    is_active?: boolean;
    verification_status?: string;
    is_verified?: boolean;
    manual_override?: boolean;
};

export type StreetMutationContext = {
    editorId?: bigint;
    editReason?: string;
};

export type StreetLookupRef = { publicId: string } | { internalId: bigint };

/** Nearest hit on street centerlines within a search radius (WGS‑84 inputs, metric distance). */
export type NearestStreetPointRow = {
    street_id: string;
    nearest_lng: number;
    nearest_lat: number;
    distance_m: number;
    street_name: string | null;
    road_class: string | null;
};

/** Crosses another active street (ST_Crosses). */
export type StreetGeometryCrossingRow = {
    street_id: string;
    street_name: string | null;
    road_class: string | null;
};

/** Overlap (shared segment ≥5 m) or Hausdorff near-duplicate (≤3 m). */
export type StreetGeometryDuplicateRow = StreetGeometryCrossingRow & {
    kind: "overlap" | "near_duplicate";
};

function editedStreetExcludeSql(excludePublicId?: string | null, excludeInternalId?: bigint | null): Prisma.Sql {
    const clauses: Prisma.Sql[] = [];

    if (excludePublicId != null && excludePublicId.trim() !== "") {
        clauses.push(Prisma.sql`s.public_id <> CAST(${excludePublicId.trim()} AS uuid)`);
    }

    if (excludeInternalId !== undefined && excludeInternalId !== null) {
        clauses.push(Prisma.sql`s.id <> ${excludeInternalId}`);
    }

    if (clauses.length === 0) {
        return Prisma.empty;
    }

    return clauses.length === 1
        ? Prisma.sql`AND ${clauses[0]}`
        : Prisma.sql`AND (${Prisma.join(clauses, " AND ")})`;
}

function streetLookupSql(streetId: StreetLookupRef): Prisma.Sql {
    return "internalId" in streetId
        ? Prisma.sql`s_inner.id = ${streetId.internalId}`
        : Prisma.sql`s_inner.public_id = CAST(${streetId.publicId} AS uuid)`;
}

export type StreetNameRow = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
};

function streetsListOrderBy(sortBy: ListStreetsParams["sortBy"], sortOrder: ListStreetsParams["sortOrder"]): Prisma.Sql {
    return streetsCoreReviewOrderBy(
        resolveStreetsCoreReviewSortColumn(sortBy),
        sortOrder,
    );
}

/** Index-friendly ORDER BY for updated_at keyset lists (matches partial index, no NULLS LAST). */
function streetsUpdatedAtKeysetOrderBy(sortOrder: ListStreetsParams["sortOrder"]): Prisma.Sql {
    return streetsCoreReviewUpdatedAtKeysetOrderBy(sortOrder);
}

function streetsKeysetClause(params: ListStreetsParams, sortBy: ListStreetsParams["sortBy"], sortOrder: ListStreetsParams["sortOrder"]): Prisma.Sql {
    if (params.cursor_updated_at === undefined || params.cursor_id === undefined) {
        return Prisma.empty;
    }

    if (sortBy !== "updated" && sortBy !== "updated_at") {
        return Prisma.empty;
    }

    const cmp = sortOrder === "asc" ? Prisma.sql`>` : Prisma.sql`<`;
    return Prisma.sql`AND (s.updated_at, s.id) ${cmp} (${params.cursor_updated_at}, ${params.cursor_id})`;
}

function streetsLifecycleFilterClauses(params: StreetsListFilterParams): Prisma.Sql[] {
    return [
        coreReviewListStatusClause("s", resolveStreetsListStatus(params), {
            hasDeletedAt: true,
            hasIsActive: true,
        }),
    ];
}

function streetsScopeFilterClauses(params: StreetsListFilterParams): Prisma.Sql[] {
    const clauses = streetsLifecycleFilterClauses(params);

    if (params.admin_area_id !== undefined) {
        clauses.push(streetsTownshipAdminAreaFilterClause(params.admin_area_id));
    }

    if (params.road_class_id !== undefined) {
        clauses.push(Prisma.sql`s.road_class_id = ${params.road_class_id}`);
    }

    if (params.q !== undefined) {
        clauses.push(streetsCoreReviewTextSearchClause(params.q));
    }

    return clauses;
}

function streetsBaseFilterClauses(params: StreetsListFilterParams): Prisma.Sql[] {
    const clauses = streetsScopeFilterClauses(params);

    const verificationCondition = coreReviewVerificationFilterCondition("s", {
        verificationStatus: params.verification_status,
    });
    if (verificationCondition) {
        clauses.push(verificationCondition);
    }

    return clauses;
}

function streetsCountFilterClauses(params: StreetsListFilterParams): Prisma.Sql[] {
    return streetsListFilterClauses(params);
}

function streetsListFilterClauses(params: StreetsListFilterParams): Prisma.Sql[] {
    return streetsBaseFilterClauses(params);
}

type StreetsListFilterParams = Pick<
    ListStreetsParams,
    "q" | "include_deleted" | "status" | "is_verified" | "verification_status" | "admin_area_id" | "road_class_id"
>;

function isStreetsCoreReviewQueryTimingEnabled(): boolean {
    return process.env.NODE_ENV !== "production" || process.env.CORE_REVIEW_STREETS_QUERY_TIMING === "1";
}

function isStreetUpdateQueryTimingEnabled(): boolean {
    return isStreetsCoreReviewQueryTimingEnabled() || process.env.STREETS_UPDATE_QUERY_TIMING === "1";
}

async function timeStreetsCoreReviewQuery<T>(
    operation: "list" | "count",
    meta: Record<string, unknown>,
    fn: () => Promise<T>,
): Promise<T> {
    if (!isStreetsCoreReviewQueryTimingEnabled()) {
        return fn();
    }

    const started = performance.now();
    try {
        return await fn();
    } finally {
        console.info(
            JSON.stringify({
                scope: "streets_core_review_repo",
                operation,
                duration_ms: Math.round((performance.now() - started) * 10) / 10,
                ...meta,
            }),
        );
    }
}

/** Opt-in timing for PATCH updateStreet sub-steps (set CORE_REVIEW_STREETS_QUERY_TIMING=1 or STREETS_UPDATE_QUERY_TIMING=1). */
async function timeStreetUpdateStep<T>(
    step: string,
    meta: Record<string, unknown>,
    fn: () => Promise<T>,
): Promise<T> {
    if (!isStreetUpdateQueryTimingEnabled()) {
        return fn();
    }

    const started = performance.now();
    try {
        return await fn();
    } finally {
        console.info(
            JSON.stringify({
                scope: "streets_update_repo",
                step,
                duration_ms: Math.round((performance.now() - started) * 10) / 10,
                ...meta,
            }),
        );
    }
}

async function applyStreetVersioningSession(
    tx: Prisma.TransactionClient,
    context: StreetMutationContext | undefined,
) {
    const editor = context?.editorId !== undefined ? String(context.editorId) : "";
    const reason = context?.editReason?.trim() ?? "";

    await tx.$executeRaw(Prisma.sql`SELECT set_config('local_map.editor_id', ${editor}, true)`);
    await tx.$executeRaw(Prisma.sql`SELECT set_config('local_map.edit_reason', ${reason}, true)`);
}

const STREET_LINE_VALIDATION_SQL = (
    geojson: string,
): Prisma.Sql => Prisma.sql`
    SELECT
        CASE
            WHEN g IS NULL THEN false
            WHEN NOT ST_IsValid(g) THEN false
            WHEN ST_GeometryType(g) <> 'ST_LineString' THEN false
            WHEN ST_SRID(g) <> 4326 THEN false
            WHEN ST_Length(g::geography) <= 2 THEN false
            ELSE true
        END AS ok,
        CASE
            WHEN g IS NULL THEN 'invalid_geometry'
            WHEN NOT ST_IsValid(g) THEN 'geometry_not_valid'
            WHEN ST_GeometryType(g) <> 'ST_LineString' THEN 'geometry_must_be_linestring'
            WHEN ST_SRID(g) <> 4326 THEN 'geometry_srid_must_be_4326'
            WHEN ST_Length(g::geography) <= 2 THEN 'geometry_length_must_exceed_2_meters'
            ELSE NULL
        END AS reason
    FROM (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::json), 4326) AS g
    ) AS t
`;

export class StreetsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async getStreetCenterlineValidity(geometry: {
        type: "LineString";
        coordinates: number[][];
    }): Promise<{ ok: boolean; reason: string | null }> {
        const geojson = JSON.stringify(geometry);

        try {
            const rows = await this.prisma.$queryRaw<{ ok: boolean; reason: string | null }[]>(
                STREET_LINE_VALIDATION_SQL(geojson),
            );

            return rows[0] ?? { ok: false, reason: "invalid_geometry" };
        } catch {
            return { ok: false, reason: "invalid_geometry" };
        }
    }

    async assertValidCenterline(geometry: { type: "LineString"; coordinates: number[][] }): Promise<void> {
        try {
            const row = await this.getStreetCenterlineValidity(geometry);
            if (!row.ok) {
                const code = row.reason ?? "invalid_geometry";
                const messageByCode: Record<string, string> = {
                    invalid_geometry: "geometry could not be parsed as GeoJSON LineString",
                    geometry_not_valid: "geometry is not valid",
                    geometry_must_be_linestring: "geometry must be a LineString",
                    geometry_srid_must_be_4326: "geometry SRID must be 4326 (WGS 84)",
                    geometry_length_must_exceed_2_meters: "centerline length must be greater than 2 meters",
                };
                throw new StreetCrudValidationError(messageByCode[code] ?? "invalid geometry");
            }
        } catch (error) {
            if (error instanceof StreetCrudValidationError) {
                throw error;
            }
            throw new StreetCrudValidationError("geometry could not be parsed or validated");
        }
    }

    /**
     * Streets whose centerline is crossed by the candidate (read-only).
     */
    async listStreetGeometryCrossings(params: {
        geometry: { type: "LineString"; coordinates: number[][] };
        excludePublicId?: string | null;
        excludeInternalId?: bigint | null;
        searchRadiusMeters?: number;
    }): Promise<StreetGeometryCrossingRow[]> {
        const geojson = JSON.stringify(params.geometry);
        const excludeClause = editedStreetExcludeSql(params.excludePublicId, params.excludeInternalId);
        const searchRadiusMeters = params.searchRadiusMeters ?? 200;

        return this.prisma.$queryRaw<StreetGeometryCrossingRow[]>(Prisma.sql`
            WITH inp AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::json), 4326) AS geom
            )
            SELECT
                s.public_id::text AS street_id,
                s.canonical_name AS street_name,
                COALESCE(rc.name, rc.code) AS road_class
            FROM core.core_streets AS s
            CROSS JOIN inp
            LEFT JOIN ref.ref_road_classes AS rc
                ON rc.id = s.road_class_id
            WHERE s.deleted_at IS NULL
              AND s.is_active IS TRUE
              AND s.geom IS NOT NULL
              ${excludeClause}
              AND ST_DWithin(
                  s.geom::geography,
                  inp.geom::geography,
                  ${searchRadiusMeters}::double precision
              )
              AND ST_Intersects(inp.geom, s.geom::geometry)
              AND ST_Crosses(inp.geom, s.geom::geometry)
            ORDER BY s.canonical_name NULLS LAST, s.public_id ASC
        `);
    }

    /**
     * Streets that overlap the candidate (≥5 m shared geography) or match as a Hausdorff duplicate (≤3 m).
     * Cross-only relationships are omitted (see {@link listStreetGeometryCrossings}).
     */
    async listStreetGeometryOverlapDuplicates(params: {
        geometry: { type: "LineString"; coordinates: number[][] };
        excludePublicId?: string | null;
        excludeInternalId?: bigint | null;
        searchRadiusMeters?: number;
    }): Promise<StreetGeometryDuplicateRow[]> {
        const geojson = JSON.stringify(params.geometry);
        const excludeClause = editedStreetExcludeSql(params.excludePublicId, params.excludeInternalId);
        const searchRadiusMeters = params.searchRadiusMeters ?? 200;

        return this.prisma.$queryRaw<StreetGeometryDuplicateRow[]>(Prisma.sql`
            WITH inp AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}::json), 4326) AS geom
            )
            SELECT
                subs.street_id,
                subs.street_name,
                subs.road_class,
                subs.kind::text AS kind
            FROM (
                SELECT DISTINCT ON (s.public_id)
                    s.public_id::text AS street_id,
                    s.canonical_name AS street_name,
                    COALESCE(rc.name, rc.code) AS road_class,
                    CASE
                        WHEN
                            ST_Intersects(inp.geom, s.geom::geometry)
                                AND NOT ST_Crosses(inp.geom, s.geom::geometry)
                                AND ST_Length(
                                    ST_Intersection(inp.geom, s.geom::geometry)::geography
                                ) >= 5
                            THEN 'overlap'::text
                        ELSE 'near_duplicate'::text
                    END AS kind
                FROM core.core_streets AS s
                CROSS JOIN inp
                LEFT JOIN ref.ref_road_classes AS rc
                    ON rc.id = s.road_class_id
                WHERE s.deleted_at IS NULL
                  AND s.is_active IS TRUE
                  AND s.geom IS NOT NULL
                  ${excludeClause}
                  AND ST_DWithin(
                      s.geom::geography,
                      inp.geom::geography,
                      ${searchRadiusMeters}::double precision
                  )
                  AND NOT (
                      ST_Intersects(inp.geom, s.geom::geometry)
                      AND ST_Crosses(inp.geom, s.geom::geometry)
                  )
                  AND (
                      (
                          ST_Intersects(inp.geom, s.geom::geometry)
                              AND NOT ST_Crosses(inp.geom, s.geom::geometry)
                              AND ST_Length(ST_Intersection(inp.geom, s.geom::geometry)::geography) >= 5
                      )
                      OR (
                          ST_HausdorffDistance(
                              ST_Transform(s.geom::geometry, 3857),
                              ST_Transform(inp.geom, 3857)
                          ) <= 3
                              AND ST_Length(inp.geom::geography) > 2
                              AND ST_Length(s.geom::geography) > 2
                      )
                  )
                ORDER BY
                    s.public_id,
                    CASE
                        WHEN
                            ST_Intersects(inp.geom, s.geom::geometry)
                                AND NOT ST_Crosses(inp.geom, s.geom::geometry)
                                AND ST_Length(
                                    ST_Intersection(inp.geom, s.geom::geometry)::geography
                                ) >= 5
                            THEN 0
                        ELSE 1
                    END
            ) AS subs
            ORDER BY subs.street_name NULLS LAST, subs.street_id ASC
        `);
    }

    async hasRoadClass(roadClassId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM ref.ref_road_classes
            WHERE id = ${roadClassId}
            LIMIT 1
        `);

        return rows.length > 0;
    }

    async getRoadClassCodeById(roadClassId: bigint): Promise<string | null> {
        const rows = await this.prisma.$queryRaw<{ code: string }[]>(Prisma.sql`
            SELECT code
            FROM ref.ref_road_classes
            WHERE id = ${roadClassId}
            LIMIT 1
        `);

        return rows[0]?.code ?? null;
    }

    async listPublicRoadClasses(): Promise<{ id: string; code: string; name: string; rank: number }[]> {
        return this.prisma.$queryRaw<
            { id: string; code: string; name: string; rank: number }[]
        >(Prisma.sql`
            SELECT
                id::text AS id,
                code,
                name,
                rank::int AS rank
            FROM ref.ref_road_classes
            WHERE is_public = true
            ORDER BY rank ASC, code ASC
        `);
    }

    async listStreets(params: ListStreetsParams): Promise<StreetRow[]> {
        const whereClause = Prisma.join(streetsListFilterClauses(params), " AND ");
        const orderByClause = streetsListOrderBy(params.sortBy, params.sortOrder);
        const offset = params.offset ?? 0;

        return this.prisma.$queryRaw<StreetRow[]>(Prisma.sql`
            SELECT
                s.public_id,
                s.canonical_name,
                s.admin_area_id::text AS admin_area_id,
                aa.canonical_name AS admin_area_name,
                s.source_type_id::text AS source_type_id,
                s.road_class_id::text AS road_class_id,
                rc.code AS road_class,
                rc.name AS road_class_name,
                s.surface,
                s.is_oneway,
                s.bridge,
                s.tunnel,
                s.manual_override,
                s.edit_status,
                s.routing_status,
                s.deleted_at,
                s.last_edited_at,
                s.is_active,
                s.verification_status,
                s.is_verified,
                s.created_at,
                s.updated_at,
                CASE
                    WHEN s.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(s.geom)::json
                END AS geometry,
                COALESCE(street_names.names, '[]'::json) AS names,
                street_names.myanmar_name,
                street_names.english_name
            FROM core.core_streets AS s
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = s.admin_area_id
            LEFT JOIN ref.ref_road_classes AS rc
                ON rc.id = s.road_class_id
            LEFT JOIN LATERAL (${streetNamesJsonSql()}) AS street_names ON true
            WHERE ${whereClause}
            ORDER BY ${orderByClause}
            LIMIT ${params.limit}
            OFFSET ${offset}
        `);
    }

    /**
     * Core-review table list — phase-1 index scan on core_streets, then batch enrichment
     * for names/admin/road-class on the returned ids only (no COUNT, no geometry).
     */
    async listStreetsCoreReview(params: ListStreetsParams): Promise<StreetCoreReviewListRow[]> {
        return this.listStreetsCoreReviewFast(params);
    }

    /**
     * Fast path: single-table (or admin join when sorting by admin_area) LIMIT/O keyset,
     * then batch lookups for display labels on ≤51 rows.
     */
    async listStreetsCoreReviewFast(params: ListStreetsParams): Promise<StreetCoreReviewListRow[]> {
        const limit = Math.min(params.limit, CORE_REVIEW_STREETS_MAX_PAGE_SIZE + 1);
        const coreRows = await this.listStreetsCoreReviewCore(params, limit);
        if (coreRows.length === 0) {
            return [];
        }

        const streetIds = coreRows.map((row) => BigInt(row.id));
        const adminAreaIds = [
            ...new Set(
                coreRows
                    .map((row) => row.admin_area_id)
                    .filter((id): id is string => id !== null && id !== "")
                    .map((id) => BigInt(id)),
            ),
        ];
        const roadClassIds = [
            ...new Set(
                coreRows
                    .map((row) => row.road_class_id)
                    .filter((id): id is string => id !== null && id !== "")
                    .map((id) => BigInt(id)),
            ),
        ];

        const [namesByStreetId, adminNameById, roadClassById] = await Promise.all([
            this.batchPrimaryStreetNames(streetIds),
            this.batchAdminAreaCanonicalNames(adminAreaIds),
            this.batchRoadClassLabels(roadClassIds),
        ]);

        return coreRows.map((row) => {
            const names = namesByStreetId.get(row.id);
            const roadClass = row.road_class_id ? roadClassById.get(row.road_class_id) : undefined;
            return {
                ...row,
                admin_area_name: row.admin_area_id ? (adminNameById.get(row.admin_area_id) ?? null) : null,
                road_class: roadClass?.code ?? row.road_class,
                road_class_name: roadClass?.name ?? null,
                myanmar_name: names?.myanmar_name ?? null,
                english_name: names?.english_name ?? null,
            };
        });
    }

    /** Phase-1 core list — single-table scan, no geometry, no name/admin/road-class joins. */
    private async listStreetsCoreReviewCore(
        params: ListStreetsParams,
        limit: number,
    ): Promise<StreetCoreReviewListCoreRow[]> {
        const updatedAtSort = params.sortBy === "updated" || params.sortBy === "updated_at";
        if (updatedAtSort) {
            return this.listStreetsCoreReviewCoreUpdatedAtTwoPhase(params, limit);
        }

        return this.listStreetsCoreReviewCoreSingleQuery(params, limit);
    }

    /**
     * Default dashboard path: index probe (id, updated_at) then fetch ≤51 rows by id.
     * Avoids planner choosing parallel seq scan when wide columns appear in ORDER BY … LIMIT.
     */
    private async listStreetsCoreReviewCoreUpdatedAtTwoPhase(
        params: ListStreetsParams,
        limit: number,
    ): Promise<StreetCoreReviewListCoreRow[]> {
        const whereClause = Prisma.join(streetsListFilterClauses(params), " AND ");
        const orderByClause = streetsUpdatedAtKeysetOrderBy(params.sortOrder);
        const keysetClause = streetsKeysetClause(params, params.sortBy, params.sortOrder);
        const timingMeta = {
            has_search: params.q !== undefined,
            sort_by: params.sortBy,
            limit,
            offset: 0,
            keyset: params.cursor_updated_at !== undefined && params.cursor_id !== undefined,
            fast_list: true,
            two_phase: true,
            status: resolveStreetsListStatus(params),
        };

        return timeStreetsCoreReviewQuery("list", timingMeta, async () => {
            const idRows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
                SELECT s.id::text AS id
                FROM core.core_streets AS s
                WHERE ${whereClause}
                ${keysetClause}
                ORDER BY ${orderByClause}
                LIMIT ${limit}
            `);

            if (idRows.length === 0) {
                return [];
            }

            const ids = idRows.map((row) => BigInt(row.id));

            return this.prisma.$queryRaw<StreetCoreReviewListCoreRow[]>(Prisma.sql`
                SELECT
                    s.id::text AS id,
                    s.public_id,
                    s.canonical_name,
                    s.admin_area_id::text AS admin_area_id,
                    s.road_class_id::text AS road_class_id,
                    rc.code AS road_class,
                    s.surface,
                    s.is_oneway,
                    s.bridge,
                    s.tunnel,
                    s.routing_status,
                    s.deleted_at,
                    s.is_active,
                    s.verification_status,
                    s.is_verified,
                    s.created_at,
                    s.updated_at
                FROM core.core_streets AS s
                LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
                WHERE s.id IN (${Prisma.join(ids)})
                ORDER BY ${orderByClause}
            `);
        });
    }

    /** Non-updated_at sorts — single query (may use offset for page > 1). */
    private async listStreetsCoreReviewCoreSingleQuery(
        params: ListStreetsParams,
        limit: number,
    ): Promise<StreetCoreReviewListCoreRow[]> {
        const whereClause = Prisma.join(streetsListFilterClauses(params), " AND ");
        const orderByClause = streetsListOrderBy(params.sortBy, params.sortOrder);
        const keysetClause = streetsKeysetClause(params, params.sortBy, params.sortOrder);
        const useKeyset = params.cursor_updated_at !== undefined && params.cursor_id !== undefined;
        const updatedAtSort = params.sortBy === "updated" || params.sortBy === "updated_at";
        const useAdminJoin = params.sortBy === "admin_area";
        const useOffset =
            !useKeyset &&
            !updatedAtSort &&
            (params.offset ?? 0) > 0;
        const offset = useKeyset || !useOffset ? 0 : (params.offset ?? 0);
        const timingMeta = {
            has_search: params.q !== undefined,
            sort_by: params.sortBy,
            limit,
            offset,
            keyset: useKeyset,
            fast_list: true,
            status: resolveStreetsListStatus(params),
        };

        const adminAreaJoinSql = useAdminJoin
            ? Prisma.sql`LEFT JOIN core.core_admin_areas AS aa ON aa.id = s.admin_area_id`
            : Prisma.empty;

        const offsetSql = offset > 0 ? Prisma.sql`OFFSET ${offset}` : Prisma.empty;

        return timeStreetsCoreReviewQuery("list", timingMeta, () =>
            this.prisma.$queryRaw<StreetCoreReviewListCoreRow[]>(Prisma.sql`
                SELECT
                    s.id::text AS id,
                    s.public_id,
                    s.canonical_name,
                    s.admin_area_id::text AS admin_area_id,
                    s.road_class_id::text AS road_class_id,
                    rc.code AS road_class,
                    s.surface,
                    s.is_oneway,
                    s.bridge,
                    s.tunnel,
                    s.routing_status,
                    s.deleted_at,
                    s.is_active,
                    s.verification_status,
                    s.is_verified,
                    s.created_at,
                    s.updated_at
                FROM core.core_streets AS s
                LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
                ${adminAreaJoinSql}
                WHERE ${whereClause}
                ${keysetClause}
                ORDER BY ${orderByClause}
                LIMIT ${limit}
                ${offsetSql}
            `),
        );
    }

    private async batchPrimaryStreetNames(
        streetIds: bigint[],
    ): Promise<Map<string, { myanmar_name: string | null; english_name: string | null }>> {
        if (streetIds.length === 0) {
            return new Map();
        }

        const rows = await this.prisma.$queryRaw<
            { street_id: string; myanmar_name: string | null; english_name: string | null }[]
        >(Prisma.sql`
            SELECT
                sn.street_id::text AS street_id,
                max(sn.name) FILTER (
                    WHERE lower(trim(coalesce(sn.language_code, ''))) = 'my'
                ) AS myanmar_name,
                max(sn.name) FILTER (
                    WHERE lower(trim(coalesce(sn.language_code, ''))) = 'en'
                ) AS english_name
            FROM core.core_street_names AS sn
            WHERE sn.street_id IN (${Prisma.join(streetIds)})
            GROUP BY sn.street_id
        `);

        return new Map(rows.map((row) => [row.street_id, row]));
    }

    private async batchAdminAreaCanonicalNames(adminAreaIds: bigint[]): Promise<Map<string, string>> {
        if (adminAreaIds.length === 0) {
            return new Map();
        }

        const rows = await this.prisma.$queryRaw<{ id: string; canonical_name: string }[]>(Prisma.sql`
            SELECT id::text AS id, canonical_name
            FROM core.core_admin_areas
            WHERE id IN (${Prisma.join(adminAreaIds)})
        `);

        return new Map(rows.map((row) => [row.id, row.canonical_name]));
    }

    private async batchRoadClassLabels(
        roadClassIds: bigint[],
    ): Promise<Map<string, { code: string; name: string }>> {
        if (roadClassIds.length === 0) {
            return new Map();
        }

        const rows = await this.prisma.$queryRaw<{ id: string; code: string; name: string }[]>(Prisma.sql`
            SELECT id::text AS id, code, name
            FROM ref.ref_road_classes
            WHERE id IN (${Prisma.join(roadClassIds)})
        `);

        return new Map(rows.map((row) => [row.id, { code: row.code, name: row.name }]));
    }

    /**
     * Scope totals for header chips — one pass, no verification filter, no joins.
     */
    async countStreetsCoreReviewScopeBreakdown(
        params: StreetsListFilterParams,
    ): Promise<StreetsCoreReviewScopeCounts> {
        const whereClause = Prisma.join(streetsScopeFilterClauses(params), " AND ");
        const timingMeta = {
            has_search: params.q !== undefined,
            has_admin_area_filter: params.admin_area_id !== undefined,
            has_road_class_filter: params.road_class_id !== undefined,
            status: resolveStreetsListStatus(params),
            join_mode: "none",
            mode: "scope_breakdown",
        };

        return timeStreetsCoreReviewQuery("count", timingMeta, async () => {
            const rows = await this.prisma.$queryRaw<
                { total: bigint; verified: bigint; unverified: bigint }[]
            >(Prisma.sql`
                SELECT
                    COUNT(*)::bigint AS total,
                    COUNT(*) FILTER (
                        WHERE ${effectiveVerificationStatusExpr("s")} = 'verified'
                    )::bigint AS verified,
                    COUNT(*) FILTER (
                        WHERE ${effectiveVerificationStatusExpr("s")} = 'unverified'
                    )::bigint AS unverified
                FROM core.core_streets AS s
                WHERE ${whereClause}
            `);

            const row = rows[0];
            return {
                total: Number(row?.total ?? 0n),
                verified: Number(row?.verified ?? 0n),
                unverified: Number(row?.unverified ?? 0n),
            };
        });
    }

    /**
     * Core-review list total — single-table COUNT(*) with filter-specific EXISTS only.
     * Never selects geometry or joins names/admin/road classes in FROM.
     */
    async countStreetsCoreReview(params: StreetsListFilterParams): Promise<number> {
        const whereClause = Prisma.join(streetsCountFilterClauses(params), " AND ");
        const timingMeta = {
            has_search: params.q !== undefined,
            has_admin_area_filter: params.admin_area_id !== undefined,
            has_road_class_filter: params.road_class_id !== undefined,
            has_verification_filter: params.verification_status !== undefined,
            status: resolveStreetsListStatus(params),
            join_mode: "none",
        };

        return timeStreetsCoreReviewQuery("count", timingMeta, async () => {
            const rows = await this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
                SELECT COUNT(*)::bigint AS count
                FROM core.core_streets AS s
                WHERE ${whereClause}
            `);
            return Number(rows[0]?.count ?? 0n);
        });
    }

    /** @deprecated Prefer countStreetsCoreReview for dashboard core-review lists. */
    async countStreets(params: StreetsListFilterParams): Promise<number> {
        return this.countStreetsCoreReview(params);
    }

    /**
     * Active streets intersecting a map viewport bbox — GIST-friendly `&&` probe plus ST_Intersects.
     * No COUNT, no admin/road-class joins; primary names batched for returned ids only.
     */
    async listStreetsInMapBbox(params: {
        minLng: number;
        minLat: number;
        maxLng: number;
        maxLat: number;
        limit: number;
    }): Promise<
        Array<
            StreetMapBboxRow & {
                myanmar_name: string | null;
                english_name: string | null;
            }
        >
    > {
        const envelopeSql = Prisma.sql`ST_MakeEnvelope(
            ${params.minLng}::double precision,
            ${params.minLat}::double precision,
            ${params.maxLng}::double precision,
            ${params.maxLat}::double precision,
            4326
        )`;

        const coreRows = await this.prisma.$queryRaw<StreetMapBboxRow[]>(Prisma.sql`
            SELECT
                s.id::text AS id,
                s.public_id,
                s.canonical_name,
                rc.code AS road_class,
                s.is_active,
                s.deleted_at,
                ST_AsGeoJSON(s.geom)::json AS geometry
            FROM core.core_streets AS s
            LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
            WHERE s.deleted_at IS NULL
              AND s.is_active IS TRUE
              AND s.geom IS NOT NULL
              AND s.geom && ${envelopeSql}
              AND ST_Intersects(s.geom, ${envelopeSql})
            LIMIT ${params.limit}
        `);

        if (coreRows.length === 0) {
            return [];
        }

        const namesByStreetId = await this.batchPrimaryStreetNames(
            coreRows.map((row) => BigInt(row.id)),
        );

        return coreRows.map((row) => {
            const names = namesByStreetId.get(row.id);
            return {
                ...row,
                myanmar_name: names?.myanmar_name ?? null,
                english_name: names?.english_name ?? null,
            };
        });
    }

    /**
     * Find the closest point on active street geometry within radius (geodesic).
     * Uses ST_ClosestPoint so snapping can target the line interior or endpoints.
     */
    async findNearestStreetPoint(params: {
        lat: number;
        lng: number;
        radiusMeters: number;
        excludePublicId?: string | null;
        excludeInternalStreetId?: bigint | null;
    }): Promise<NearestStreetPointRow | null> {
        const excludeClause = editedStreetExcludeSql(params.excludePublicId, params.excludeInternalStreetId);

        const rows = await this.prisma.$queryRaw<NearestStreetPointRow[]>(Prisma.sql`
            WITH query_pt AS (
                SELECT
                    ST_SetSRID(ST_MakePoint(${params.lng}::double precision, ${params.lat}::double precision), 4326)
                        AS geom,
                    ST_SetSRID(ST_MakePoint(${params.lng}::double precision, ${params.lat}::double precision), 4326)::geography
                        AS geog
            )
            SELECT
                s.public_id::text AS street_id,
                ST_X(ST_ClosestPoint(s.geom::geometry, (SELECT geom FROM query_pt))::geometry) AS nearest_lng,
                ST_Y(ST_ClosestPoint(s.geom::geometry, (SELECT geom FROM query_pt))::geometry) AS nearest_lat,
                ST_Distance(
                    (SELECT geog FROM query_pt),
                    ST_ClosestPoint(s.geom::geometry, (SELECT geom FROM query_pt))::geography
                ) AS distance_m,
                s.canonical_name AS street_name,
                COALESCE(rc.name, rc.code) AS road_class
            FROM core.core_streets AS s
            CROSS JOIN query_pt AS pt
            LEFT JOIN ref.ref_road_classes AS rc
                ON rc.id = s.road_class_id
            WHERE s.deleted_at IS NULL
              AND s.is_active IS TRUE
              AND s.geom IS NOT NULL
              ${excludeClause}
              AND ST_DWithin(s.geom::geography, pt.geog, ${params.radiusMeters}::double precision)
            ORDER BY ST_Distance(
                pt.geog,
                ST_ClosestPoint(s.geom::geometry, (SELECT geom FROM query_pt))::geography
            ) ASC
            LIMIT 1
        `);

        const row = rows[0];

        return row ?? null;
    }

    async getStreetByPublicId(
        publicId: string,
        db: DbClient = this.prisma,
        options: { includeDeleted?: boolean; anyStatus?: boolean } = {},
    ): Promise<StreetRow | null> {
        const lifecycleClause =
            options.anyStatus === true || options.includeDeleted === true
                ? Prisma.sql`TRUE`
                : coreReviewListStatusClause("s", "active", {
                      hasDeletedAt: true,
                      hasIsActive: true,
                  });

        const rows = await db.$queryRaw<StreetRow[]>(Prisma.sql`
            SELECT
                s.public_id,
                s.canonical_name,
                s.admin_area_id::text AS admin_area_id,
                aa.canonical_name AS admin_area_name,
                s.source_type_id::text AS source_type_id,
                s.road_class_id::text AS road_class_id,
                rc.code AS road_class,
                rc.name AS road_class_name,
                s.surface,
                s.is_oneway,
                s.bridge,
                s.tunnel,
                s.manual_override,
                s.edit_status,
                s.routing_status,
                s.deleted_at,
                s.last_edited_at,
                s.is_active,
                s.verification_status,
                s.is_verified,
                s.created_at,
                s.updated_at,
                CASE
                    WHEN s.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(s.geom)::json
                END AS geometry,
                COALESCE(street_names.names, '[]'::json) AS names,
                street_names.myanmar_name,
                street_names.english_name
            FROM core.core_streets AS s
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = s.admin_area_id
            LEFT JOIN ref.ref_road_classes AS rc
                ON rc.id = s.road_class_id
            LEFT JOIN LATERAL (${streetNamesJsonSql()}) AS street_names ON true
            WHERE s.public_id = CAST(${publicId} AS uuid)
              AND (${lifecycleClause})
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async hasActiveAdminArea(adminAreaId: bigint): Promise<boolean> {
        const adminArea = await this.prisma.coreAdminArea.findFirst({
            where: {
                id: adminAreaId,
                isActive: true,
            },
            select: {
                id: true,
            },
        });

        return Boolean(adminArea);
    }

    async getSourceTypeIdByCode(code: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM ref.ref_source_types
            WHERE code = ${code}
            LIMIT 1
        `);

        return rows[0]?.id ?? null;
    }

    async hasSourceType(sourceTypeId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM ref.ref_source_types
            WHERE id = ${sourceTypeId}
            LIMIT 1
        `);

        return rows.length > 0;
    }

    async createStreet(input: CreateStreetInput): Promise<StreetRow | null> {
        if (!input.geometry || input.geometry.type !== "LineString") {
            throw new StreetCrudValidationError("geometry must be a LineString");
        }

        const roadClassCode = await this.getRoadClassCodeById(input.road_class_id);
        if (!roadClassCode) {
            throw new StreetCrudValidationError("road_class_id not found");
        }

        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<{ public_id: string }[]>(Prisma.sql`
                INSERT INTO core.core_streets (
                    canonical_name,
                    geom,
                    admin_area_id,
                    source_type_id,
                    is_active,
                    road_class_id,
                    road_class,
                    surface,
                    is_oneway,
                    bridge,
                    tunnel,
                    manual_override,
                    edit_status,
                    routing_status,
                    last_edited_at,
                    verification_status,
                    is_verified,
                    created_at,
                    updated_at
                )
                VALUES (
                    ${input.canonical_name},
                    ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}::json), 4326),
                    ${input.admin_area_id ?? null},
                    ${input.source_type_id},
                    ${input.is_active ?? true},
                    ${input.road_class_id},
                    ${roadClassCode},
                    ${input.surface ?? null},
                    ${input.is_oneway},
                    ${input.bridge},
                    ${input.tunnel},
                    ${input.manual_override ?? false},
                    'published',
                    'needs_rebuild',
                    now(),
                    ${input.verification_status ?? "unverified"},
                    ${input.is_verified ?? false},
                    now(),
                    now()
                )
                RETURNING public_id
            `);

            const publicId = rows[0]?.public_id;

            if (!publicId) {
                return null;
            }

            await this.syncOfficialStreetName(tx, publicId, "my", input.myanmarName);
            await this.syncOfficialStreetName(tx, publicId, "en", input.englishName);

            return this.getStreetByPublicId(publicId, tx, { includeDeleted: true });
        });
    }

    async updateStreet(
        publicId: string,
        input: UpdateStreetInput,
        context?: StreetMutationContext,
        options?: { existing?: StreetRow | null },
    ): Promise<StreetRow | null> {
        const roadClassId = input.road_class_id;
        const isOneway = input.is_oneway;

        const existing = await timeStreetUpdateStep("prefetch_existing", { publicId }, async () => {
            if (options?.existing) {
                return options.existing;
            }
            return this.getStreetByPublicId(publicId, this.prisma, { includeDeleted: true });
        });

        if (!existing || existing.deleted_at) {
            return null;
        }

        if (input.geometry) {
            await timeStreetUpdateStep("geometry_validation", { publicId }, () =>
                this.assertValidCenterline(input.geometry!),
            );
        }

        const myanmarChanged = streetOfficialNameShouldSync(existing.myanmar_name, input.myanmarName);
        const englishChanged = streetOfficialNameShouldSync(existing.english_name, input.englishName);
        const roadClassIdChanged = streetRoadClassIdChanged(existing.road_class_id, roadClassId);
        const routingGraphTouched = streetUpdateTouchesRoutingGraph(input, existing, roadClassIdChanged);
        const needsDetailReload = streetUpdateNeedsDetailReload({
            input,
            existing,
            myanmarChanged,
            englishChanged,
            roadClassIdChanged,
        });

        let roadClassCode: string | null | undefined;
        if (roadClassIdChanged && roadClassId !== null && roadClassId !== undefined) {
            roadClassCode = await timeStreetUpdateStep("road_class_lookup", { publicId }, () =>
                this.getRoadClassCodeById(roadClassId),
            );
            if (!roadClassCode) {
                throw new StreetCrudValidationError("road_class_id not found");
            }
        }

        return timeStreetUpdateStep(
            "transaction_total",
            {
                publicId,
                myanmarChanged,
                englishChanged,
                geometryChanged: Boolean(input.geometry),
                roadClassIdChanged,
                needsDetailReload,
                routingGraphTouched,
            },
            () =>
                this.prisma.$transaction(async (tx) => {
                    await timeStreetUpdateStep("versioning_session", { publicId }, () =>
                        applyStreetVersioningSession(tx, context),
                    );

                    if (myanmarChanged) {
                        await timeStreetUpdateStep("sync_name_my", { publicId }, () =>
                            this.syncOfficialStreetName(tx, publicId, "my", input.myanmarName),
                        );
                    }

                    if (englishChanged) {
                        await timeStreetUpdateStep("sync_name_en", { publicId }, () =>
                            this.syncOfficialStreetName(tx, publicId, "en", input.englishName),
                        );
                    }

                    const assignments: Prisma.Sql[] = [
                        Prisma.sql`updated_at = now()`,
                        Prisma.sql`last_edited_at = now()`,
                        Prisma.sql`manual_override = ${input.manual_override ?? true}`,
                    ];

                    if (routingGraphTouched) {
                        assignments.push(Prisma.sql`routing_status = 'needs_rebuild'`);
                    }

                    if (myanmarChanged || englishChanged) {
                        const canonicalName = deriveCanonicalNameAfterNameEdits({
                            existing,
                            myanmarChanged,
                            englishChanged,
                            myanmarName: input.myanmarName,
                            englishName: input.englishName,
                        });
                        if (canonicalName !== existing.canonical_name) {
                            assignments.push(Prisma.sql`canonical_name = ${canonicalName}`);
                        }
                    }

                    if (input.admin_area_id !== undefined) {
                        assignments.push(Prisma.sql`admin_area_id = ${input.admin_area_id}`);
                    }

                    if (input.geometry) {
                        assignments.push(
                            Prisma.sql`geom = ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}::json), 4326)`,
                        );
                    }

                    if (roadClassIdChanged) {
                        if (roadClassId === null) {
                            assignments.push(Prisma.sql`road_class_id = NULL`);
                            assignments.push(Prisma.sql`road_class = NULL`);
                        } else {
                            assignments.push(Prisma.sql`road_class_id = ${roadClassId}`);
                            assignments.push(Prisma.sql`road_class = ${roadClassCode}`);
                        }
                    }

                    if (isOneway !== undefined) {
                        assignments.push(Prisma.sql`is_oneway = ${isOneway}`);
                    }

                    if (input.surface !== undefined) {
                        assignments.push(Prisma.sql`surface = ${input.surface}`);
                    }

                    if (input.bridge !== undefined) {
                        assignments.push(Prisma.sql`bridge = ${input.bridge}`);
                    }

                    if (input.tunnel !== undefined) {
                        assignments.push(Prisma.sql`tunnel = ${input.tunnel}`);
                    }

                    if (input.verification_status !== undefined) {
                        assignments.push(Prisma.sql`verification_status = ${input.verification_status}`);
                    }

                    if (input.is_verified !== undefined) {
                        assignments.push(Prisma.sql`is_verified = ${input.is_verified}`);
                    }

                    const updatedCount = await timeStreetUpdateStep("street_update", { publicId }, () =>
                        tx.$executeRaw(Prisma.sql`
                            UPDATE core.core_streets
                            SET ${Prisma.join(assignments, ", ")}
                            WHERE public_id = CAST(${publicId} AS uuid)
                              AND deleted_at IS NULL
                        `),
                    );

                    if (Number(updatedCount) === 0) {
                        return null;
                    }

                    if (needsDetailReload) {
                        return timeStreetUpdateStep("detail_reload", { publicId }, () =>
                            this.getStreetByPublicId(publicId, tx, { includeDeleted: true }),
                        );
                    }

                    return applyStreetRowAfterScalarUpdate(existing, input, {
                        canonical_name:
                            myanmarChanged || englishChanged
                                ? deriveCanonicalNameAfterNameEdits({
                                      existing,
                                      myanmarChanged,
                                      englishChanged,
                                      myanmarName: input.myanmarName,
                                      englishName: input.englishName,
                                  })
                                : undefined,
                        myanmar_name: myanmarChanged ? (input.myanmarName?.trim() ?? null) : undefined,
                        english_name: englishChanged ? (input.englishName?.trim() ?? null) : undefined,
                        routing_status: routingGraphTouched ? "needs_rebuild" : undefined,
                        manual_override: input.manual_override ?? true,
                    });
                }),
        );
    }

    async softDeleteStreet(publicId: string, context?: StreetMutationContext): Promise<StreetRow | null> {
        const existing = await this.getStreetByPublicId(publicId, this.prisma, { includeDeleted: true });
        if (!existing || existing.deleted_at) {
            return null;
        }

        return this.prisma.$transaction(async (tx) => {
            await applyStreetVersioningSession(tx, context);

            const updatedCount = await tx.$executeRaw(Prisma.sql`
                UPDATE core.core_streets
                SET
                    is_active = false,
                    deleted_at = now(),
                    updated_at = now(),
                    last_edited_at = now(),
                    manual_override = true,
                    routing_status = 'needs_rebuild'
                WHERE public_id = CAST(${publicId} AS uuid)
                  AND deleted_at IS NULL
            `);

            if (Number(updatedCount) === 0) {
                return null;
            }

            return this.getStreetByPublicId(publicId, tx, { anyStatus: true });
        });
    }

    async restoreStreet(publicId: string, context?: StreetMutationContext): Promise<StreetRow | null> {
        const existing = await this.getStreetByPublicId(publicId, this.prisma, { anyStatus: true });
        if (!existing || (existing.deleted_at === null && existing.is_active)) {
            return null;
        }

        return this.prisma.$transaction(async (tx) => {
            await applyStreetVersioningSession(tx, context);

            const updatedCount = await tx.$executeRaw(Prisma.sql`
                UPDATE core.core_streets
                SET
                    is_active = true,
                    deleted_at = null,
                    updated_at = now(),
                    last_edited_at = now(),
                    manual_override = true,
                    routing_status = 'needs_rebuild'
                WHERE public_id = CAST(${publicId} AS uuid)
                  AND (deleted_at IS NOT NULL OR is_active IS FALSE)
            `);

            if (Number(updatedCount) === 0) {
                return null;
            }

            return this.getStreetByPublicId(publicId, tx, { anyStatus: true });
        });
    }

    /**
     * Split an active street at the closest point along its LineString to `splitLng`/`splitLat`.
     * Soft-deletes the original row via UPDATE (version trigger), inserts two successors, copies every `core_street_names` row to both streets.
     * Does not touch routing tables.
     */
    async splitStreetAtPoint(
        streetId: StreetLookupRef,
        splitLng: number,
        splitLat: number,
        context?: StreetMutationContext,
    ): Promise<{ originalStreetId: string; newStreets: [StreetRow, StreetRow] } | null> {
        const snappedMaxDistanceM = 5;
        const minFraction = 1e-6;

        type SplitPrepRow = {
            street_internal_id: string;
            original_street_id: string;
            canonical_name: string;
            admin_area_id: string | null;
            source_type_id: string;
            road_class_id: string | null;
            road_class: string | null;
            surface: string | null;
            is_oneway: boolean;
            bridge: boolean;
            tunnel: boolean;
            layer: number;
            source_tags: Prisma.JsonValue | null;
            is_verified: boolean;
            seg_a_geojson: Prisma.JsonValue;
            seg_b_geojson: Prisma.JsonValue;
        };

        return this.prisma.$transaction(async (tx) => {
            await applyStreetVersioningSession(tx, context);

            const splitRows = await tx.$queryRaw<SplitPrepRow[]>(Prisma.sql`
                WITH s AS MATERIALIZED (
                    SELECT
                        s_inner.id AS street_internal_id,
                        s_inner.canonical_name,
                        s_inner.admin_area_id,
                        s_inner.source_type_id,
                        s_inner.road_class_id,
                        s_inner.road_class,
                        s_inner.surface,
                        s_inner.is_oneway,
                        s_inner.bridge,
                        s_inner.tunnel,
                        s_inner.layer,
                        s_inner.source_tags,
                        s_inner.is_verified,
                        CASE
                            WHEN ST_GeometryType(s_inner.geom::geometry) = 'ST_LineString'
                                THEN s_inner.geom::geometry
                            ELSE NULL
                        END AS line_g
                    FROM core.core_streets AS s_inner
                    WHERE ${streetLookupSql(streetId)}
                      AND s_inner.deleted_at IS NULL
                      AND s_inner.is_active IS TRUE
                    FOR UPDATE
                ),
                param AS (
                    SELECT
                        ST_SetSRID(ST_MakePoint(${splitLng}::double precision, ${splitLat}::double precision), 4326)::geometry AS q_geom,
                        ST_SetSRID(ST_MakePoint(${splitLng}::double precision, ${splitLat}::double precision), 4326)::geography AS q_geog
                ),
                prep AS (
                    SELECT
                        s.street_internal_id,
                        s.canonical_name,
                        s.admin_area_id,
                        s.source_type_id,
                        s.road_class_id,
                        s.road_class,
                        s.surface,
                        s.is_oneway,
                        s.bridge,
                        s.tunnel,
                        s.layer,
                        s.source_tags,
                        s.is_verified,
                        s.line_g,
                        ST_ClosestPoint(s.line_g, (SELECT q_geom FROM param)) AS snap_pt,
                        ST_LineLocatePoint(s.line_g, ST_ClosestPoint(s.line_g, (SELECT q_geom FROM param))) AS frac
                    FROM s
                    CROSS JOIN param
                    WHERE s.line_g IS NOT NULL
                ),
                measured AS (
                    SELECT
                        prep.*,
                        ST_Distance(ST_ClosestPoint(prep.line_g, (SELECT q_geom FROM param))::geography, (SELECT q_geog FROM param))
                            AS snap_distance_m,
                        ST_LineSubstring(prep.line_g, 0::float8, prep.frac) AS seg_a,
                        ST_LineSubstring(prep.line_g, prep.frac, 1::float8) AS seg_b
                    FROM prep
                )
                SELECT
                    m.street_internal_id::text AS street_internal_id,
                    (
                        SELECT public_id::text
                        FROM core.core_streets
                        WHERE id = m.street_internal_id
                    ) AS original_street_id,
                    m.canonical_name,
                    CASE WHEN m.admin_area_id IS NULL THEN NULL ELSE m.admin_area_id::text END AS admin_area_id,
                    m.source_type_id::text AS source_type_id,
                    CASE WHEN m.road_class_id IS NULL THEN NULL ELSE m.road_class_id::text END AS road_class_id,
                    m.road_class,
                    m.surface,
                    m.is_oneway,
                    m.bridge,
                    m.tunnel,
                    m.layer::int AS layer,
                    m.source_tags,
                    m.is_verified,
                    ST_AsGeoJSON(m.seg_a)::json AS seg_a_geojson,
                    ST_AsGeoJSON(m.seg_b)::json AS seg_b_geojson
                FROM measured AS m
                WHERE m.snap_distance_m <= ${snappedMaxDistanceM}::double precision
                  AND m.frac > ${minFraction}::double precision
                  AND m.frac < (1::double precision - ${minFraction}::double precision)
                  AND ST_GeometryType(m.seg_a::geometry) = 'ST_LineString'
                  AND ST_GeometryType(m.seg_b::geometry) = 'ST_LineString'
                  AND ST_Length(m.seg_a::geography) > 2::double precision
                  AND ST_Length(m.seg_b::geography) > 2::double precision
            `);

            if (splitRows.length === 0) {
                const stillThere = await tx.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                    SELECT id
                    FROM core.core_streets AS s_inner
                    WHERE ${streetLookupSql(streetId)}
                      AND deleted_at IS NULL
                      AND is_active IS TRUE
                    LIMIT 1
                `);
                if (stillThere.length === 0) {
                    return null;
                }
                throw new StreetCrudValidationError(
                    "Cannot split here: pick a point on this street interior, within 5 m of the stored LineString centerline, where each resulting segment is longer than 2 m. MultiLineString is not supported.",
                );
            }

            const row = splitRows[0]!;
            const oldStreetId = BigInt(row.street_internal_id);
            const adminAreaDb = row.admin_area_id !== null ? BigInt(row.admin_area_id) : null;
            const sourceTypeDb = BigInt(row.source_type_id);
            const roadClassDb = row.road_class_id !== null ? BigInt(row.road_class_id) : null;

            const segA = lineStringGeoJsonFromJsonValue(row.seg_a_geojson);
            const segB = lineStringGeoJsonFromJsonValue(row.seg_b_geojson);
            await this.assertValidCenterline(segA);
            await this.assertValidCenterline(segB);

            const sourceTagsSql =
                row.source_tags === null || row.source_tags === undefined
                    ? Prisma.sql`NULL`
                    : Prisma.sql`CAST(${JSON.stringify(row.source_tags)} AS jsonb)`;

            const updatedCount = await tx.$executeRaw(Prisma.sql`
                UPDATE core.core_streets
                SET
                    is_active = false,
                    deleted_at = now(),
                    updated_at = now(),
                    last_edited_at = now(),
                    manual_override = true,
                    routing_status = 'needs_rebuild'
                WHERE id = ${oldStreetId}
                  AND deleted_at IS NULL
                  AND is_active IS TRUE
            `);

            if (Number(updatedCount) === 0) {
                throw new StreetCrudValidationError("Street changed while splitting; reload and retry.");
            }

            const geomAJson = JSON.stringify(segA);
            const geomBJson = JSON.stringify(segB);

            const insertReturning = async (geomGeojsonJson: string) => {
                const ins = await tx.$queryRaw<{ public_id: string }[]>(Prisma.sql`
                    INSERT INTO core.core_streets (
                        canonical_name,
                        geom,
                        admin_area_id,
                        source_type_id,
                        is_active,
                        road_class_id,
                        road_class,
                        surface,
                        is_oneway,
                        bridge,
                        tunnel,
                        layer,
                        source_tags,
                        is_verified,
                        manual_override,
                        edit_status,
                        routing_status,
                        last_edited_at,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ${row.canonical_name},
                        ST_SetSRID(ST_GeomFromGeoJSON(${geomGeojsonJson}::json), 4326),
                        ${adminAreaDb},
                        ${sourceTypeDb},
                        true,
                        ${roadClassDb},
                        ${row.road_class},
                        ${row.surface},
                        ${row.is_oneway},
                        ${row.bridge},
                        ${row.tunnel},
                        ${row.layer},
                        ${sourceTagsSql},
                        ${row.is_verified},
                        true,
                        'published',
                        'needs_rebuild',
                        now(),
                        now(),
                        now()
                    )
                    RETURNING public_id::text
                `);
                const nid = ins[0]?.public_id;
                if (!nid) {
                    throw new StreetCrudValidationError("failed to insert split street segment");
                }
                return nid;
            };

            const publicIdA = await insertReturning(geomAJson);
            const publicIdB = await insertReturning(geomBJson);

            await this.duplicateAllStreetNamesForNewStreet(tx, oldStreetId, publicIdA);
            await this.duplicateAllStreetNamesForNewStreet(tx, oldStreetId, publicIdB);

            const a = await this.getStreetByPublicId(publicIdA, tx, { includeDeleted: true });
            const b = await this.getStreetByPublicId(publicIdB, tx, { includeDeleted: true });
            if (!a || !b) {
                throw new StreetCrudValidationError("split completed but streets could not be reloaded");
            }
            return {
                originalStreetId: row.original_street_id,
                newStreets: [a, b] as [StreetRow, StreetRow],
            };
        });
    }

    private async duplicateAllStreetNamesForNewStreet(
        tx: Prisma.TransactionClient,
        sourceStreetInternalId: bigint,
        targetPublicId: string,
    ) {
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO core.core_street_names (
                street_id,
                name,
                language_code,
                script_code,
                name_type,
                is_primary
            )
            SELECT
                tgt.id,
                sn.name,
                sn.language_code,
                sn.script_code,
                sn.name_type,
                sn.is_primary
            FROM core.core_street_names AS sn
            INNER JOIN core.core_streets AS tgt
                ON tgt.public_id = CAST(${targetPublicId} AS uuid)
            WHERE sn.street_id = ${sourceStreetInternalId}
        `);
    }

    private async syncOfficialStreetName(
        tx: Prisma.TransactionClient,
        publicId: string,
        languageCode: "my" | "en",
        value: string | undefined,
    ) {
        if (value === undefined) {
            return;
        }

        if (value.trim() === "") {
            return;
        }

        const updatedRows =
            languageCode === "my"
                ? await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_street_names AS sn
                    SET
                        name = ${value.trim()},
                        language_code = 'my',
                        script_code = 'Mymr'
                    FROM core.core_streets AS s
                    WHERE s.id = sn.street_id
                      AND s.public_id = CAST(${publicId} AS uuid)
                      AND sn.language_code = 'my'
                      AND upper(trim(coalesce(sn.script_code, ''))) = 'MYMR'
                      AND sn.name_type = 'official'
                      AND sn.is_primary = true
                `)
                : await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_street_names AS sn
                    SET
                        name = ${value.trim()},
                        language_code = 'en',
                        script_code = 'Latn'
                    FROM core.core_streets AS s
                    WHERE s.id = sn.street_id
                      AND s.public_id = CAST(${publicId} AS uuid)
                      AND sn.language_code = 'en'
                      AND upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
                      AND sn.name_type = 'official'
                      AND sn.is_primary = true
                `);

        if (updatedRows > 0) {
            return;
        }

        if (languageCode === "my") {
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO core.core_street_names (
                    street_id,
                    name,
                    language_code,
                    script_code,
                    name_type,
                    is_primary
                )
                SELECT
                    s.id,
                    ${value.trim()},
                    'my',
                    'Mymr',
                    'official',
                    true
                FROM core.core_streets AS s
                WHERE s.public_id = CAST(${publicId} AS uuid)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM core.core_street_names AS sn
                      WHERE sn.street_id = s.id
                        AND sn.language_code = 'my'
                        AND upper(trim(coalesce(sn.script_code, ''))) = 'MYMR'
                        AND sn.name_type = 'official'
                        AND sn.is_primary = true
                  )
            `);
        } else {
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO core.core_street_names (
                    street_id,
                    name,
                    language_code,
                    script_code,
                    name_type,
                    is_primary
                )
                SELECT
                    s.id,
                    ${value.trim()},
                    'en',
                    'Latn',
                    'official',
                    true
                FROM core.core_streets AS s
                WHERE s.public_id = CAST(${publicId} AS uuid)
                  AND NOT EXISTS (
                      SELECT 1
                      FROM core.core_street_names AS sn
                      WHERE sn.street_id = s.id
                        AND sn.language_code = 'en'
                        AND upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
                        AND sn.name_type = 'official'
                        AND sn.is_primary = true
                  )
            `);
        }
    }
}

async function getOfficialStreetNames(tx: Prisma.TransactionClient, publicId: string) {
    const rows = await tx.$queryRaw<{ language_code: string | null; name: string }[]>(Prisma.sql`
        SELECT sn.language_code, sn.name
        FROM core.core_street_names AS sn
        INNER JOIN core.core_streets AS s
            ON s.id = sn.street_id
        WHERE s.public_id = CAST(${publicId} AS uuid)
          AND sn.name_type = 'official'
          AND sn.is_primary = true
          AND (
              (sn.language_code = 'my' AND upper(trim(coalesce(sn.script_code, ''))) = 'MYMR')
              OR (
                  sn.language_code = 'en'
                  AND upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
              )
          )
    `);

    const myanmar = rows.find((row) => row.language_code === "my")?.name;

    return {
        myanmarName: myanmar,
        englishName: rows.find((row) => row.language_code === "en")?.name,
    };
}

export function deriveStreetCanonicalName(names: { myanmarName?: string; englishName?: string }) {
    const en = names.englishName?.trim();
    const mm = names.myanmarName?.trim();
    return (en ?? "") || (mm ?? "") || "Unnamed Street";
}

function lineStringGeoJsonFromJsonValue(value: Prisma.JsonValue): { type: "LineString"; coordinates: number[][] } {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new StreetCrudValidationError("Split produced invalid segment geometry.");
    }

    const o = value as { type?: unknown; coordinates?: unknown };
    if (o.type !== "LineString" || !Array.isArray(o.coordinates)) {
        throw new StreetCrudValidationError("Split produced invalid segment geometry.");
    }

    return { type: "LineString", coordinates: o.coordinates as number[][] };
}

function streetMyanmarNameScalarSql() {
    return Prisma.sql`(
        SELECT sn.name
        FROM core.core_street_names AS sn
        WHERE sn.street_id = s.id
          AND sn.language_code = 'my'
          AND upper(trim(coalesce(sn.script_code, ''))) = 'MYMR'
          AND sn.name_type = 'official'
          AND sn.is_primary IS TRUE
        ORDER BY sn.id
        LIMIT 1
    )`;
}

function streetEnglishNameScalarSql() {
    return Prisma.sql`(
        SELECT sn.name
        FROM core.core_street_names AS sn
        WHERE sn.street_id = s.id
          AND sn.language_code = 'en'
          AND upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
          AND sn.name_type = 'official'
          AND sn.is_primary IS TRUE
        ORDER BY sn.id
        LIMIT 1
    )`;
}

function streetOfficialNamesLateralSql() {
    return Prisma.sql`
        SELECT
            max(sn.name) FILTER (
                WHERE sn.language_code = 'my'
                  AND upper(trim(coalesce(sn.script_code, ''))) = 'MYMR'
                  AND sn.name_type = 'official'
                  AND sn.is_primary = true
            ) AS myanmar_name,
            max(sn.name) FILTER (
                WHERE sn.language_code = 'en'
                  AND upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
                  AND sn.name_type = 'official'
                  AND sn.is_primary = true
            ) AS english_name
        FROM core.core_street_names AS sn
        WHERE sn.street_id = s.id
    `;
}

function streetNamesJsonSql() {
    return Prisma.sql`
        SELECT
            json_agg(
                json_build_object(
                    'id', sn.id::text,
                    'name', sn.name,
                    'language_code', sn.language_code,
                    'script_code', sn.script_code,
                    'name_type', sn.name_type,
                    'is_primary', sn.is_primary
                )
                ORDER BY sn.is_primary DESC, sn.name ASC
            ) AS names,
            max(sn.name) FILTER (
                WHERE sn.language_code = 'my'
                  AND upper(trim(coalesce(sn.script_code, ''))) = 'MYMR'
                  AND sn.name_type = 'official'
                  AND sn.is_primary = true
            ) AS myanmar_name,
            max(sn.name) FILTER (
                WHERE sn.language_code = 'en'
                  AND upper(trim(coalesce(sn.script_code, ''))) = 'LATN'
                  AND sn.name_type = 'official'
                  AND sn.is_primary = true
            ) AS english_name
        FROM core.core_street_names AS sn
        WHERE sn.street_id = s.id
    `;
}

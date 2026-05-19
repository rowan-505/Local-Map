import { Prisma, type PrismaClient } from "@prisma/client";

import { StreetsRepository } from "../streets/streets.repo.js";
import { validateRoadGeomWithPostGIS } from "./import-review-road-overrides-validator.js";
import type {
    ImportReviewRoadRoutingValidationResult,
    ImportReviewRoadValidationIssue,
    ImportReviewRoadValidationSeverity,
} from "./import-review-road-routing-validation.types.js";
import { SERIOUS_ROUTING_WARNING_CODES } from "./import-review-road-routing-validation.types.js";

const CORE_NEARBY_BUFFER_M = 50;
const IMPORTANT_ROAD_CODES = new Set([
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
]);

const PATHISH_CLASS_CODES = new Set([
    "footway",
    "path",
    "pedestrian",
    "steps",
    "cycleway",
    "bridleway",
    "corridor",
    "service",
    "track",
]);

function issue(
    code: string,
    message: string,
    severity: ImportReviewRoadValidationSeverity
): ImportReviewRoadValidationIssue {
    return { code, message, severity };
}

function err(code: string, message: string): ImportReviewRoadValidationIssue {
    return issue(code, message, "error");
}

function warn(code: string, message: string): ImportReviewRoadValidationIssue {
    return issue(code, message, "warning");
}

function info(code: string, message: string): ImportReviewRoadValidationIssue {
    return issue(code, message, "info");
}

function asOverrideRecord(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
    }
    return {};
}

function normPick(data: unknown, key: string): unknown {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return undefined;
    }
    const o = data as Record<string, unknown>;
    if (key in o) {
        return o[key];
    }
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel in o) {
        return o[camel];
    }
    return undefined;
}

function pickString(...values: unknown[]): string | null {
    for (const v of values) {
        if (typeof v === "string" && v.trim()) {
            return v.trim();
        }
    }
    return null;
}

function pickBool(...values: unknown[]): boolean | null {
    for (const v of values) {
        if (v === true || v === false) {
            return v;
        }
        if (v === "true" || v === 1 || v === "1") {
            return true;
        }
        if (v === "false" || v === 0 || v === "0") {
            return false;
        }
    }
    return null;
}

function pickInt(...values: unknown[]): number | null {
    for (const v of values) {
        if (typeof v === "number" && Number.isFinite(v)) {
            return Math.trunc(v);
        }
        if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
            return Number.parseInt(v.trim(), 10);
        }
    }
    return null;
}

function parseOptionalBigInt(value: unknown): bigint | null {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    try {
        if (typeof value === "bigint") {
            return value;
        }
        if (typeof value === "number" && Number.isInteger(value) && value > 0) {
            return BigInt(value);
        }
        if (typeof value === "string" && /^\d+$/.test(value.trim())) {
            return BigInt(value.trim());
        }
    } catch {
        return null;
    }
    return null;
}

function roadClassCodeLower(code: string | null): string {
    return (code ?? "").trim().toLowerCase();
}

function isImportantRoad(code: string | null): boolean {
    const c = roadClassCodeLower(code);
    return c.length > 0 && IMPORTANT_ROAD_CODES.has(c);
}

function isPathish(code: string | null): boolean {
    const c = roadClassCodeLower(code);
    return c.length > 0 && PATHISH_CLASS_CODES.has(c);
}

function lineStringForStreetsRepo(geom: Record<string, unknown>): { type: "LineString"; coordinates: number[][] } | null {
    const t = geom.type;
    const coords = geom.coordinates;
    if (t === "LineString" && Array.isArray(coords) && coords.length >= 2) {
        return { type: "LineString", coordinates: coords as number[][] };
    }
    if (t === "MultiLineString" && Array.isArray(coords) && coords[0]?.length >= 2) {
        return { type: "LineString", coordinates: coords[0] as number[][] };
    }
    return null;
}

export type ImportReviewRoadRoutingValidationRow = {
    id: bigint;
    review_batch_id: bigint;
    external_id: string | null;
    canonical_name: string | null;
    road_class_id: bigint | null;
    road_class: string | null;
    class_code: string | null;
    surface: string | null;
    is_oneway: boolean | null;
    geom_geojson: unknown | null;
    review_overrides: unknown;
    normalized_data: unknown;
    matched_core_table: string | null;
    matched_core_id: bigint | null;
    review_note: string | null;
    review_status: string | null;
    review_decision: string | null;
    boundary_geom: unknown | null;
};

export function mergeEffectiveRoadState(row: ImportReviewRoadRoutingValidationRow): {
    canonical_name: string | null;
    road_class_id: bigint | null;
    road_class_code: string | null;
    surface: string | null;
    is_oneway: boolean | null;
    bridge: boolean | null;
    tunnel: boolean | null;
    layer: number | null;
    geom_geojson: Record<string, unknown> | null;
    overridesChangedOneway: boolean;
} {
    const ov = asOverrideRecord(row.review_overrides);
    const nd = row.normalized_data;
    const tags =
        normPick(nd, "tags") && typeof normPick(nd, "tags") === "object"
            ? (normPick(nd, "tags") as Record<string, unknown>)
            : {};

    const baselineOneway = row.is_oneway;
    const effectiveOneway = pickBool(ov.is_oneway, row.is_oneway, normPick(nd, "is_oneway"));

    let geom: Record<string, unknown> | null = null;
    const ovGeom = ov.geom;
    if (ovGeom && typeof ovGeom === "object" && !Array.isArray(ovGeom)) {
        geom = ovGeom as Record<string, unknown>;
    } else if (row.geom_geojson && typeof row.geom_geojson === "object" && !Array.isArray(row.geom_geojson)) {
        geom = row.geom_geojson as Record<string, unknown>;
    }

    return {
        canonical_name: pickString(ov.canonical_name, row.canonical_name, normPick(nd, "generated_label")),
        road_class_id: parseOptionalBigInt(ov.road_class_id) ?? row.road_class_id,
        road_class_code: pickString(ov.road_class_code, row.road_class, row.class_code, tags.highway),
        surface: pickString(ov.surface, row.surface, tags.surface),
        is_oneway: effectiveOneway,
        bridge: pickBool(ov.bridge, normPick(nd, "bridge"), tags.bridge),
        tunnel: pickBool(ov.tunnel, normPick(nd, "tunnel"), tags.tunnel),
        layer: pickInt(ov.layer, normPick(nd, "layer"), tags.layer),
        geom_geojson: geom,
        overridesChangedOneway:
            ov.is_oneway !== undefined &&
            baselineOneway !== null &&
            effectiveOneway !== null &&
            ov.is_oneway !== baselineOneway,
    };
}

export function issuesToStoredJson(issues: ImportReviewRoadValidationIssue[]): unknown[] {
    return issues.map((i) => ({
        code: i.code,
        message: i.message,
        severity: i.severity,
    }));
}

export function computeCanApprove(
    errors: ImportReviewRoadValidationIssue[],
    warnings: ImportReviewRoadValidationIssue[],
    confirmWarnings: boolean
): boolean {
    if (errors.length > 0) {
        return false;
    }
    const serious = warnings.filter((w) => SERIOUS_ROUTING_WARNING_CODES.has(w.code));
    if (serious.length === 0) {
        return true;
    }
    return confirmWarnings;
}

export async function runImportReviewRoadRoutingValidation(args: {
    prisma: PrismaClient;
    streetsRepo: StreetsRepository;
    row: ImportReviewRoadRoutingValidationRow;
    useReviewOverrides: boolean;
    connectivityThresholdM: number;
    duplicateThresholdM: number;
    confirmWarnings: boolean;
}): Promise<ImportReviewRoadRoutingValidationResult> {
    const errors: ImportReviewRoadValidationIssue[] = [];
    const warnings: ImportReviewRoadValidationIssue[] = [];
    const infos: ImportReviewRoadValidationIssue[] = [];

    const stats = {
        nearby_core_roads: 0,
        nearby_review_roads: 0,
        connected_endpoints: 0,
        isolated_endpoints: 0,
        possible_duplicates: 0,
        possible_unsplit_intersections: 0,
        length_m: 0,
    };

    const effective = args.useReviewOverrides
        ? mergeEffectiveRoadState(args.row)
        : mergeEffectiveRoadState({
              ...args.row,
              review_overrides: {},
          });

    const roadClassCode = effective.road_class_code;
    const excludeInternalStreetId =
        args.row.matched_core_table === "core_streets" && args.row.matched_core_id !== null
            ? args.row.matched_core_id
            : null;

    if (!effective.geom_geojson) {
        errors.push(err("GEOMETRY_MISSING", "Road geometry is missing."));
    } else {
        const gj = JSON.stringify(effective.geom_geojson);
        type GeomDiag = {
            ok: boolean;
            reason: string | null;
            length_m: number | null;
            srid: number | null;
            geom_type: string | null;
            is_empty: boolean;
            is_valid: boolean;
            coords_in_range: boolean;
            is_simple: boolean;
        };

        const diagRows = await args.prisma.$queryRaw<GeomDiag[]>`
            WITH j AS (SELECT ${gj}::json AS payload),
            g AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON((SELECT payload::text FROM j))::geometry, 4326) AS geom
            ),
            norm AS (
                SELECT
                    CASE
                        WHEN geom IS NULL THEN NULL::geometry
                        ELSE ST_Multi(ST_LineMerge(ST_CollectionExtract(ST_MakeValid(geom), 2)))
                    END AS geom_norm
                FROM g
            )
            SELECT
                geom_norm IS NOT NULL AS ok,
                CASE
                    WHEN geom_norm IS NULL THEN 'geom_null_after_parse'
                    WHEN NOT ST_IsValid(geom_norm) THEN 'geometry_not_valid'
                    WHEN ST_GeometryType(geom_norm) NOT IN ('ST_LineString', 'ST_MultiLineString') THEN 'geometry_must_be_line_or_multiline'
                    WHEN ST_SRID(geom_norm) <> 4326 THEN 'geometry_srid_must_be_4326'
                    WHEN ST_IsEmpty(geom_norm) THEN 'geometry_must_not_be_empty'
                    WHEN ST_Length(geom_norm::geography) <= 2 THEN 'geometry_length_must_exceed_2_meters'
                    ELSE NULL::text
                END AS reason,
                CASE WHEN geom_norm IS NULL THEN NULL ELSE ST_Length(geom_norm::geography) END AS length_m,
                CASE WHEN geom_norm IS NULL THEN NULL ELSE ST_SRID(geom_norm) END AS srid,
                CASE WHEN geom_norm IS NULL THEN NULL ELSE ST_GeometryType(geom_norm) END AS geom_type,
                CASE WHEN geom_norm IS NULL THEN true ELSE ST_IsEmpty(geom_norm) END AS is_empty,
                CASE WHEN geom_norm IS NULL THEN false ELSE ST_IsValid(geom_norm) END AS is_valid,
                CASE
                    WHEN geom_norm IS NULL THEN false
                    ELSE NOT (
                        ST_XMin(geom_norm) < -180 OR ST_XMax(geom_norm) > 180
                        OR ST_YMin(geom_norm) < -90 OR ST_YMax(geom_norm) > 90
                    )
                END AS coords_in_range,
                CASE WHEN geom_norm IS NULL THEN true ELSE ST_IsSimple(geom_norm) END AS is_simple
            FROM norm;
        `;

        const diag = diagRows[0];
        if (!diag || diag.ok !== true) {
            const map: Record<string, ImportReviewRoadValidationIssue> = {
                geom_null_after_parse: err("GEOMETRY_MISSING", "Geometry parse failed."),
                geometry_not_valid: err("GEOMETRY_INVALID", "Geometry is not valid (PostGIS ST_IsValid)."),
                geometry_must_be_line_or_multiline: err(
                    "INVALID_GEOMETRY_TYPE",
                    "Geometry must be LineString or MultiLineString."
                ),
                geometry_srid_must_be_4326: err("INVALID_SRID", "Geometry must use SRID 4326."),
                geometry_must_not_be_empty: err("GEOMETRY_EMPTY", "Geometry must not be empty."),
                geometry_length_must_exceed_2_meters: err(
                    "ROAD_TOO_SHORT",
                    "Road centerline must be longer than 2 meters."
                ),
            };
            const r = typeof diag?.reason === "string" ? diag.reason : "";
            errors.push(map[r] ?? err("GEOMETRY_INVALID", "Geometry rejected by PostGIS checks."));
        } else {
            stats.length_m = Number(diag.length_m ?? 0);
            if (diag.coords_in_range === false) {
                errors.push(err("INVALID_COORDINATES", "Coordinates are outside valid longitude/latitude range."));
            }
            if (diag.is_simple === false) {
                warnings.push(warn("ROAD_SELF_INTERSECTION", "Road geometry self-intersects."));
            }
        }

        const postgisCheck = await validateRoadGeomWithPostGIS(args.prisma, effective.geom_geojson);
        if (!postgisCheck.ok && errors.length === 0) {
            errors.push(err("GEOMETRY_INVALID", postgisCheck.reason ?? "Geometry validation failed."));
        }
    }

    if (effective.road_class_id !== null) {
        const ref = await args.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM ref.ref_road_classes WHERE id = ${effective.road_class_id} LIMIT 1
        `;
        if (ref.length === 0) {
            errors.push(err("INVALID_ROAD_CLASS_ID", `road_class_id ${effective.road_class_id} is not in ref.ref_road_classes.`));
        }
    }

    if (effective.road_class_code) {
        const lc = effective.road_class_code.toLowerCase();
        const refByCode = await args.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id FROM ref.ref_road_classes WHERE lower(code) = ${lc} LIMIT 2
        `;
        if (refByCode.length === 0 && effective.road_class_id === null) {
            errors.push(
                err("INVALID_ROAD_CLASS_CODE", `road_class code "${effective.road_class_code}" is not in ref.ref_road_classes.`)
            );
        }
    }

    if (!effective.road_class_id && !effective.road_class_code) {
        warnings.push(warn("ROAD_CLASS_MISSING", "Road class is missing."));
    }
    if (!effective.surface) {
        warnings.push(warn("SURFACE_MISSING", "Surface tag/field is missing."));
    }
    if (!effective.canonical_name) {
        warnings.push(warn("NAME_MISSING", "Canonical name / label is missing."));
    }

    const noteTrimmed = (args.row.review_note ?? "").trim();
    if (effective.overridesChangedOneway && noteTrimmed === "") {
        warnings.push(warn("ONEWAY_CHANGED_WITHOUT_NOTE", "One-way changed in review_overrides without review_note."));
    }

    if (effective.bridge === true && effective.tunnel === true) {
        warnings.push(warn("LAYER_BRIDGE_TUNNEL_SUSPICIOUS", "Both bridge and tunnel are true — verify layer semantics."));
    }
    if (effective.layer !== null && (effective.layer < -5 || effective.layer > 5)) {
        warnings.push(warn("LAYER_BRIDGE_TUNNEL_SUSPICIOUS", `Layer ${effective.layer} is outside the usual -5..5 range.`));
    }

    if (!isPathish(roadClassCode) && effective.geom_geojson && !effective.road_class_id && !effective.road_class_code) {
        warnings.push(warn("ROUTING_CLASS_MISSING", "Routable corridor geometry without a road class."));
    }
    if (effective.is_oneway === null) {
        warnings.push(warn("ONEWAY_UNKNOWN", "One-way status is unknown."));
    }
    if (effective.layer !== null && (effective.layer < -2 || effective.layer > 3) && effective.bridge !== true && effective.tunnel !== true) {
        warnings.push(warn("ROUTING_LAYER_SUSPICIOUS", `Layer ${effective.layer} may affect routing interpretation.`));
    }

    let validationMode: "existing_region" | "new_region" = "new_region";

    if (errors.length === 0 && effective.geom_geojson) {
        const gj = JSON.stringify(effective.geom_geojson);
        const connM = args.connectivityThresholdM;
        const dupM = args.duplicateThresholdM;
        const coreBufM = CORE_NEARBY_BUFFER_M;

        type SpatialStats = {
            nearby_core: number;
            nearby_review: number;
            length_m: number;
        };

        const spatialRows = await args.prisma.$queryRaw<SpatialStats[]>`
            WITH cand AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${gj}::json), 4326)::geometry AS geom
            )
            SELECT
                (
                    SELECT count(*)::int
                    FROM core.core_streets AS s, cand
                    WHERE s.deleted_at IS NULL
                      AND s.is_active IS TRUE
                      AND s.geom IS NOT NULL
                      AND s.geom && ST_Expand(cand.geom, ${coreBufM / 111320.0})
                      AND ST_DWithin(s.geom::geography, cand.geom::geography, ${coreBufM}::double precision)
                    LIMIT 500
                ) AS nearby_core,
                (
                    SELECT count(*)::int
                    FROM import_review.road_candidates AS r, cand
                    WHERE r.review_batch_id = ${args.row.review_batch_id}
                      AND r.entity_family = 'roads'
                      AND r.id <> ${args.row.id}
                      AND r.geom IS NOT NULL
                      AND r.geom && ST_Expand(cand.geom, ${coreBufM / 111320.0})
                      AND ST_DWithin(r.geom::geography, cand.geom::geography, ${coreBufM}::double precision)
                    LIMIT 500
                ) AS nearby_review,
                ST_Length((SELECT geom FROM cand)::geography) AS length_m
        `;

        const spatial = spatialRows[0];
        stats.nearby_core_roads = spatial?.nearby_core ?? 0;
        stats.nearby_review_roads = spatial?.nearby_review ?? 0;
        if (spatial?.length_m !== undefined && Number.isFinite(Number(spatial.length_m))) {
            stats.length_m = Number(spatial.length_m);
        }

        validationMode = stats.nearby_core_roads > 0 ? "existing_region" : "new_region";

        if (validationMode === "new_region") {
            warnings.push(
                warn(
                    "NEW_REGION_NO_CORE_ROADS",
                    "No nearby production core roads found. Validation used import_review road candidates from the same review batch."
                )
            );
        }

        type EndpointRow = { which: string; lat: number; lng: number };
        const endpoints = await args.prisma.$queryRaw<EndpointRow[]>`
            WITH cand AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${gj}::json), 4326)::geometry AS geom
            ),
            pts AS (
                SELECT
                    'start'::text AS which,
                    ST_Y(ST_StartPoint(ST_LineMerge(geom))) AS lat,
                    ST_X(ST_StartPoint(ST_LineMerge(geom))) AS lng
                FROM cand
                UNION ALL
                SELECT
                    'end'::text,
                    ST_Y(ST_EndPoint(ST_LineMerge(geom))),
                    ST_X(ST_EndPoint(ST_LineMerge(geom)))
                FROM cand
            )
            SELECT which, lat, lng FROM pts
        `;

        let connected = 0;
        let isolated = 0;

        for (const ep of endpoints) {
            const lat = Number(ep.lat);
            const lng = Number(ep.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                continue;
            }

            const coreHit = await args.streetsRepo.findNearestStreetPoint({
                lat,
                lng,
                radiusMeters: connM,
                excludeInternalStreetId: excludeInternalStreetId ?? undefined,
            });

            const reviewHitRows = await args.prisma.$queryRaw<[{ hits: bigint }]>`
                WITH pt AS (
                    SELECT ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography AS geog
                )
                SELECT count(*)::bigint AS hits
                FROM import_review.road_candidates AS r, pt
                WHERE r.review_batch_id = ${args.row.review_batch_id}
                  AND r.entity_family = 'roads'
                  AND r.id <> ${args.row.id}
                  AND r.geom IS NOT NULL
                  AND ST_DWithin(r.geom::geography, (SELECT geog FROM pt), ${connM}::double precision)
                LIMIT 1
            `;
            const reviewHit = (reviewHitRows[0]?.hits ?? 0n) > 0n;

            const connectedHere = Boolean(coreHit) || reviewHit;
            if (connectedHere) {
                connected += 1;
            } else {
                isolated += 1;
                const code =
                    ep.which === "start" ? "START_ENDPOINT_ISOLATED" : "END_ENDPOINT_ISOLATED";
                const msg = `${ep.which === "start" ? "Start" : "End"} endpoint has no connection within ${connM} m.`;
                if (isImportantRoad(roadClassCode)) {
                    warnings.push(warn(code, msg));
                    warnings.push(warn("IMPORTANT_ROAD_ISOLATED", `Important road class (${roadClassCode}): ${msg}`));
                } else {
                    warnings.push(warn(code, msg));
                }

                const unsnapRows = await args.prisma.$queryRaw<[{ d: number | null }]>`
                    WITH pt AS (
                        SELECT ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography AS geog
                    ),
                    nearest AS (
                        SELECT ST_Distance(s.geom::geography, (SELECT geog FROM pt)) AS d
                        FROM core.core_streets AS s, pt
                        WHERE s.deleted_at IS NULL AND s.is_active AND s.geom IS NOT NULL
                        ORDER BY s.geom::geography <-> (SELECT geog FROM pt)
                        LIMIT 1
                    )
                    SELECT d FROM nearest
                `;
                const d = nearestUnsnapDistance(unsnapRows[0]?.d);
                if (d !== null && d > 1 && d <= connM) {
                    warnings.push(
                        warn(
                            "POSSIBLE_UNSNAPPED_ENDPOINT",
                            `${ep.which} endpoint is ${d.toFixed(1)} m from the nearest core street but not connected.`
                        )
                    );
                }
            }
        }

        stats.connected_endpoints = connected;
        stats.isolated_endpoints = isolated;

        if (isolated === 2) {
            warnings.push(warn("ROAD_ISLAND", "Both endpoints appear disconnected from the road network."));
        }

        if (validationMode === "new_region" && stats.nearby_review_roads === 0) {
            warnings.push(warn("NO_CANDIDATE_CONNECTIONS", "No other road candidates within 50 m in this review batch."));
        }
        if (validationMode === "new_region" && isolated === 2 && stats.nearby_review_roads > 0) {
            warnings.push(
                warn("CANDIDATE_NETWORK_ISLAND", "Candidate is disconnected from other roads in the same review batch.")
            );
        }

        const dupCoreRows = await args.prisma.$queryRaw<[{ c: number }]>`
            WITH cand AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${gj}::json), 4326)::geometry AS geom
            )
            SELECT count(*)::int AS c
            FROM core.core_streets AS s, cand
            WHERE s.deleted_at IS NULL AND s.is_active AND s.geom IS NOT NULL
              AND s.geom && ST_Expand(cand.geom, ${dupM / 111320.0})
              AND (
                ST_DWithin(s.geom::geography, cand.geom::geography, ${dupM}::double precision)
                OR (
                    ST_Intersects(s.geom, cand.geom)
                    AND ST_Length(ST_Intersection(s.geom, cand.geom)::geography) >= 5
                )
              )
            LIMIT 20
        `;
        const dupReviewRows = await args.prisma.$queryRaw<[{ c: number }]>`
            WITH cand AS (
                SELECT ST_SetSRID(ST_GeomFromGeoJSON(${gj}::json), 4326)::geometry AS geom
            )
            SELECT count(*)::int AS c
            FROM import_review.road_candidates AS r, cand
            WHERE r.review_batch_id = ${args.row.review_batch_id}
              AND r.entity_family = 'roads'
              AND r.id <> ${args.row.id}
              AND r.geom IS NOT NULL
              AND r.geom && ST_Expand(cand.geom, ${dupM / 111320.0})
              AND (
                ST_DWithin(r.geom::geography, cand.geom::geography, ${dupM}::double precision)
                OR (
                    ST_Intersects(r.geom, cand.geom)
                    AND ST_Length(ST_Intersection(r.geom, cand.geom)::geography) >= 5
                )
              )
            LIMIT 20
        `;

        const dupCore = dupCoreRows[0]?.c ?? 0;
        const dupReview = dupReviewRows[0]?.c ?? 0;
        stats.possible_duplicates = dupCore + dupReview;
        if (dupCore > 0) {
            warnings.push(
                warn("POSSIBLE_DUPLICATE_CORE_ROAD", `Found ${dupCore} nearby/overlapping core street(s) within ${dupM} m.`)
            );
        }
        if (dupReview > 0) {
            warnings.push(
                warn(
                    "POSSIBLE_DUPLICATE_REVIEW_ROAD",
                    `Found ${dupReview} overlapping road candidate(s) in the same batch.`
                )
            );
        }

        if (args.row.external_id) {
            const extDup = await args.prisma.$queryRaw<[{ c: number }]>`
                SELECT count(*)::int AS c
                FROM import_review.road_candidates
                WHERE review_batch_id = ${args.row.review_batch_id}
                  AND entity_family = 'roads'
                  AND external_id = ${args.row.external_id}
                  AND id <> ${args.row.id}
            `;
            if ((extDup[0]?.c ?? 0) > 0) {
                warnings.push(
                    warn(
                        "DUPLICATE_EXTERNAL_ID_IN_REVIEW_BATCH",
                        `external_id ${args.row.external_id} appears on other candidates in this batch.`
                    )
                );
            }
        }

        const lineForStreets = lineStringForStreetsRepo(effective.geom_geojson);
        if (lineForStreets) {
            try {
                const crossings = await args.streetsRepo.listStreetGeometryCrossings({
                    geometry: lineForStreets,
                    excludeInternalId: excludeInternalStreetId,
                });
                const crossingCount = crossings.length;
                stats.possible_unsplit_intersections = crossingCount;
                if (crossingCount > 0 && effective.bridge !== true && effective.tunnel !== true) {
                    warnings.push(
                        warn(
                            "POSSIBLE_UNSPLIT_INTERSECTION",
                            `Centerline crosses ${crossingCount} core street(s) — verify endpoints are split/connected.`
                        )
                    );
                } else if (crossingCount > 0 && (effective.bridge === true || effective.tunnel === true)) {
                    infos.push(
                        info(
                            "CROSSING_ALLOWED_BY_LAYER",
                            "Crossing detected but bridge/tunnel/layer may allow grade separation."
                        )
                    );
                }
            } catch {
                warnings.push(warn("POSSIBLE_UNSPLIT_INTERSECTION", "Could not complete intersection crossing checks."));
            }
        }

        if (args.row.boundary_geom) {
            type BoundaryRow = { outside: boolean; touches: boolean };
            const bRows = await args.prisma.$queryRaw<BoundaryRow[]>`
                WITH cand AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(${gj}::json), 4326)::geometry AS geom
                ),
                bnd AS (
                    SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(args.row.boundary_geom)}::json), 4326)::geometry AS geom
                )
                SELECT
                    NOT ST_Within((SELECT geom FROM cand), (SELECT geom FROM bnd)) AS outside,
                    ST_Intersects(ST_Boundary((SELECT geom FROM bnd)), (SELECT geom FROM cand)) AS touches
            `;
            const b = bRows[0];
            if (b?.outside) {
                errors.push(err("OUTSIDE_REVIEW_BOUNDARY", "Road geometry is outside the review region boundary."));
            } else if (b?.touches) {
                warnings.push(warn("CROSSES_REVIEW_BOUNDARY", "Road touches or crosses the review boundary edge."));
            }
        } else {
            warnings.push(warn("BOUNDARY_NOT_AVAILABLE", "Review region boundary geometry is not available for this batch."));
        }
    }

    return {
        candidate_id: args.row.id.toString(),
        validation_mode: validationMode,
        can_save: errors.length === 0,
        can_approve: computeCanApprove(errors, warnings, args.confirmWarnings),
        errors,
        warnings,
        info: infos,
        stats,
    };
}

function nearestUnsnapDistance(d: number | null | undefined): number | null {
    if (d === null || d === undefined) {
        return null;
    }
    const n = Number(d);
    return Number.isFinite(n) ? n : null;
}

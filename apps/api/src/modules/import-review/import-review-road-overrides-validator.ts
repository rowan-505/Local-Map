import { Prisma, type PrismaClient } from "@prisma/client";
import { StreetsRepository } from "../streets/streets.repo.js";
import type {
    ImportReviewMergedRoadEffectiveState,
    ImportReviewRoadOverridesPatchNormalized,
    ImportReviewRoadOverrideValidationOutcome,
} from "./import-review-road-overrides.types.js";

const SURFACE_MAX = 200;

/** Rough OSM/highway equivalents that are usually excluded from motorized routing graphs. */
const PATHISH_CLASS_CODES = new Set([
    "footway",
    "path",
    "pedestrian",
    "steps",
    "cycleway",
    "bridleway",
    "corridor",
    "elevator",
    "moving_walkway",
]);

function safeTrimmedOrNull(raw: unknown): string | null {
    if (raw === null || raw === undefined) {
        return null;
    }
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed === "" ? null : trimmed;
}

function pickHighwayLike(code: string | null, normalized_data: unknown): string | null {
    const trimmed = safeTrimmedOrNull(code);
    if (trimmed) {
        return trimmed.toLowerCase();
    }
    if (!normalized_data || typeof normalized_data !== "object" || Array.isArray(normalized_data)) {
        return null;
    }
    const highway = safeTrimmedOrNull((normalized_data as Record<string, unknown>).highway);
    return highway?.toLowerCase() ?? null;
}

function pathishFromHighway(highwayLike: string | null): boolean {
    if (!highwayLike) {
        return false;
    }
    return PATHISH_CLASS_CODES.has(highwayLike);
}

/** Remove ASCII control chars; keep TAB/LF prohibited for single-line-ish fields anyway. */
function sanitizeSurfaceText(raw: string): { ok: true; value: string } | { ok: false; message: string } {
    const trimmed = raw.trim();

    let out = "";

    for (let i = 0; i < trimmed.length; i += 1) {
        const c = trimmed.charCodeAt(i);
        if (c === 9 || c === 10 || c === 13 || c === 127) {
            continue;
        }
        if ((c >= 32 && c <= 126) || c > 127) {
            out += trimmed[i];
        }
    }

    const normalized = out.trim();
    if (normalized.length === 0) {
        return { ok: false, message: "surface must contain visible printable characters." };
    }
    if (normalized.length > SURFACE_MAX) {
        return { ok: false, message: `surface exceeds ${SURFACE_MAX} characters.` };
    }
    return { ok: true, value: normalized };
}

function lineEndpoints(geom_geojson: ImportReviewMergedRoadEffectiveState["geom_geojson"]): {
    ok: boolean;
    start?: [number, number];
    end?: [number, number];
    error?: string;
} {
    if (!geom_geojson || typeof geom_geojson !== "object" || Array.isArray(geom_geojson)) {
        return { ok: false, error: "Geometry is invalid for routing checks." };
    }
    const t = (geom_geojson as { type?: unknown }).type;
    const coords = (geom_geojson as { coordinates?: unknown }).coordinates;
    if (t === "LineString") {
        if (!Array.isArray(coords) || coords.length < 2) {
            return { ok: false, error: "LineString endpoints could not be read." };
        }
        const a = coords[0];
        const b = coords[coords.length - 1];
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) {
            return { ok: false, error: "LineString coordinates are malformed." };
        }
        const s0 = Number(a[0]);
        const s1 = Number(a[1]);
        const e0 = Number(b[0]);
        const e1 = Number(b[1]);
        if (![s0, s1, e0, e1].every((n) => Number.isFinite(n))) {
            return { ok: false, error: "LineString coordinates contain non-numbers." };
        }
        return { ok: true, start: [s0, s1], end: [e0, e1] };
    }
    if (t === "MultiLineString") {
        if (!Array.isArray(coords) || coords.length === 0) {
            return { ok: false, error: "MultiLineString endpoints could not be read." };
        }
        const firstLine = coords[0];
        const lastLine = coords[coords.length - 1];
        if (!Array.isArray(firstLine) || !Array.isArray(lastLine) || firstLine.length < 2 || lastLine.length < 2) {
            return { ok: false, error: "MultiLineString parts are malformed." };
        }
        const sf = firstLine[0];
        const el = lastLine[lastLine.length - 1];
        if (!Array.isArray(sf) || !Array.isArray(el)) {
            return { ok: false, error: "MultiLineString vertex shape is malformed." };
        }
        const s0 = Number(sf[0]);
        const s1 = Number(sf[1]);
        const e0 = Number(el[0]);
        const e1 = Number(el[1]);
        if (![s0, s1, e0, e1].every((n) => Number.isFinite(n))) {
            return { ok: false, error: "MultiLineString coordinates contain non-numbers." };
        }
        return { ok: true, start: [s0, s1], end: [e0, e1] };
    }
    return { ok: false, error: "Unsupported geometry type for endpoint routing validation." };
}

export async function validateRoadGeomWithPostGIS(
    prisma: PrismaClient,
    geojsonValue: Record<string, unknown>
): Promise<{ ok: boolean; reason?: string; normalized_geojson_string?: string }> {
    const gj = JSON.stringify(geojsonValue);
    type Row = {
        ok: boolean;
        reason: string | null;
        gj_out: Record<string, unknown> | string | number | boolean | null;
    };

    const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
        WITH j AS (
            SELECT ${gj}::json AS payload
        ),
        g AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON((SELECT payload::text FROM j))::geometry, 4326) AS geom
        ),
        norm AS (
            SELECT
                CASE
                    WHEN g.geom IS NULL THEN NULL::geometry
                    ELSE ST_Multi(ST_LineMerge(ST_CollectionExtract(ST_MakeValid(g.geom), 2)))
                END AS geom_norm
            FROM g
        )
        SELECT
            CASE
                WHEN geom_norm IS NULL THEN false
                WHEN NOT ST_IsValid(geom_norm) THEN false
                WHEN ST_GeometryType(geom_norm) NOT IN ('ST_LineString', 'ST_MultiLineString') THEN false
                WHEN ST_SRID(geom_norm) <> 4326 THEN false
                WHEN ST_IsEmpty(geom_norm) THEN false
                WHEN ST_Length(geom_norm::geography) <= 2 THEN false
                ELSE true
            END AS ok,
            CASE
                WHEN geom_norm IS NULL THEN 'geom_null_after_parse'
                WHEN NOT ST_IsValid(geom_norm) THEN 'geometry_not_valid'
                WHEN ST_GeometryType(geom_norm) NOT IN ('ST_LineString', 'ST_MultiLineString') THEN 'geometry_must_be_line_or_multiline'
                WHEN ST_SRID(geom_norm) <> 4326 THEN 'geometry_srid_must_be_4326'
                WHEN ST_IsEmpty(geom_norm) THEN 'geometry_must_not_be_empty'
                WHEN ST_Length(geom_norm::geography) <= 2 THEN 'geometry_length_must_exceed_2_meters'
                ELSE NULL::text
            END AS reason,
            ST_AsGeoJSON(geom_norm)::json AS gj_out
        FROM norm;
    `);
    const row = rows[0];
    if (row === undefined) {
        return { ok: false, reason: "geometry_validation_failed_unknown" };
    }
    const normalized =
        row.gj_out && typeof row.gj_out === "object" && row.gj_out !== null
            ? JSON.stringify(row.gj_out)
            : row.ok
              ? gj
              : undefined;
    if (!row.ok) {
        const map: Record<string, string> = {
            geom_null_after_parse: "Geometry parse failed.",
            geometry_not_valid: "Geometry is not valid (PostGIS ST_IsValid).",
            geometry_must_be_line_or_multiline: "Geometry must be LineString or MultiLineString.",
            geometry_srid_must_be_4326: "Geometry must use SRID 4326.",
            geometry_must_not_be_empty: "Geometry must not be empty.",
            geometry_length_must_exceed_2_meters: "Road centerline must be longer than 2 meters.",
        };
        const r = typeof row.reason === "string" && row.reason.trim() ? row.reason.trim() : "";
        return { ok: false, reason: map[r] ?? "Geometry rejected by PostGIS checks." };
    }
    return { ok: true, normalized_geojson_string: normalized };
}

async function nearestCoreStreetWithin(
    streetsRepo: StreetsRepository,
    lat: number,
    lng: number,
    radiusMeters: number,
    excludeInternalStreetId: bigint | null
): Promise<boolean> {
    const hit = await streetsRepo.findNearestStreetPoint({
        lat,
        lng,
        radiusMeters,
        excludeInternalStreetId: excludeInternalStreetId ?? undefined,
    });
    return hit !== null;
}

async function nearestOtherReviewRoadWithinBatch(
    prisma: PrismaClient,
    batchId: bigint,
    excludeId: bigint,
    lat: number,
    lng: number,
    radiusMeters: number
): Promise<boolean> {
    const rows = await prisma.$queryRaw<[{ hits: bigint }]>`
        WITH pt AS (
            SELECT ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography AS geog
        )
        SELECT count(*)::bigint AS hits
        FROM import_review.road_candidates AS r
        CROSS JOIN pt
        WHERE r.review_batch_id = ${batchId}
          AND r.entity_family = 'roads'
          AND r.id <> ${excludeId}
          AND r.geom IS NOT NULL
          AND ST_DWithin(r.geom::geography, (SELECT geog FROM pt), ${radiusMeters}::double precision)
        LIMIT 1;
    `;
    const n = rows[0]?.hits ?? 0n;
    return n > 0n;
}

function jsonObjectFromMerged(
    baseline: Record<string, unknown>,
    patch: Record<string, unknown>
): Record<string, unknown> {
    return { ...baseline, ...patch };
}

export async function buildImportReviewRoadOverrideOutcome(args: {
    prisma: PrismaClient;
    streetsRepo: StreetsRepository;
    reviewBatchId: bigint;
    roadId: bigint;
    baseline_review_overrides: unknown;
    baseline_canonical_name: string | null;
    baseline_road_class_id: bigint | null;
    baseline_is_oneway: boolean | null;
    baseline_surface: string | null;
    /** GeoJSON-ish from ST_AsGeoJSON when present — may be stale until geom column updates. */
    baseline_geom_geojson: ImportReviewMergedRoadEffectiveState["geom_geojson"];
    normalized_data: unknown;
    class_code: string | null;
    matched_core_table: string | null;
    matched_core_id: bigint | null;
    patch: ImportReviewRoadOverridesPatchNormalized;
    routingToleranceMeters: number;
    /** FK + patch merge result (caller resolves ref + codes). */
    effective_road_class_id: bigint | null;
    effective_road_class_label: string | null;
    baselineNoteProvided: boolean;
    patchProvidedKeys: ReadonlySet<string>;
    /** Explicit review_note on PATCH body (routing one-way rationale). */
    patchReviewNote: string | null | undefined;
}): Promise<ImportReviewRoadOverrideValidationOutcome> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const existingOverridesRaw =
        args.baseline_review_overrides && typeof args.baseline_review_overrides === "object"
            ? (args.baseline_review_overrides as Record<string, unknown>)
            : {};

    const normalizedPatchForJson: Record<string, unknown> = {};

    if (args.patch.canonical_name !== undefined) {
        if (args.patch.canonical_name === null) {
            normalizedPatchForJson.canonical_name = null;
        } else if (typeof args.patch.canonical_name === "string") {
            const t = args.patch.canonical_name.trim();
            normalizedPatchForJson.canonical_name = t === "" ? null : t;
        }
    }

    if (args.patch.road_class_id !== undefined) {
        if (args.patch.road_class_id === null) {
            normalizedPatchForJson.road_class_id = null;
        } else {
            normalizedPatchForJson.road_class_id = args.patch.road_class_id.toString();
        }
    }

    if (args.patch.is_oneway !== undefined) {
        normalizedPatchForJson.is_oneway = args.patch.is_oneway;
    }

    if (args.patch.surface !== undefined) {
        if (args.patch.surface === null) {
            normalizedPatchForJson.surface = null;
        } else if (typeof args.patch.surface === "string") {
            const surfOk = sanitizeSurfaceText(args.patch.surface);
            if (!surfOk.ok) {
                errors.push(surfOk.message);
            } else {
                normalizedPatchForJson.surface = surfOk.value;
            }
        }
    }

    let normalizedGeomCandidate: Record<string, unknown> | null = null;
    let geomProvided = args.patchProvidedKeys.has("geom");
    let geomUnset = geomProvided && args.patch.geom === null;

    if (geomProvided && !geomUnset) {
        if (!args.patch.geom || typeof args.patch.geom !== "object") {
            errors.push("geom must be GeoJSON LineString or MultiLineString when provided.");
        } else {
            const check = await validateRoadGeomWithPostGIS(args.prisma, args.patch.geom as Record<string, unknown>);
            if (!check.ok) {
                errors.push(check.reason ?? "Road geometry rejected.");
            } else if (check.normalized_geojson_string) {
                try {
                    normalizedGeomCandidate = JSON.parse(check.normalized_geojson_string) as Record<string, unknown>;
                    normalizedPatchForJson.geom = normalizedGeomCandidate;
                } catch {
                    errors.push("Could not serialize normalized geometry JSON.");
                }
            }
        }
    }

    if (geomUnset && Object.prototype.hasOwnProperty.call(normalizedPatchForJson, "geom")) {
        delete normalizedPatchForJson.geom;
    }

    if (geomUnset) {
        errors.push(
            "Clearing geometry via null geom is unsafe for routing previews; leave geom unchanged or submit a replacement LineString."
        );
    }

    const mergedOverridesJson = jsonObjectFromMerged(existingOverridesRaw, normalizedPatchForJson);

    let effectiveCanon: string | null =
        normalizedPatchForJson.canonical_name === undefined
            ? args.baseline_canonical_name
            : (normalizedPatchForJson.canonical_name as string | null);
    if (typeof effectiveCanon !== "string" && effectiveCanon !== null) {
        effectiveCanon = args.baseline_canonical_name;
    }

    let effectiveSurface: string | null = args.baseline_surface;
    if (normalizedPatchForJson.surface !== undefined) {
        effectiveSurface =
            normalizedPatchForJson.surface === null
                ? null
                : typeof normalizedPatchForJson.surface === "string"
                  ? normalizedPatchForJson.surface
                  : args.baseline_surface;
    }

    let effectiveIsOneway: boolean | null = args.baseline_is_oneway;
    if (normalizedPatchForJson.is_oneway !== undefined) {
        if (normalizedPatchForJson.is_oneway === null) {
            effectiveIsOneway = null;
        } else {
            effectiveIsOneway = Boolean(normalizedPatchForJson.is_oneway);
        }
    }

    let effectiveGeomGeo: ImportReviewMergedRoadEffectiveState["geom_geojson"] = args.baseline_geom_geojson;
    if (normalizedGeomCandidate) {
        effectiveGeomGeo = normalizedGeomCandidate;
    }

    const effectiveState: ImportReviewMergedRoadEffectiveState = {
        canonical_name: effectiveCanon,
        road_class_id: args.effective_road_class_id,
        road_class_label: args.effective_road_class_label,
        is_oneway: effectiveIsOneway,
        surface: effectiveSurface,
        geom_geojson: effectiveGeomGeo,
    };

    const highwayLikeForPathGuess = pickHighwayLike(args.class_code, args.normalized_data);

    /** Missing class warning for presumed routable corridors */
    if (
        effectiveState.geom_geojson !== null &&
        effectiveState.road_class_id === null &&
        !pathishFromHighway(highwayLikeForPathGuess)
    ) {
        warnings.push(
            "Road class_id is unset while geometry exists — motorized routing graphs usually require ref.ref_road_classes."
        );
    }

    /** One-way change rationale */
    if (args.patchProvidedKeys.has("is_oneway")) {
        const prior = args.baseline_is_oneway;
        const note = typeof args.patchReviewNote === "string" ? args.patchReviewNote.trim() : "";
        if (prior !== effectiveState.is_oneway && note === "" && !args.baselineNoteProvided) {
            warnings.push("One-way setting changed — add review_note documenting why routing direction differs.");
        }
    }

    if (effectiveState.geom_geojson !== null && errors.length === 0) {
        const excludeInternalStreetId =
            args.matched_core_table === "core_streets" && args.matched_core_id !== null ? args.matched_core_id : null;

        const ep = lineEndpoints(effectiveState.geom_geojson);
        if (ep.ok === true && ep.start && ep.end) {
            const r = Math.max(args.routingToleranceMeters, 5);
            let startOkCore = await nearestCoreStreetWithin(
                args.streetsRepo,
                ep.start[1],
                ep.start[0],
                r,
                excludeInternalStreetId
            );
            let endOkCore = await nearestCoreStreetWithin(
                args.streetsRepo,
                ep.end[1],
                ep.end[0],
                r,
                excludeInternalStreetId
            );

            let startOkReview = await nearestOtherReviewRoadWithinBatch(
                args.prisma,
                args.reviewBatchId,
                args.roadId,
                ep.start[1],
                ep.start[0],
                r
            );
            let endOkReview = await nearestOtherReviewRoadWithinBatch(
                args.prisma,
                args.reviewBatchId,
                args.roadId,
                ep.end[1],
                ep.end[0],
                r
            );

            /** When geometry untouched, widen search slightly once to soften strict endpoint placement */
            if (!args.patchProvidedKeys.has("geom")) {
                startOkReview =
                    startOkReview ||
                    (await nearestOtherReviewRoadWithinBatch(args.prisma, args.reviewBatchId, args.roadId,
                        ep.start[1],
                        ep.start[0],
                        Math.min(r + 60, 300)
                    ));
                startOkCore =
                    startOkCore ||
                    (await nearestCoreStreetWithin(args.streetsRepo, ep.start[1], ep.start[0], Math.min(r + 60, 300), excludeInternalStreetId));

                endOkReview =
                    endOkReview ||
                    (await nearestOtherReviewRoadWithinBatch(args.prisma, args.reviewBatchId, args.roadId,
                        ep.end[1],
                        ep.end[0],
                        Math.min(r + 60, 300)
                    ));
                endOkCore =
                    endOkCore ||
                    (await nearestCoreStreetWithin(args.streetsRepo, ep.end[1], ep.end[0], Math.min(r + 60, 300), excludeInternalStreetId));
            }

            const startOkJoined = startOkCore || startOkReview;
            const endOkJoined = endOkCore || endOkReview;

            if (!startOkJoined) {
                warnings.push(
                    `Start vertex is not within ~${Math.round(args.routingToleranceMeters)} m of nearby core streets or other road candidates.`
                );
            }
            if (!endOkJoined) {
                warnings.push(
                    `End vertex is not within ~${Math.round(args.routingToleranceMeters)} m of nearby core streets or other road candidates.`
                );
            }
            if (!startOkJoined && !endOkJoined) {
                warnings.push(
                    "This edit risks an isolated road segment (routing graph continuity warning): both endpoints look disconnected."
                );
            }
        } else if (ep.error) {
            warnings.push(ep.error);
        }
    }

    /** Enforce deterministic ordering */
    warnings.sort();

    return {
        errors,
        warnings,
        normalizedPatchForJson,
        mergedOverridesJson,
        effectiveState,
    };
}

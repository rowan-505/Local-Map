import { Prisma, type PrismaClient } from "@prisma/client";

import {
    ROUTING_GRAPH_FALLBACK_SPEEDS_KPH,
    ROUTING_GRAPH_NON_ROUTABLE_CLASS_CODES,
    type RoutingGraphProfileCode,
} from "./routing.config.js";
import type { RoutingGraphBuildInput } from "./routing.types.js";

const SNAP_GRID = 1e-7;

const NON_ROUTABLE_LIST = [...ROUTING_GRAPH_NON_ROUTABLE_CLASS_CODES];

export type RoutingGraphBuildCounts = {
    selectedCoreRoadCount: number;
    generatedNodeCount: number;
    generatedEdgeCount: number;
    generatedEdgeNameCount: number;
    warningCount: number;
    errorCount: number;
    validationCodes: string[];
};

export type RoutingGraphBuildJobRow = {
    id: bigint;
    publicId: string;
};

function bboxEnvelopeSql(bbox: RoutingGraphBuildInput["bbox"]): Prisma.Sql {
    if (!bbox) {
        return Prisma.sql`NULL::geometry`;
    }
    return Prisma.sql`ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}, 4326)`;
}

function sourceDescription(input: RoutingGraphBuildInput): string {
    const parts = [`profile=${input.profileCode}`, `max_roads=${input.maxRoads}`];
    if (input.sourcePublishBatchId) {
        parts.push(`publish_batch_id=${input.sourcePublishBatchId.toString()}`);
    }
    if (input.sourceReviewBatchId) {
        parts.push(`review_batch_id=${input.sourceReviewBatchId.toString()}`);
    }
    if (input.bbox) {
        parts.push(
            `bbox=${input.bbox.minLon},${input.bbox.minLat},${input.bbox.maxLon},${input.bbox.maxLat}`
        );
    }
    if (input.regionCode) {
        parts.push(`region=${input.regionCode}`);
    }
    if (input.dryRun) {
        parts.push("dry_run=true");
    }
    return parts.join("; ");
}

function buildMetadataSummary(
    input: RoutingGraphBuildInput,
    buildJobId: bigint,
    counts: RoutingGraphBuildCounts
): Record<string, unknown> {
    return {
        build_job_id: buildJobId.toString(),
        profile_code: input.profileCode,
        source_publish_batch_id: input.sourcePublishBatchId?.toString() ?? null,
        source_review_batch_id: input.sourceReviewBatchId?.toString() ?? null,
        bbox: input.bbox,
        region_code: input.regionCode,
        max_roads: input.maxRoads,
        dry_run: input.dryRun,
        selected_core_road_count: counts.selectedCoreRoadCount,
        generated_node_count: counts.generatedNodeCount,
        generated_edge_count: counts.generatedEdgeCount,
        generated_edge_name_count: counts.generatedEdgeNameCount,
        warning_count: counts.warningCount,
        error_count: counts.errorCount,
        validation_codes: counts.validationCodes,
        fallback_speeds_kph: ROUTING_GRAPH_FALLBACK_SPEEDS_KPH,
        endpoint_only: true,
        intersection_splitting: false,
        turn_restrictions_applied: false,
    };
}

export class RoutingGraphBuildRepository {
    constructor(private readonly prisma: Prisma.TransactionClient | PrismaClient) {}

    async resolveProfileSpeeds(profileCode: RoutingGraphProfileCode): Promise<{
        walkKph: number;
        driveKph: number;
        busKph: number;
    }> {
        const rows = await this.prisma.$queryRaw<
            { code: string; default_speed_kph: Prisma.Decimal | null }[]
        >`
            SELECT code, default_speed_kph
            FROM routing.routing_profiles
            WHERE code IN ('walk', 'drive', 'bus')
              AND is_active = true
        `;
        const byCode = new Map(rows.map((r) => [r.code, Number(r.default_speed_kph ?? 0)]));
        return {
            walkKph: byCode.get("walk") || ROUTING_GRAPH_FALLBACK_SPEEDS_KPH.walk,
            driveKph: byCode.get("drive") || ROUTING_GRAPH_FALLBACK_SPEEDS_KPH.drive,
            busKph: byCode.get("bus") || ROUTING_GRAPH_FALLBACK_SPEEDS_KPH.bus,
        };
    }

    async createBuildJob(input: RoutingGraphBuildInput): Promise<RoutingGraphBuildJobRow> {
        const summary = {
            input: {
                profile_code: input.profileCode,
                source_publish_batch_id: input.sourcePublishBatchId?.toString() ?? null,
                source_review_batch_id: input.sourceReviewBatchId?.toString() ?? null,
                bbox: input.bbox,
                region_code: input.regionCode,
                max_roads: input.maxRoads,
                dry_run: input.dryRun,
            },
        };
        const rows = await this.prisma.$queryRaw<{ id: bigint; public_id: string }[]>`
            INSERT INTO routing.routing_build_jobs (
                status,
                profile_code,
                region_code,
                source_description,
                source_review_batch_id,
                source_publish_batch_id,
                started_at,
                summary,
                created_by
            )
            VALUES (
                'running',
                ${input.profileCode},
                ${input.regionCode},
                ${sourceDescription(input)},
                ${input.sourceReviewBatchId},
                ${input.sourcePublishBatchId},
                now(),
                ${JSON.stringify(summary)}::jsonb,
                ${input.createdBy}
            )
            RETURNING id, public_id
        `;
        const row = rows[0];
        if (!row) {
            throw new Error("Failed to create routing build job.");
        }
        return { id: row.id, publicId: row.public_id };
    }

    async createBuildMetadata(
        buildJobId: bigint,
        input: RoutingGraphBuildInput,
        counts: RoutingGraphBuildCounts
    ): Promise<bigint> {
        const summary = buildMetadataSummary(input, buildJobId, counts);
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            INSERT INTO routing.routing_build_metadata (
                build_name,
                status,
                summary,
                started_at
            )
            VALUES (
                ${`routing-build-job-${buildJobId.toString()}`},
                'running',
                ${JSON.stringify(summary)}::jsonb,
                now()
            )
            RETURNING id
        `;
        const row = rows[0];
        if (!row) {
            throw new Error("Failed to create routing build metadata row.");
        }
        return row.id;
    }

    async finalizeBuildMetadata(
        metadataId: bigint,
        status: "completed" | "failed",
        counts: RoutingGraphBuildCounts,
        input: RoutingGraphBuildInput,
        buildJobId: bigint
    ): Promise<void> {
        const summary = buildMetadataSummary(input, buildJobId, counts);
        await this.prisma.$executeRaw`
            UPDATE routing.routing_build_metadata
            SET
                status = ${status},
                summary = ${JSON.stringify(summary)}::jsonb,
                finished_at = now()
            WHERE id = ${metadataId}
        `;
    }

    async finalizeBuildJob(
        buildJobId: bigint,
        status: "completed" | "failed",
        counts: RoutingGraphBuildCounts,
        input: RoutingGraphBuildInput
    ): Promise<void> {
        const summary = buildMetadataSummary(input, buildJobId, counts);
        await this.prisma.$executeRaw`
            UPDATE routing.routing_build_jobs
            SET
                status = ${status},
                total_core_roads = ${counts.selectedCoreRoadCount},
                total_nodes = ${counts.generatedNodeCount},
                total_edges = ${counts.generatedEdgeCount},
                warning_count = ${counts.warningCount},
                error_count = ${counts.errorCount},
                finished_at = now(),
                summary = coalesce(summary, '{}'::jsonb) || ${JSON.stringify({ result: summary })}::jsonb,
                updated_at = now()
            WHERE id = ${buildJobId}
        `;
    }

    async markBuildJobFailed(buildJobId: bigint, message: string): Promise<void> {
        await this.prisma.$executeRaw`
            UPDATE routing.routing_build_jobs
            SET
                status = 'failed',
                error_count = greatest(error_count, 1),
                finished_at = now(),
                summary = coalesce(summary, '{}'::jsonb) || ${JSON.stringify({ fatal_error: message })}::jsonb,
                updated_at = now()
            WHERE id = ${buildJobId}
        `;
    }

    async runGraphBuild(
        buildJobId: bigint,
        input: RoutingGraphBuildInput,
        speeds: { walkKph: number; driveKph: number; busKph: number }
    ): Promise<RoutingGraphBuildCounts> {
        const bboxGeom = bboxEnvelopeSql(input.bbox);
        const publishBatchText = input.sourcePublishBatchId?.toString() ?? null;
        const reviewBatchText = input.sourceReviewBatchId?.toString() ?? null;

        await this.prisma.$executeRaw`DROP TABLE IF EXISTS _rg_selected_roads`;
        await this.prisma.$executeRaw`
            CREATE TEMP TABLE _rg_selected_roads ON COMMIT DROP AS
            SELECT
                s.id AS core_street_id,
                s.geom AS raw_geom,
                s.road_class_id,
                coalesce(rc.code, 'unknown') AS road_class_code,
                s.is_oneway,
                s.source_refs,
                s.canonical_name,
                s.normalized_data,
                rc.is_public AS road_class_is_public
            FROM core.core_streets AS s
            LEFT JOIN ref.ref_road_classes AS rc ON rc.id = s.road_class_id
            WHERE s.deleted_at IS NULL
              AND coalesce(s.is_active, true) = true
              AND s.geom IS NOT NULL
              AND ST_IsValid(s.geom)
              AND NOT ST_IsEmpty(s.geom)
              AND coalesce(rc.is_public, true) = true
              AND coalesce(rc.code, 'unknown') NOT IN (${Prisma.join(
                  NON_ROUTABLE_LIST.map((c) => Prisma.sql`${c}`)
              )})
              AND (${publishBatchText}::text IS NULL OR s.source_refs->>'publish_batch_id' = ${publishBatchText})
              AND (${reviewBatchText}::text IS NULL OR s.source_refs->>'review_batch_id' = ${reviewBatchText})
              AND (${bboxGeom} IS NULL OR ST_Intersects(s.geom, ${bboxGeom}))
            ORDER BY s.id
            LIMIT ${input.maxRoads}
        `;

        const selectedRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count FROM _rg_selected_roads
        `;
        const selectedCoreRoadCount = Number(selectedRows[0]?.count ?? 0);

        if (input.dryRun) {
            return this.dryRunCounts(selectedCoreRoadCount);
        }

        await this.prisma.$executeRaw`DROP TABLE IF EXISTS _rg_parts`;
        await this.prisma.$executeRaw`
            CREATE TEMP TABLE _rg_parts ON COMMIT DROP AS
            WITH dumped AS (
                SELECT
                    sr.core_street_id,
                    sr.road_class_id,
                    sr.road_class_code,
                    sr.is_oneway,
                    sr.source_refs,
                    sr.canonical_name,
                    sr.normalized_data,
                    CASE
                        WHEN ST_GeometryType(sr.raw_geom) = 'ST_LineString'
                            THEN sr.raw_geom::geometry(LineString, 4326)
                        WHEN ST_GeometryType(sr.raw_geom) = 'ST_MultiLineString' THEN (
                            SELECT (ST_Dump(sr.raw_geom)).geom::geometry(LineString, 4326)
                            ORDER BY ST_Length(((ST_Dump(sr.raw_geom)).geom)::geography) DESC
                            LIMIT 1
                        )
                        ELSE NULL::geometry(LineString, 4326)
                    END AS line_geom
                FROM _rg_selected_roads AS sr
            )
            SELECT
                d.*,
                CASE
                    WHEN d.line_geom IS NULL OR NOT ST_IsValid(d.line_geom) OR ST_IsEmpty(d.line_geom)
                        THEN NULL::numeric
                    ELSE ST_Length(d.line_geom::geography)
                END AS length_m,
                coalesce(
                    nullif(trim(d.normalized_data->>'speed_kph'), '')::numeric,
                    nullif(trim(d.normalized_data->>'maxspeed'), '')::numeric,
                    nullif(trim(d.normalized_data->>'speed'), '')::numeric
                ) AS speed_kph_hint
            FROM dumped AS d
        `;

        const validationCodes: string[] = [];

        await this.insertPreBuildValidationReports(buildJobId, validationCodes);

        if (selectedCoreRoadCount === 0) {
            return {
                selectedCoreRoadCount: 0,
                generatedNodeCount: 0,
                generatedEdgeCount: 0,
                generatedEdgeNameCount: 0,
                warningCount: validationCodes.length,
                errorCount: 1,
                validationCodes,
            };
        }

        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_nodes (build_job_id, node_type, geom, core_street_id, source_refs)
            WITH endpoints AS (
                SELECT p.core_street_id, ST_StartPoint(p.line_geom) AS pt, p.source_refs
                FROM _rg_parts AS p
                WHERE p.line_geom IS NOT NULL
                  AND ST_IsValid(p.line_geom)
                  AND NOT ST_IsEmpty(p.line_geom)
                  AND p.length_m > 0
                UNION ALL
                SELECT p.core_street_id, ST_EndPoint(p.line_geom), p.source_refs
                FROM _rg_parts AS p
                WHERE p.line_geom IS NOT NULL
                  AND ST_IsValid(p.line_geom)
                  AND NOT ST_IsEmpty(p.line_geom)
                  AND p.length_m > 0
            ),
            grouped AS (
                SELECT
                    ST_Centroid(ST_Collect(pt))::geometry(Point, 4326) AS geom,
                    min(core_street_id) AS core_street_id,
                    jsonb_build_object('endpoint', true) AS source_refs
                FROM endpoints
                GROUP BY ST_AsBinary(ST_SnapToGrid(pt, ${SNAP_GRID}))
            )
            SELECT ${buildJobId}, 'endpoint', g.geom, g.core_street_id, g.source_refs
            FROM grouped AS g
        `;

        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_edges (
                build_job_id,
                from_node_id,
                to_node_id,
                core_street_id,
                geom,
                length_m,
                road_class_id,
                is_oneway,
                forward_allowed,
                backward_allowed,
                walk_allowed,
                drive_allowed,
                bus_allowed,
                speed_kph,
                cost_walk,
                cost_drive,
                cost_bus,
                source_refs
            )
            WITH valid_parts AS (
                SELECT
                    p.core_street_id,
                    p.line_geom,
                    p.length_m,
                    p.road_class_id,
                    p.road_class_code,
                    p.is_oneway,
                    p.source_refs,
                    p.speed_kph_hint,
                    ST_StartPoint(p.line_geom) AS start_pt,
                    ST_EndPoint(p.line_geom) AS end_pt
                FROM _rg_parts AS p
                WHERE p.line_geom IS NOT NULL
                  AND ST_IsValid(p.line_geom)
                  AND NOT ST_IsEmpty(p.line_geom)
                  AND p.length_m > 0
            ),
            resolved AS (
                SELECT
                    vp.*,
                    fn.id AS from_node_id,
                    tn.id AS to_node_id,
                    CASE
                        WHEN vp.road_class_code IN ('path', 'footway', 'pedestrian', 'steps', 'cycleway', 'bridleway')
                            THEN true
                        WHEN vp.road_class_code IN ('motorway', 'trunk', 'motorway_link', 'trunk_link')
                            THEN false
                        ELSE true
                    END AS walk_allowed,
                    CASE
                        WHEN vp.road_class_code IN ('path', 'footway', 'pedestrian', 'steps', 'cycleway', 'bridleway')
                            THEN false
                        ELSE true
                    END AS drive_allowed,
                    CASE
                        WHEN vp.road_class_code IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'busway')
                            THEN true
                        ELSE false
                    END AS bus_allowed,
                    coalesce(vp.speed_kph_hint, ${speeds.driveKph}::numeric) AS speed_kph
                FROM valid_parts AS vp
                INNER JOIN routing.routing_nodes AS fn
                    ON fn.build_job_id = ${buildJobId}
                   AND ST_AsBinary(ST_SnapToGrid(fn.geom, ${SNAP_GRID}))
                       = ST_AsBinary(ST_SnapToGrid(vp.start_pt, ${SNAP_GRID}))
                INNER JOIN routing.routing_nodes AS tn
                    ON tn.build_job_id = ${buildJobId}
                   AND ST_AsBinary(ST_SnapToGrid(tn.geom, ${SNAP_GRID}))
                       = ST_AsBinary(ST_SnapToGrid(vp.end_pt, ${SNAP_GRID}))
            )
            SELECT
                ${buildJobId},
                r.from_node_id,
                r.to_node_id,
                r.core_street_id,
                r.line_geom,
                r.length_m,
                r.road_class_id,
                r.is_oneway,
                true AS forward_allowed,
                CASE WHEN coalesce(r.is_oneway, false) THEN false ELSE true END AS backward_allowed,
                r.walk_allowed,
                r.drive_allowed,
                r.bus_allowed,
                r.speed_kph,
                r.length_m / (${speeds.walkKph} * 1000.0 / 3600.0),
                r.length_m / (greatest(r.speed_kph, 1) * 1000.0 / 3600.0),
                CASE
                    WHEN r.bus_allowed THEN r.length_m / (${speeds.busKph} * 1000.0 / 3600.0)
                    ELSE NULL::numeric
                END,
                coalesce(r.source_refs, '{}'::jsonb)
                    || jsonb_build_object('road_class_code', r.road_class_code, 'build_job_id', ${buildJobId}::text)
            FROM resolved AS r
        `;

        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_edge_names (routing_edge_id, name, language_code, script_code, name_type, is_primary)
            WITH edge_rows AS (
                SELECT e.id AS routing_edge_id, e.core_street_id
                FROM routing.routing_edges AS e
                WHERE e.build_job_id = ${buildJobId}
            ),
            street_names AS (
                SELECT
                    er.routing_edge_id,
                    trim(n.name) AS name,
                    coalesce(nullif(trim(n.language_code), ''), 'und') AS language_code,
                    n.script_code,
                    CASE
                        WHEN n.name_type IN ('primary', 'official', 'display', 'source')
                            THEN n.name_type
                        ELSE 'official'
                    END AS name_type,
                    n.is_primary,
                    1 AS priority
                FROM edge_rows AS er
                INNER JOIN core.core_street_names AS n ON n.street_id = er.core_street_id
                WHERE trim(n.name) <> ''
                  AND n.name_type <> 'generated'
                  AND trim(n.name) !~* '^(way|node|relation)/[0-9]+$'
            ),
            canonical_names AS (
                SELECT
                    er.routing_edge_id,
                    trim(s.canonical_name) AS name,
                    'und'::text AS language_code,
                    NULL::text AS script_code,
                    'official'::text AS name_type,
                    true AS is_primary,
                    2 AS priority
                FROM edge_rows AS er
                INNER JOIN core.core_streets AS s ON s.id = er.core_street_id
                WHERE trim(s.canonical_name) <> ''
                  AND lower(trim(s.canonical_name)) <> 'unnamed street'
                  AND trim(s.canonical_name) !~* '^(way|node|relation)/[0-9]+$'
                  AND NOT EXISTS (SELECT 1 FROM street_names AS sn WHERE sn.routing_edge_id = er.routing_edge_id)
            ),
            combined AS (
                SELECT * FROM street_names
                UNION ALL
                SELECT * FROM canonical_names
            ),
            ranked AS (
                SELECT
                    c.*,
                    row_number() OVER (
                        PARTITION BY c.routing_edge_id, c.language_code, c.name_type, c.name
                        ORDER BY c.is_primary DESC, c.priority ASC
                    ) AS rn
                FROM combined AS c
            )
            SELECT routing_edge_id, name, language_code, script_code, name_type, is_primary
            FROM ranked
            WHERE rn = 1
        `;

        await this.insertPostBuildValidationReports(buildJobId, validationCodes);

        if (!input.dryRun) {
            await this.prisma.$executeRaw`
                UPDATE core.core_streets AS s
                SET routing_status = 'synced', updated_at = now()
                FROM _rg_selected_roads AS sr
                WHERE s.id = sr.core_street_id
            `;
        }

        const nodeCount = await this.countForJob("routing.routing_nodes", buildJobId);
        const edgeCount = await this.countForJob("routing.routing_edges", buildJobId);
        const edgeNameCount = await this.countEdgeNames(buildJobId);
        const reportCounts = await this.countReports(buildJobId);

        return {
            selectedCoreRoadCount,
            generatedNodeCount: nodeCount,
            generatedEdgeCount: edgeCount,
            generatedEdgeNameCount: edgeNameCount,
            warningCount: reportCounts.warnings,
            errorCount: reportCounts.errors,
            validationCodes,
        };
    }

    private async dryRunCounts(selectedCoreRoadCount: number): Promise<RoutingGraphBuildCounts> {
        await this.prisma.$executeRaw`DROP TABLE IF EXISTS _rg_parts`;
        await this.prisma.$executeRaw`
            CREATE TEMP TABLE _rg_parts ON COMMIT DROP AS
            WITH dumped AS (
                SELECT
                    sr.core_street_id,
                    CASE
                        WHEN ST_GeometryType(sr.raw_geom) = 'ST_LineString'
                            THEN sr.raw_geom::geometry(LineString, 4326)
                        WHEN ST_GeometryType(sr.raw_geom) = 'ST_MultiLineString' THEN (
                            SELECT (ST_Dump(sr.raw_geom)).geom::geometry(LineString, 4326)
                            ORDER BY ST_Length(((ST_Dump(sr.raw_geom)).geom)::geography) DESC
                            LIMIT 1
                        )
                        ELSE NULL::geometry(LineString, 4326)
                    END AS line_geom
                FROM _rg_selected_roads AS sr
            )
            SELECT
                d.core_street_id,
                d.line_geom,
                CASE
                    WHEN d.line_geom IS NULL OR NOT ST_IsValid(d.line_geom) OR ST_IsEmpty(d.line_geom)
                        THEN NULL::numeric
                    ELSE ST_Length(d.line_geom::geography)
                END AS length_m
            FROM dumped AS d
        `;

        const partStats = await this.prisma.$queryRaw<
            { valid_parts: bigint; invalid_parts: bigint; zero_length: bigint }[]
        >`
            SELECT
                count(*) FILTER (
                    WHERE line_geom IS NOT NULL
                      AND ST_IsValid(line_geom)
                      AND NOT ST_IsEmpty(line_geom)
                      AND length_m > 0
                )::bigint AS valid_parts,
                count(*) FILTER (
                    WHERE line_geom IS NULL OR NOT ST_IsValid(line_geom) OR ST_IsEmpty(line_geom)
                )::bigint AS invalid_parts,
                count(*) FILTER (WHERE length_m IS NOT NULL AND length_m <= 0)::bigint AS zero_length
            FROM _rg_parts
        `;
        const stats = partStats[0];
        const validParts = Number(stats?.valid_parts ?? 0);
        const validationCodes = [
            "INTERSECTION_SPLITTING_NOT_IMPLEMENTED",
            "TURN_RESTRICTIONS_NOT_APPLIED",
        ];
        if (Number(stats?.invalid_parts ?? 0) > 0) {
            validationCodes.push("INVALID_GEOMETRY");
        }
        if (Number(stats?.zero_length ?? 0) > 0) {
            validationCodes.push("ZERO_LENGTH_EDGE");
        }

        return {
            selectedCoreRoadCount,
            generatedNodeCount: validParts * 2,
            generatedEdgeCount: validParts,
            generatedEdgeNameCount: validParts,
            warningCount: validationCodes.length,
            errorCount: selectedCoreRoadCount === 0 || validParts === 0 ? 1 : 0,
            validationCodes,
        };
    }

    private async insertPreBuildValidationReports(
        buildJobId: bigint,
        validationCodes: string[]
    ): Promise<void> {
        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_validation_reports (
                build_job_id, severity, code, message, core_street_id, metadata
            )
            SELECT
                ${buildJobId},
                'error',
                'INVALID_GEOMETRY',
                'Core street geometry is missing or invalid for routing graph build.',
                sr.core_street_id,
                '{}'::jsonb
            FROM _rg_selected_roads AS sr
            INNER JOIN _rg_parts AS p ON p.core_street_id = sr.core_street_id
            WHERE p.line_geom IS NULL OR NOT ST_IsValid(p.line_geom) OR ST_IsEmpty(p.line_geom)
        `;

        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_validation_reports (
                build_job_id, severity, code, message, core_street_id, metadata
            )
            SELECT
                ${buildJobId},
                'error',
                'ZERO_LENGTH_EDGE',
                'Core street line geometry has zero or negative length.',
                p.core_street_id,
                jsonb_build_object('length_m', p.length_m)
            FROM _rg_parts AS p
            WHERE p.length_m IS NOT NULL AND p.length_m <= 0
        `;

        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_validation_reports (
                build_job_id, severity, code, message, core_street_id, metadata
            )
            SELECT
                ${buildJobId},
                'warning',
                'MISSING_ROAD_CLASS',
                'Core street has no resolvable road class id.',
                sr.core_street_id,
                jsonb_build_object('road_class_code', sr.road_class_code)
            FROM _rg_selected_roads AS sr
            WHERE sr.road_class_id IS NULL
        `;

        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_validation_reports (
                build_job_id, severity, code, message, core_street_id, metadata
            )
            SELECT
                ${buildJobId},
                'warning',
                'ONEWAY_UNKNOWN',
                'Core street oneway flag is null; treated as bidirectional.',
                sr.core_street_id,
                '{}'::jsonb
            FROM _rg_selected_roads AS sr
            WHERE sr.is_oneway IS NULL
        `;

        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_validation_reports (
                build_job_id, severity, code, message, metadata
            )
            VALUES
                (
                    ${buildJobId},
                    'warning',
                    'INTERSECTION_SPLITTING_NOT_IMPLEMENTED',
                    'Phase 9E v1 builds endpoint-only graphs. Intersections are not split into shared nodes yet (Phase 9E2).',
                    jsonb_build_object('endpoint_only', true)
                ),
                (
                    ${buildJobId},
                    'warning',
                    'TURN_RESTRICTIONS_NOT_APPLIED',
                    'routing.routing_turn_restrictions exists but no turn restrictions were ingested in this build.',
                    jsonb_build_object('turn_restrictions_applied', false)
                )
        `;

        validationCodes.push(
            "INTERSECTION_SPLITTING_NOT_IMPLEMENTED",
            "TURN_RESTRICTIONS_NOT_APPLIED"
        );
    }

    private async insertPostBuildValidationReports(
        buildJobId: bigint,
        validationCodes: string[]
    ): Promise<void> {
        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_validation_reports (
                build_job_id, severity, code, message, routing_edge_id, metadata
            )
            SELECT
                ${buildJobId},
                'warning',
                'DUPLICATE_EDGE',
                'Duplicate directed edge detected for the same street segment and node pair.',
                e.id,
                jsonb_build_object(
                    'core_street_id', e.core_street_id,
                    'from_node_id', e.from_node_id,
                    'to_node_id', e.to_node_id
                )
            FROM routing.routing_edges AS e
            INNER JOIN (
                SELECT core_street_id, from_node_id, to_node_id, count(*) AS c
                FROM routing.routing_edges
                WHERE build_job_id = ${buildJobId}
                GROUP BY core_street_id, from_node_id, to_node_id
                HAVING count(*) > 1
            ) AS d
                ON d.core_street_id = e.core_street_id
               AND d.from_node_id = e.from_node_id
               AND d.to_node_id = e.to_node_id
            WHERE e.build_job_id = ${buildJobId}
        `;

        await this.prisma.$executeRaw`
            INSERT INTO routing.routing_validation_reports (
                build_job_id, severity, code, message, core_street_id, metadata
            )
            SELECT
                ${buildJobId},
                'warning',
                'DISCONNECTED_ENDPOINT',
                'Street geometries cross but no shared intersection node was created (endpoint-only build).',
                p1.core_street_id,
                jsonb_build_object('other_core_street_id', p2.core_street_id)
            FROM _rg_parts AS p1
            INNER JOIN _rg_parts AS p2
                ON p1.core_street_id < p2.core_street_id
            WHERE p1.line_geom IS NOT NULL
              AND p2.line_geom IS NOT NULL
              AND ST_Crosses(p1.line_geom, p2.line_geom)
        `;

        const codes = await this.prisma.$queryRaw<{ code: string }[]>`
            SELECT DISTINCT code
            FROM routing.routing_validation_reports
            WHERE build_job_id = ${buildJobId}
            ORDER BY code
        `;
        validationCodes.splice(0, validationCodes.length, ...codes.map((c) => c.code));
    }

    private async countForJob(table: "routing.routing_nodes" | "routing.routing_edges", buildJobId: bigint) {
        if (table === "routing.routing_nodes") {
            const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
                SELECT count(*)::bigint AS count
                FROM routing.routing_nodes
                WHERE build_job_id = ${buildJobId}
            `;
            return Number(rows[0]?.count ?? 0);
        }
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM routing.routing_edges
            WHERE build_job_id = ${buildJobId}
        `;
        return Number(rows[0]?.count ?? 0);
    }

    private async countEdgeNames(buildJobId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM routing.routing_edge_names AS en
            INNER JOIN routing.routing_edges AS e ON e.id = en.routing_edge_id
            WHERE e.build_job_id = ${buildJobId}
        `;
        return Number(rows[0]?.count ?? 0);
    }

    private async countReports(buildJobId: bigint): Promise<{ warnings: number; errors: number }> {
        const rows = await this.prisma.$queryRaw<
            { warnings: bigint; errors: bigint }[]
        >`
            SELECT
                count(*) FILTER (WHERE severity = 'warning')::bigint AS warnings,
                count(*) FILTER (WHERE severity = 'error')::bigint AS errors
            FROM routing.routing_validation_reports
            WHERE build_job_id = ${buildJobId}
        `;
        return {
            warnings: Number(rows[0]?.warnings ?? 0),
            errors: Number(rows[0]?.errors ?? 0),
        };
    }
}

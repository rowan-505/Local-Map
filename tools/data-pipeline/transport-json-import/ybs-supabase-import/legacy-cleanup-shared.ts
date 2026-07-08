/**
 * Shared helpers for Phase D legacy bus route and orphan stop cleanup.
 *
 * Read queries and planning only. Execute modules call these for scope collection.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import type pg from "pg";

import { isProtectedReviewStatus } from "./supabase-schema-map.js";
import { YBS_SOURCE_KIND, YBS_SOURCE_NAME } from "./source-link-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "../../../../");
export const DEFAULT_REPORT_DIR = join(REPO_ROOT, "tmp/transport-imports/legacy-cleanup");

export type CleanupMode = "dry_run" | "execute";

export type LegacyRouteRow = {
    id: number;
    route_code: string;
    public_name: string;
    review_status: string | null;
    is_active: boolean | null;
};

export type SystematicRouteRow = {
    id: number;
    route_code: string;
    public_name: string;
    ybs_external_id: string;
};

export type SourceLinkSummary = {
    id: number;
    entity_type: string;
    entity_id: number;
    external_id: string | null;
    source_name: string | null;
};

export type RouteTreeScope = {
    variant_ids: number[];
    route_stop_ids: number[];
    route_path_ids: number[];
    fare_ids: number[];
    route_name_count: number;
    service_note_ids: number[];
    stop_ids: number[];
    source_link_ids: number[];
    source_links: SourceLinkSummary[];
};

export type LegacyRouteTreeScope = {
    route_id: number;
    variant_ids: number[];
    route_stop_ids: number[];
    route_path_ids: number[];
    fare_ids: number[];
    route_name_count: number;
    service_note_ids: number[];
    stop_ids: number[];
    stop_ids_shared_with_systematic: number[];
    stop_ids_legacy_only: number[];
    source_link_ids: number[];
    source_links: SourceLinkSummary[];
    source_links_by_entity_type: Record<string, number>;
};

export type TransportColumnSupport = {
    route_paths_deleted_at: boolean;
    route_paths_is_active: boolean;
    route_variants_deleted_at: boolean;
    route_variants_is_active: boolean;
    routes_deleted_at: boolean;
    routes_is_active: boolean;
    fares_is_active: boolean;
    fares_deleted_at: boolean;
};

export type PhaseD1CleanupPlan = {
    route_id: number;
    route_code: string;
    scope: LegacyRouteTreeScope;
    blockers: string[];
    warnings: string[];
    eligible: boolean;
    planned_actions: {
        route_stops_deleted: number;
        route_paths_soft_deleted: number;
        route_variants_soft_deleted: number;
        routes_soft_deleted: number;
        fares_deactivated: number;
        route_names_left: number;
        source_links_deleted: number;
        stops_left_untouched: number;
    };
};

export type LegacyRouteCandidate = LegacyRouteRow & {
    variant_count: number;
    route_stop_count: number;
    route_path_count: number;
    unique_stop_count: number;
    stops_shared_with_systematic_count: number;
    stop_ids_shared_with_systematic: number[];
    legacy_only_stop_count: number;
    legacy_only_stop_ids: number[];
    source_links_affected: SourceLinkSummary[];
    blockers: string[];
    warnings: string[];
    eligible: boolean;
};

export type OrphanLegacyStopCandidate = {
    stop_id: number;
    review_status: string | null;
    is_active: boolean | null;
    name: string | null;
    route_stop_refs: number;
    terminal_link_count: number;
    parent_child_count: number;
    used_by_systematic_route: boolean;
    external_ids: string[];
    blockers: string[];
    warnings: string[];
    eligible: boolean;
    planned_action: "delete" | "skipped_protected" | "skipped_still_used" | "skipped_terminal_linked" | "skipped_parent_linked" | "skipped_systematic_shared";
};

export function loadEnv(): void {
    loadDotenv({ path: join(REPO_ROOT, ".env") });
    loadDotenv({ path: join(REPO_ROOT, "apps/api/.env") });
}

export function getDatabaseUrl(): string {
    const url =
        process.env.SUPABASE_DB_URL ??
        process.env.DATABASE_URL ??
        process.env.DIRECT_URL;
    if (!url) {
        throw new Error(
            "Missing database URL. Set SUPABASE_DB_URL, DATABASE_URL, or DIRECT_URL.",
        );
    }
    return url;
}

export function resolveReportDir(reportDirArg?: string): string {
    if (!reportDirArg) return DEFAULT_REPORT_DIR;
    return reportDirArg.startsWith("/") ? reportDirArg : join(REPO_ROOT, reportDirArg);
}

export function writeJsonReport(filePath: string, payload: unknown): string {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return filePath;
}

export function writeMarkdownReport(filePath: string, content: string): string {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
    return filePath;
}

export async function loadSystematicRoutes(client: pg.Client): Promise<SystematicRouteRow[]> {
    const result = await client.query<SystematicRouteRow & { ybs_external_id: string }>(
        `
        select distinct on (r.id)
            r.id,
            r.route_code,
            r.public_name,
            sl.external_id as ybs_external_id
        from transport.routes r
        inner join transport.source_links sl
            on sl.entity_type = 'route'
           and sl.entity_id = r.id
           and sl.source_name = $1
           and sl.external_id like 'route:ybs_go:%'
        where r.mode = 'bus'
          and r.deleted_at is null
        order by r.id, sl.id
        `,
        [YBS_SOURCE_NAME],
    );
    return result.rows;
}

export async function loadLegacyRoutes(client: pg.Client): Promise<LegacyRouteRow[]> {
    const result = await client.query<LegacyRouteRow>(
        `
        select
            r.id,
            r.route_code,
            r.public_name,
            r.review_status,
            r.is_active
        from transport.routes r
        where r.mode = 'bus'
          and r.deleted_at is null
          and not exists (
              select 1
              from transport.source_links sl
              where sl.entity_type = 'route'
                and sl.entity_id = r.id
                and sl.source_name = $1
                and sl.external_id like 'route:ybs_go:%'
          )
        order by r.route_code, r.id
        `,
        [YBS_SOURCE_NAME],
    );
    return result.rows;
}

export async function hasYbsRouteSourceLink(
    client: pg.Client,
    routeId: number,
): Promise<boolean> {
    const result = await client.query<{ exists: boolean }>(
        `
        select exists (
            select 1
            from transport.source_links sl
            where sl.entity_type = 'route'
              and sl.entity_id = $1
              and sl.source_name = $2
              and sl.external_id like 'route:ybs_go:%'
        ) as exists
        `,
        [routeId, YBS_SOURCE_NAME],
    );
    return result.rows[0]?.exists ?? false;
}

export async function collectRouteTreeScope(
    client: pg.Client,
    routeId: number,
): Promise<RouteTreeScope> {
    const variants = await client.query<{ id: number }>(
        `select id from transport.route_variants where route_id = $1`,
        [routeId],
    );
    const variantIds = variants.rows.map((row) => row.id);

    const routeStops =
        variantIds.length === 0
            ? { rows: [] as { id: number; stop_id: number }[] }
            : await client.query<{ id: number; stop_id: number }>(
                  `
                  select id, stop_id
                  from transport.route_stops
                  where route_variant_id = any($1::bigint[])
                  `,
                  [variantIds],
              );

    const routePaths =
        variantIds.length === 0
            ? { rows: [] as { id: number }[] }
            : await client.query<{ id: number }>(
                  `
                  select id
                  from transport.route_paths
                  where route_variant_id = any($1::bigint[])
                  `,
                  [variantIds],
              );

    const fares = await client.query<{ id: number }>(
        `
        select id
        from transport.fares
        where route_id = $1
           or route_variant_id = any($2::bigint[])
        `,
        [routeId, variantIds.length > 0 ? variantIds : [0]],
    );

    const routeNames = await client.query<{ id: number }>(
        `select id from transport.route_names where route_id = $1`,
        [routeId],
    );

    const serviceNotes = await client.query<{ id: number }>(
        `
        select id
        from transport.service_notes
        where route_id = $1
           or route_variant_id = any($2::bigint[])
        `,
        [routeId, variantIds.length > 0 ? variantIds : [0]],
    );

    const routeStopIds = routeStops.rows.map((row) => row.id);
    const routePathIds = routePaths.rows.map((row) => row.id);
    const fareIds = fares.rows.map((row) => row.id);
    const stopIds = [...new Set(routeStops.rows.map((row) => row.stop_id))];

    const sourceLinks = await client.query<SourceLinkSummary>(
        `
        select id, entity_type, entity_id, external_id, source_name
        from transport.source_links
        where (entity_type = 'route' and entity_id = $1)
           or (entity_type = 'route_variant' and entity_id = any($2::bigint[]))
           or (entity_type = 'route_stop' and entity_id = any($3::bigint[]))
           or (entity_type = 'route_path' and entity_id = any($4::bigint[]))
           or (entity_type = 'fare' and entity_id = any($5::bigint[]))
        order by entity_type, id
        `,
        [routeId, variantIds, routeStopIds, routePathIds, fareIds],
    );

    return {
        variant_ids: variantIds,
        route_stop_ids: routeStopIds,
        route_path_ids: routePathIds,
        fare_ids: fareIds,
        route_name_count: routeNames.rowCount ?? routeNames.rows.length,
        service_note_ids: serviceNotes.rows.map((row) => row.id),
        stop_ids: stopIds,
        source_link_ids: sourceLinks.rows.map((row) => row.id),
        source_links: sourceLinks.rows,
    };
}

export async function loadSystematicStopIds(client: pg.Client): Promise<Set<number>> {
    const result = await client.query<{ stop_id: number }>(
        `
        select distinct rs.stop_id
        from transport.route_stops rs
        inner join transport.route_variants rv on rv.id = rs.route_variant_id
        inner join transport.routes r on r.id = rv.route_id
        inner join transport.source_links sl
            on sl.entity_type = 'route'
           and sl.entity_id = r.id
           and sl.source_name = $1
           and sl.external_id like 'route:ybs_go:%'
        where r.mode = 'bus'
          and r.deleted_at is null
        `,
        [YBS_SOURCE_NAME],
    );
    return new Set(result.rows.map((row) => row.stop_id));
}

export async function buildLegacyRouteCandidate(
    client: pg.Client,
    route: LegacyRouteRow,
    systematicStopIds: Set<number>,
): Promise<LegacyRouteCandidate> {
    const scope = await collectRouteTreeScope(client, route.id);
    const sharedStopIds = scope.stop_ids.filter((stopId) => systematicStopIds.has(stopId));
    const legacyOnlyStopIds = scope.stop_ids.filter((stopId) => !systematicStopIds.has(stopId));

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (await hasYbsRouteSourceLink(client, route.id)) {
        blockers.push("route has external_ybs_app route source link — excluded from legacy cleanup");
    }
    if (isProtectedReviewStatus(route.review_status)) {
        blockers.push(
            `route review_status=${route.review_status ?? "null"} is protected (reviewed/verified/manual_protected)`,
        );
    }
    if (sharedStopIds.length > 0) {
        warnings.push(
            `${sharedStopIds.length} stop(s) on this route are also used by systematic YBS routes — stops will be kept in Phase D1`,
        );
    }
    if (route.is_active) {
        warnings.push("route is_active=true");
    }

    return {
        ...route,
        variant_count: scope.variant_ids.length,
        route_stop_count: scope.route_stop_ids.length,
        route_path_count: scope.route_path_ids.length,
        unique_stop_count: scope.stop_ids.length,
        stops_shared_with_systematic_count: sharedStopIds.length,
        stop_ids_shared_with_systematic: sharedStopIds,
        legacy_only_stop_count: legacyOnlyStopIds.length,
        legacy_only_stop_ids: legacyOnlyStopIds,
        source_links_affected: scope.source_links,
        blockers,
        warnings,
        eligible: blockers.length === 0,
    };
}

export async function loadLegacyOnlyStopCandidates(
    client: pg.Client,
): Promise<
    Array<{
        stop_id: number;
        review_status: string | null;
        is_active: boolean | null;
        name: string | null;
        route_stop_refs: number;
        terminal_link_count: number;
        parent_child_count: number;
        used_by_systematic_route: boolean;
        external_ids: string[];
    }>
> {
    const result = await client.query<{
        stop_id: string;
        review_status: string | null;
        is_active: boolean | null;
        name: string | null;
        route_stop_refs: number;
        terminal_link_count: number;
        parent_child_count: number;
        used_by_systematic_route: boolean;
        external_ids: string[] | null;
    }>(
        `
        with systematic_routes as (
            select r.id
            from transport.routes r
            inner join transport.source_links sl
                on sl.entity_type = 'route'
               and sl.entity_id = r.id
               and sl.source_name = $1
               and sl.external_id like 'route:ybs_go:%'
            where r.mode = 'bus'
              and r.deleted_at is null
        ),
        legacy_routes as (
            select r.id
            from transport.routes r
            where r.mode = 'bus'
              and r.deleted_at is null
              and not exists (
                  select 1
                  from transport.source_links sl
                  where sl.entity_type = 'route'
                    and sl.entity_id = r.id
                    and sl.source_name = $1
                    and sl.external_id like 'route:ybs_go:%'
              )
        ),
        legacy_route_stops as (
            select distinct rs.stop_id
            from transport.route_stops rs
            inner join transport.route_variants rv on rv.id = rs.route_variant_id
            where rv.route_id in (select id from legacy_routes)
        ),
        systematic_route_stops as (
            select distinct rs.stop_id
            from transport.route_stops rs
            inner join transport.route_variants rv on rv.id = rs.route_variant_id
            where rv.route_id in (select id from systematic_routes)
        ),
        legacy_only_stops as (
            select lrs.stop_id
            from legacy_route_stops lrs
            where lrs.stop_id not in (select stop_id from systematic_route_stops)
        )
        select
            s.id::text as stop_id,
            s.review_status,
            s.is_active,
            coalesce(s.name_mm, s.name_en, s.name) as name,
            coalesce(rs.route_stop_refs, 0)::int as route_stop_refs,
            coalesce(t.terminal_link_count, 0)::int as terminal_link_count,
            coalesce(p.parent_child_count, 0)::int as parent_child_count,
            exists (
                select 1 from systematic_route_stops srs where srs.stop_id = s.id
            ) as used_by_systematic_route,
            (
                select array_agg(distinct sl.external_id order by sl.external_id)
                from transport.source_links sl
                where sl.entity_type = 'stop'
                  and sl.entity_id = s.id
            ) as external_ids
        from transport.stops s
        inner join legacy_only_stops los on los.stop_id = s.id
        left join lateral (
            select count(*)::int as route_stop_refs
            from transport.route_stops rs
            where rs.stop_id = s.id
        ) rs on true
        left join lateral (
            select count(*)::int as terminal_link_count
            from transport.terminals t
            where t.linked_stop_id = s.id
              and t.deleted_at is null
        ) t on true
        left join lateral (
            select count(*)::int as parent_child_count
            from transport.stops child
            where child.parent_stop_id = s.id
              and child.deleted_at is null
        ) p on true
        where s.deleted_at is null
        order by s.id
        `,
        [YBS_SOURCE_NAME],
    );

    return result.rows.map((row) => ({
        stop_id: Number(row.stop_id),
        review_status: row.review_status,
        is_active: row.is_active,
        name: row.name,
        route_stop_refs: row.route_stop_refs,
        terminal_link_count: row.terminal_link_count,
        parent_child_count: row.parent_child_count,
        used_by_systematic_route: row.used_by_systematic_route,
        external_ids: row.external_ids ?? [],
    }));
}

export function planOrphanLegacyStop(
    row: Awaited<ReturnType<typeof loadLegacyOnlyStopCandidates>>[number],
): OrphanLegacyStopCandidate {
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (row.used_by_systematic_route) {
        blockers.push("stop is also used by a systematic YBS route");
    }
    if (isProtectedReviewStatus(row.review_status)) {
        blockers.push(
            `stop review_status=${row.review_status ?? "null"} is protected (reviewed/verified/manual_protected)`,
        );
    }
    if (row.route_stop_refs > 0) {
        blockers.push(`stop still has ${row.route_stop_refs} route_stops reference(s)`);
    }
    if (row.terminal_link_count > 0) {
        blockers.push(`stop is linked to ${row.terminal_link_count} terminal(s)`);
    }
    if (row.parent_child_count > 0) {
        blockers.push(`stop has ${row.parent_child_count} child stop(s)`);
    }
    if (row.is_active) {
        warnings.push("stop is_active=true");
    }

    let planned_action: OrphanLegacyStopCandidate["planned_action"] = "delete";
    if (row.used_by_systematic_route) {
        planned_action = "skipped_systematic_shared";
    } else if (isProtectedReviewStatus(row.review_status)) {
        planned_action = "skipped_protected";
    } else if (row.route_stop_refs > 0) {
        planned_action = "skipped_still_used";
    } else if (row.terminal_link_count > 0) {
        planned_action = "skipped_terminal_linked";
    } else if (row.parent_child_count > 0) {
        planned_action = "skipped_parent_linked";
    }

    return {
        stop_id: row.stop_id,
        review_status: row.review_status,
        is_active: row.is_active,
        name: row.name,
        route_stop_refs: row.route_stop_refs,
        terminal_link_count: row.terminal_link_count,
        parent_child_count: row.parent_child_count,
        used_by_systematic_route: row.used_by_systematic_route,
        external_ids: row.external_ids,
        blockers,
        warnings,
        eligible: blockers.length === 0,
        planned_action,
    };
}

export async function detachVariantStopForeignReferences(
    client: pg.Client,
    stopIds: number[],
    variantIds: number[],
): Promise<{
    terminals_unlinked: number;
    route_variant_stop_refs_cleared: number;
    parent_stop_refs_cleared: number;
}> {
    if (stopIds.length === 0) {
        return {
            terminals_unlinked: 0,
            route_variant_stop_refs_cleared: 0,
            parent_stop_refs_cleared: 0,
        };
    }

    const terminals = await client.query(
        `
        update transport.terminals
        set linked_stop_id = null, updated_at = now()
        where linked_stop_id = any($1::bigint[])
          and deleted_at is null
        `,
        [stopIds],
    );
    const variantRefs = await client.query(
        `
        update transport.route_variants
        set origin_stop_id = case when origin_stop_id = any($1::bigint[]) then null else origin_stop_id end,
            destination_stop_id = case when destination_stop_id = any($1::bigint[]) then null else destination_stop_id end,
            updated_at = now()
        where (origin_stop_id = any($1::bigint[]) or destination_stop_id = any($1::bigint[]))
          and id <> all($2::bigint[])
        `,
        [stopIds, variantIds.length > 0 ? variantIds : [0]],
    );
    const parentRefs = await client.query(
        `
        update transport.stops
        set parent_stop_id = null, updated_at = now()
        where parent_stop_id = any($1::bigint[])
          and deleted_at is null
        `,
        [stopIds],
    );

    return {
        terminals_unlinked: terminals.rowCount ?? 0,
        route_variant_stop_refs_cleared: variantRefs.rowCount ?? 0,
        parent_stop_refs_cleared: parentRefs.rowCount ?? 0,
    };
}

export async function detectTransportColumnSupport(
    client: pg.Client,
): Promise<TransportColumnSupport> {
    const result = await client.query<{ table_name: string; column_name: string }>(
        `
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'transport'
          and table_name in ('routes', 'route_variants', 'route_paths', 'fares')
          and column_name in ('deleted_at', 'is_active')
        `,
    );

    const columns = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`));

    return {
        route_paths_deleted_at: columns.has("route_paths.deleted_at"),
        route_paths_is_active: columns.has("route_paths.is_active"),
        route_variants_deleted_at: columns.has("route_variants.deleted_at"),
        route_variants_is_active: columns.has("route_variants.is_active"),
        routes_deleted_at: columns.has("routes.deleted_at"),
        routes_is_active: columns.has("routes.is_active"),
        fares_is_active: columns.has("fares.is_active"),
        fares_deleted_at: columns.has("fares.deleted_at"),
    };
}

function countSourceLinksByEntityType(
    links: SourceLinkSummary[],
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const link of links) {
        counts[link.entity_type] = (counts[link.entity_type] ?? 0) + 1;
    }
    return counts;
}

export async function collectLegacyRouteTreeScope(
    client: pg.Client,
    routeId: number,
    systematicStopIds: Set<number>,
): Promise<LegacyRouteTreeScope> {
    const variants = await client.query<{ id: number }>(
        `
        select id
        from transport.route_variants
        where route_id = $1
          and deleted_at is null
        `,
        [routeId],
    );
    const variantIds = variants.rows.map((row) => row.id);

    const routeStops =
        variantIds.length === 0
            ? { rows: [] as { id: number; stop_id: number }[] }
            : await client.query<{ id: number; stop_id: number }>(
                  `
                  select id, stop_id
                  from transport.route_stops
                  where route_variant_id = any($1::bigint[])
                  `,
                  [variantIds],
              );

    const routePaths =
        variantIds.length === 0
            ? { rows: [] as { id: number }[] }
            : await client.query<{ id: number }>(
                  `
                  select id
                  from transport.route_paths
                  where route_variant_id = any($1::bigint[])
                    and deleted_at is null
                  `,
                  [variantIds],
              );

    const fares = await client.query<{ id: number }>(
        `
        select id
        from transport.fares
        where route_id = $1
           or route_variant_id = any($2::bigint[])
        `,
        [routeId, variantIds.length > 0 ? variantIds : [0]],
    );

    const routeNames = await client.query<{ id: number }>(
        `select id from transport.route_names where route_id = $1`,
        [routeId],
    );

    const serviceNotes = await client.query<{ id: number }>(
        `
        select id
        from transport.service_notes
        where route_id = $1
           or route_variant_id = any($2::bigint[])
        `,
        [routeId, variantIds.length > 0 ? variantIds : [0]],
    );

    const routeStopIds = routeStops.rows.map((row) => row.id);
    const routePathIds = routePaths.rows.map((row) => row.id);
    const fareIds = fares.rows.map((row) => row.id);
    const stopIds = [...new Set(routeStops.rows.map((row) => row.stop_id))];
    const sharedStopIds = stopIds.filter((stopId) => systematicStopIds.has(stopId));
    const legacyOnlyStopIds = stopIds.filter((stopId) => !systematicStopIds.has(stopId));

    const sourceLinks = await client.query<SourceLinkSummary>(
        `
        select id, entity_type, entity_id, external_id, source_name
        from transport.source_links
        where (entity_type = 'route' and entity_id = $1)
           or (entity_type = 'route_variant' and entity_id = any($2::bigint[]))
           or (entity_type = 'route_stop' and entity_id = any($3::bigint[]))
           or (entity_type = 'route_path' and entity_id = any($4::bigint[]))
        order by entity_type, id
        `,
        [routeId, variantIds, routeStopIds, routePathIds],
    );

    return {
        route_id: routeId,
        variant_ids: variantIds,
        route_stop_ids: routeStopIds,
        route_path_ids: routePathIds,
        fare_ids: fareIds,
        route_name_count: routeNames.rowCount ?? routeNames.rows.length,
        service_note_ids: serviceNotes.rows.map((row) => row.id),
        stop_ids: stopIds,
        stop_ids_shared_with_systematic: sharedStopIds,
        stop_ids_legacy_only: legacyOnlyStopIds,
        source_link_ids: sourceLinks.rows.map((row) => row.id),
        source_links: sourceLinks.rows,
        source_links_by_entity_type: countSourceLinksByEntityType(sourceLinks.rows),
    };
}

export async function verifyRouteIsLegacy(client: pg.Client, routeId: number): Promise<{
    is_legacy: boolean;
    blockers: string[];
}> {
    const route = await client.query<{
        id: number;
        mode: string;
        deleted_at: string | null;
    }>(
        `
        select id, mode, deleted_at
        from transport.routes
        where id = $1
        limit 1
        `,
        [routeId],
    );
    const row = route.rows[0];
    const blockers: string[] = [];

    if (!row) {
        return { is_legacy: false, blockers: ["route row not found"] };
    }
    if (row.deleted_at) {
        blockers.push("route is already soft-deleted (deleted_at is set)");
    }
    if (row.mode !== "bus") {
        blockers.push(`route mode=${row.mode} is not bus`);
    }
    if (await hasYbsRouteSourceLink(client, routeId)) {
        blockers.push("route has external_ybs_app route source link");
    }
    if (blockers.length === 0) {
        const legacyCheck = await client.query<{ exists: boolean }>(
            `
            select exists (
                select 1
                from transport.routes r
                where r.id = $1
                  and r.mode = 'bus'
                  and r.deleted_at is null
                  and not exists (
                      select 1
                      from transport.source_links sl
                      where sl.entity_type = 'route'
                        and sl.entity_id = r.id
                        and sl.source_name = $2
                        and sl.external_id like 'route:ybs_go:%'
                  )
            ) as exists
            `,
            [routeId, YBS_SOURCE_NAME],
        );
        if (!legacyCheck.rows[0]?.exists) {
            blockers.push("route cannot be proven legacy by current definition");
        }
    }

    return { is_legacy: blockers.length === 0, blockers };
}

export async function detectSystematicRouteStopCollision(
    client: pg.Client,
    routeId: number,
    variantIds: number[],
    routeStopIds: number[],
): Promise<{ affected: number; systematic_route_ids: number[] }> {
    if (variantIds.length === 0 && routeStopIds.length === 0) {
        return { affected: 0, systematic_route_ids: [] };
    }

    const result = await client.query<{ route_id: number }>(
        `
        with scoped_variants as (
            select rv.id, rv.route_id
            from transport.route_variants rv
            where rv.id = any($1::bigint[])
        ),
        scoped_route_stops as (
            select rs.id, rv.route_id
            from transport.route_stops rs
            inner join transport.route_variants rv on rv.id = rs.route_variant_id
            where rs.id = any($2::bigint[])
        ),
        systematic_routes as (
            select r.id
            from transport.routes r
            inner join transport.source_links sl
                on sl.entity_type = 'route'
               and sl.entity_id = r.id
               and sl.source_name = $3
               and sl.external_id like 'route:ybs_go:%'
            where r.mode = 'bus'
              and r.deleted_at is null
        )
        select distinct route_id
        from (
            select sv.route_id
            from scoped_variants sv
            where sv.route_id in (select id from systematic_routes)
            union
            select srs.route_id
            from scoped_route_stops srs
            where srs.route_id in (select id from systematic_routes)
            union
            select sv.route_id
            from scoped_variants sv
            where sv.route_id <> $4
            union
            select srs.route_id
            from scoped_route_stops srs
            where srs.route_id <> $4
        ) collisions
        `,
        [
            variantIds.length > 0 ? variantIds : [0],
            routeStopIds.length > 0 ? routeStopIds : [0],
            YBS_SOURCE_NAME,
            routeId,
        ],
    );

    return {
        affected: result.rows.length,
        systematic_route_ids: result.rows.map((row) => row.route_id),
    };
}

export async function buildPhaseD1CleanupPlan(
    client: pg.Client,
    route: LegacyRouteRow,
    systematicStopIds: Set<number>,
): Promise<PhaseD1CleanupPlan> {
    const scope = await collectLegacyRouteTreeScope(client, route.id, systematicStopIds);
    const legacyProof = await verifyRouteIsLegacy(client, route.id);
    const systematicCollision = await detectSystematicRouteStopCollision(
        client,
        route.id,
        scope.variant_ids,
        scope.route_stop_ids,
    );

    const blockers = [...legacyProof.blockers];
    const warnings: string[] = [];

    if (isProtectedReviewStatus(route.review_status)) {
        blockers.push(
            `route review_status=${route.review_status ?? "null"} is protected (reviewed/verified/manual_protected)`,
        );
    }
    if (systematicCollision.affected > 0) {
        blockers.push(
            `cleanup would affect ${systematicCollision.affected} systematic route(s) via route_stops: ${systematicCollision.systematic_route_ids.join(", ")}`,
        );
    }
    if (scope.stop_ids_shared_with_systematic.length > 0) {
        warnings.push(
            `${scope.stop_ids_shared_with_systematic.length} shared stop(s) will be left untouched`,
        );
    }
    if (route.is_active) {
        warnings.push("route is_active=true");
    }

    return {
        route_id: route.id,
        route_code: route.route_code,
        scope,
        blockers,
        warnings,
        eligible: blockers.length === 0,
        planned_actions: {
            route_stops_deleted: scope.route_stop_ids.length,
            route_paths_soft_deleted: scope.route_path_ids.length,
            route_variants_soft_deleted: scope.variant_ids.length,
            routes_soft_deleted: 1,
            fares_deactivated: scope.fare_ids.length,
            route_names_left: scope.route_name_count,
            source_links_deleted: scope.source_link_ids.length,
            stops_left_untouched: scope.stop_ids.length,
        },
    };
}

export async function executeLegacyRouteTreeSoftCleanup(
    client: pg.Client,
    routeId: number,
    scope: LegacyRouteTreeScope,
    columns: TransportColumnSupport,
): Promise<{
    route_stops_deleted: number;
    route_paths_soft_deleted: number;
    route_variants_soft_deleted: number;
    routes_soft_deleted: number;
    fares_deactivated: number;
    source_links_deleted: number;
    variant_stop_refs_cleared: number;
}> {
    let sourceLinksDeleted = 0;
    let routeStopsDeleted = 0;
    let routePathsSoftDeleted = 0;
    let routeVariantsSoftDeleted = 0;
    let routesSoftDeleted = 0;
    let faresDeactivated = 0;
    let variantStopRefsCleared = 0;

    if (scope.source_link_ids.length > 0) {
        const deleted = await client.query(
            `delete from transport.source_links where id = any($1::bigint[])`,
            [scope.source_link_ids],
        );
        sourceLinksDeleted = deleted.rowCount ?? 0;
    }

    if (scope.route_stop_ids.length > 0) {
        const deleted = await client.query(
            `delete from transport.route_stops where id = any($1::bigint[])`,
            [scope.route_stop_ids],
        );
        routeStopsDeleted = deleted.rowCount ?? 0;
    }

    if (scope.variant_ids.length > 0) {
        const cleared = await client.query(
            `
            update transport.route_variants
            set origin_stop_id = null,
                destination_stop_id = null,
                updated_at = now()
            where id = any($1::bigint[])
            `,
            [scope.variant_ids],
        );
        variantStopRefsCleared = cleared.rowCount ?? 0;
    }

    if (scope.route_path_ids.length > 0) {
        const setClauses = ["updated_at = now()"];
        if (columns.route_paths_deleted_at) setClauses.unshift("deleted_at = now()");
        if (columns.route_paths_is_active) setClauses.unshift("is_active = false");
        const updated = await client.query(
            `
            update transport.route_paths
            set ${setClauses.join(", ")}
            where id = any($1::bigint[])
            `,
            [scope.route_path_ids],
        );
        routePathsSoftDeleted = updated.rowCount ?? 0;
    }

    if (scope.variant_ids.length > 0) {
        const setClauses = ["updated_at = now()"];
        if (columns.route_variants_deleted_at) setClauses.unshift("deleted_at = now()");
        if (columns.route_variants_is_active) setClauses.unshift("is_active = false");
        const updated = await client.query(
            `
            update transport.route_variants
            set ${setClauses.join(", ")}
            where id = any($1::bigint[])
            `,
            [scope.variant_ids],
        );
        routeVariantsSoftDeleted = updated.rowCount ?? 0;
    }

    if (scope.fare_ids.length > 0) {
        const setClauses = ["updated_at = now()"];
        if (columns.fares_is_active) setClauses.unshift("is_active = false");
        if (columns.fares_deleted_at) setClauses.unshift("deleted_at = now()");
        const updated = await client.query(
            `
            update transport.fares
            set ${setClauses.join(", ")}
            where id = any($1::bigint[])
            `,
            [scope.fare_ids],
        );
        faresDeactivated = updated.rowCount ?? 0;
    }

    const routeSetClauses = ["updated_at = now()"];
    if (columns.routes_deleted_at) routeSetClauses.unshift("deleted_at = now()");
    if (columns.routes_is_active) routeSetClauses.unshift("is_active = false");
    const routeUpdated = await client.query(
        `
        update transport.routes
        set ${routeSetClauses.join(", ")}
        where id = $1
          and deleted_at is null
        `,
        [routeId],
    );
    routesSoftDeleted = routeUpdated.rowCount ?? 0;

    return {
        route_stops_deleted: routeStopsDeleted,
        route_paths_soft_deleted: routePathsSoftDeleted,
        route_variants_soft_deleted: routeVariantsSoftDeleted,
        routes_soft_deleted: routesSoftDeleted,
        fares_deactivated: faresDeactivated,
        source_links_deleted: sourceLinksDeleted,
        variant_stop_refs_cleared: variantStopRefsCleared,
    };
}

export async function executeOrphanLegacyStopCleanup(
    client: pg.Client,
    stopIds: number[],
): Promise<{ stop_names_deleted: number; source_links_deleted: number }> {
    const result = await executeOrphanStopCleanup(client, stopIds, {
        hardDelete: true,
        deleteStopSourceLinks: true,
        deleteStopNames: true,
    });
    return {
        stop_names_deleted: result.stop_names_deleted,
        source_links_deleted: result.source_links_deleted,
    };
}

// ---------------------------------------------------------------------------
// Orphan bus stop inspection + Phase D2 cleanup
// ---------------------------------------------------------------------------

export const PROTECTED_STOP_REVIEW_STATUSES = new Set([
    "reviewed",
    "verified",
    "manual_protected",
]);

export const DEFAULT_ORPHAN_CUTOFF_HOURS = 24;

export const PROTECTED_SOURCE_NAME_SUBSTRINGS = ["manual", "admin", "important"] as const;

export type OrphanBusStopCategory =
    | "safe_candidate"
    | "protected"
    | "ybs_source_link"
    | "protected_source_link"
    | "recently_updated"
    | "suspicious_metadata"
    | "referenced_by_other_relation"
    | "still_used_by_route_stops"
    | "used_by_systematic_route";

export type OrphanBusStopRow = {
    stop_id: number;
    public_id: string | null;
    name: string | null;
    name_mm: string | null;
    name_en: string | null;
    review_status: string | null;
    confidence_score: number | null;
    is_active: boolean | null;
    updated_at: string | null;
    deleted_at: string | null;
    source_link_count: number;
    source_names: string[];
    has_ybs_stop_link: boolean;
    has_protected_source_link: boolean;
    route_stop_refs: number;
    used_by_systematic_route: boolean;
    terminal_link_count: number;
    parent_child_count: number;
    suspicious_metadata: boolean;
    category: OrphanBusStopCategory;
    is_safe: boolean;
    block_reasons: string[];
    reason: string;
};

export type OrphanStopClassifyOptions = {
    cutoffMs: number;
    allowYbsSourceStops: boolean;
};

export function resolveOrphanCleanupCutoff(options: {
    cutoff?: string;
    recentHours?: number;
}): { cutoffIso: string; cutoffMs: number; recentHours: number | null } {
    const recentHours = options.recentHours ?? DEFAULT_ORPHAN_CUTOFF_HOURS;
    const cutoffIso =
        options.cutoff ??
        new Date(Date.now() - recentHours * 60 * 60 * 1000).toISOString();
    return {
        cutoffIso,
        cutoffMs: Date.parse(cutoffIso),
        recentHours: options.cutoff ? null : recentHours,
    };
}

export function classifyOrphanBusStop(
    row: Omit<
        OrphanBusStopRow,
        "category" | "is_safe" | "block_reasons" | "reason"
    >,
    options: OrphanStopClassifyOptions,
): OrphanBusStopRow {
    const blockReasons: string[] = [];

    if (row.route_stop_refs > 0) {
        blockReasons.push(`still referenced by ${row.route_stop_refs} route_stops`);
    }
    if (row.used_by_systematic_route) {
        blockReasons.push("used by systematic/current YBS route");
    }
    if (PROTECTED_STOP_REVIEW_STATUSES.has(row.review_status ?? "")) {
        blockReasons.push(`protected review_status=${row.review_status ?? "null"}`);
    }
    if (row.has_ybs_stop_link && !options.allowYbsSourceStops) {
        blockReasons.push("has external_ybs_app stop source link");
    }
    if (row.has_protected_source_link) {
        blockReasons.push("has manual/admin/important source link");
    }
    const updatedMs = row.updated_at ? Date.parse(row.updated_at) : NaN;
    const recentlyUpdated = Number.isFinite(updatedMs) && updatedMs > options.cutoffMs;
    if (recentlyUpdated) {
        blockReasons.push("updated after cleanup cutoff");
    }
    if (row.suspicious_metadata) {
        blockReasons.push("suspicious/manual metadata");
    }
    if (row.terminal_link_count > 0 || row.parent_child_count > 0) {
        const parts: string[] = [];
        if (row.terminal_link_count > 0) parts.push(`terminals=${row.terminal_link_count}`);
        if (row.parent_child_count > 0) parts.push(`child_stops=${row.parent_child_count}`);
        blockReasons.push(`referenced by other relation (${parts.join(", ")})`);
    }

    let category: OrphanBusStopCategory = "safe_candidate";
    if (row.route_stop_refs > 0) category = "still_used_by_route_stops";
    else if (row.used_by_systematic_route) category = "used_by_systematic_route";
    else if (PROTECTED_STOP_REVIEW_STATUSES.has(row.review_status ?? "")) category = "protected";
    else if (row.has_ybs_stop_link && !options.allowYbsSourceStops) category = "ybs_source_link";
    else if (row.has_protected_source_link) category = "protected_source_link";
    else if (recentlyUpdated) category = "recently_updated";
    else if (row.suspicious_metadata) category = "suspicious_metadata";
    else if (row.terminal_link_count > 0 || row.parent_child_count > 0) {
        category = "referenced_by_other_relation";
    }

    const isSafe = blockReasons.length === 0;

    return {
        ...row,
        category,
        is_safe: isSafe,
        block_reasons: blockReasons,
        reason: isSafe ? "safe: no blockers" : blockReasons.join("; "),
    };
}

export async function loadOrphanBusStops(client: pg.Client): Promise<
    Omit<OrphanBusStopRow, "category" | "is_safe" | "block_reasons" | "reason">[]
> {
    const result = await client.query<{
        stop_id: string;
        public_id: string | null;
        name: string | null;
        name_mm: string | null;
        name_en: string | null;
        review_status: string | null;
        confidence_score: number | null;
        is_active: boolean | null;
        updated_at: string | null;
        deleted_at: string | null;
        source_link_count: number;
        source_names: string[] | null;
        has_ybs_stop_link: boolean;
        has_protected_source_link: boolean;
        route_stop_refs: number;
        used_by_systematic_route: boolean;
        terminal_link_count: number;
        parent_child_count: number;
        suspicious_metadata: boolean;
    }>(
        `
        with systematic_routes as (
            select r.id
            from transport.routes r
            where r.mode = 'bus'
              and r.deleted_at is null
              and exists (
                  select 1
                  from transport.source_links sl
                  where sl.entity_type = 'route'
                    and sl.entity_id = r.id
                    and sl.source_name = $1
                    and sl.external_id like 'route:ybs_go:%'
              )
        )
        select
            s.id::text as stop_id,
            s.public_id::text as public_id,
            s.name,
            s.name_mm,
            s.name_en,
            s.review_status,
            s.confidence_score::float8 as confidence_score,
            s.is_active,
            s.updated_at::text as updated_at,
            s.deleted_at::text as deleted_at,
            coalesce(sl.source_link_count, 0)::int as source_link_count,
            sl.source_names as source_names,
            coalesce(sl.has_ybs_stop_link, false) as has_ybs_stop_link,
            coalesce(sl.has_protected_source_link, false) as has_protected_source_link,
            coalesce(rs.route_stop_refs, 0)::int as route_stop_refs,
            coalesce(sys.used_by_systematic_route, false) as used_by_systematic_route,
            coalesce(t.terminal_link_count, 0)::int as terminal_link_count,
            coalesce(p.parent_child_count, 0)::int as parent_child_count,
            (
                s.normalized_data::text ilike '%manual%'
                or s.normalized_data ? 'cleanup_note'
                or s.normalized_data ? 'direction_split'
                or coalesce(s.source_refs::text, '') ilike '%manual%'
            ) as suspicious_metadata
        from transport.stops s
        left join lateral (
            select
                count(*)::int as source_link_count,
                array_agg(distinct l.source_name) filter (where l.source_name is not null) as source_names,
                bool_or(l.source_name = $1 and l.external_id like 'stop:ybs_go:%') as has_ybs_stop_link,
                bool_or(
                    lower(l.source_name) like '%manual%'
                    or lower(l.source_name) like '%admin%'
                    or lower(l.source_name) like '%important%'
                ) as has_protected_source_link
            from transport.source_links l
            where l.entity_type = 'stop'
              and l.entity_id = s.id
        ) sl on true
        left join lateral (
            select count(*)::int as route_stop_refs
            from transport.route_stops rs
            where rs.stop_id = s.id
        ) rs on true
        left join lateral (
            select exists (
                select 1
                from transport.route_stops rs
                inner join transport.route_variants rv on rv.id = rs.route_variant_id
                where rs.stop_id = s.id
                  and rv.route_id in (select id from systematic_routes)
            ) as used_by_systematic_route
        ) sys on true
        left join lateral (
            select count(*)::int as terminal_link_count
            from transport.terminals t
            where t.linked_stop_id = s.id
              and t.deleted_at is null
        ) t on true
        left join lateral (
            select count(*)::int as parent_child_count
            from transport.stops child
            where child.parent_stop_id = s.id
              and child.deleted_at is null
        ) p on true
        where s.mode = 'bus'
          and s.deleted_at is null
          and not exists (
              select 1 from transport.route_stops rs where rs.stop_id = s.id
          )
        order by s.id
        `,
        [YBS_SOURCE_NAME],
    );

    return result.rows.map((row) => ({
        stop_id: Number(row.stop_id),
        public_id: row.public_id,
        name: row.name,
        name_mm: row.name_mm,
        name_en: row.name_en,
        review_status: row.review_status,
        confidence_score: row.confidence_score,
        is_active: row.is_active,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        source_link_count: row.source_link_count,
        source_names: (row.source_names ?? []).filter((name): name is string => Boolean(name)),
        has_ybs_stop_link: row.has_ybs_stop_link,
        has_protected_source_link: row.has_protected_source_link,
        route_stop_refs: row.route_stop_refs,
        used_by_systematic_route: row.used_by_systematic_route,
        terminal_link_count: row.terminal_link_count,
        parent_child_count: row.parent_child_count,
        suspicious_metadata: row.suspicious_metadata,
    }));
}

export async function reverifyOrphanStopsBeforeExecute(
    client: pg.Client,
    stopIds: number[],
    options: OrphanStopClassifyOptions,
): Promise<{
    safe_stop_ids: number[];
    blocked: Array<{ stop_id: number; blockers: string[] }>;
}> {
    if (stopIds.length === 0) {
        return { safe_stop_ids: [], blocked: [] };
    }

    const rows = await loadOrphanBusStops(client);
    const byId = new Map(rows.map((row) => [row.stop_id, row]));
    const safeStopIds: number[] = [];
    const blocked: Array<{ stop_id: number; blockers: string[] }> = [];

    for (const stopId of stopIds) {
        const row = byId.get(stopId);
        if (!row) {
            blocked.push({
                stop_id: stopId,
                blockers: ["stop not found, not bus mode, not orphan, or already soft-deleted"],
            });
            continue;
        }
        const classified = classifyOrphanBusStop(row, options);
        if (classified.is_safe) {
            safeStopIds.push(stopId);
        } else {
            blocked.push({ stop_id: stopId, blockers: classified.block_reasons });
        }
    }

    return { safe_stop_ids: safeStopIds, blocked };
}

export async function executeOrphanStopCleanup(
    client: pg.Client,
    stopIds: number[],
    options: {
        hardDelete?: boolean;
        deleteStopSourceLinks?: boolean;
        deleteStopNames?: boolean;
    },
): Promise<{
    stops_soft_deleted: number;
    stops_hard_deleted: number;
    source_links_deleted: number;
    source_links_preserved: number;
    stop_names_deleted: number;
    stop_names_preserved: number;
}> {
    if (stopIds.length === 0) {
        return {
            stops_soft_deleted: 0,
            stops_hard_deleted: 0,
            source_links_deleted: 0,
            source_links_preserved: 0,
            stop_names_deleted: 0,
            stop_names_preserved: 0,
        };
    }

    const linkCount = await client.query<{ count: string }>(
        `
        select count(*)::text as count
        from transport.source_links
        where entity_type = 'stop' and entity_id = any($1::bigint[])
        `,
        [stopIds],
    );
    const nameCount = await client.query<{ count: string }>(
        `select count(*)::text as count from transport.stop_names where stop_id = any($1::bigint[])`,
        [stopIds],
    );
    const totalSourceLinks = Number(linkCount.rows[0]?.count ?? 0);
    const totalStopNames = Number(nameCount.rows[0]?.count ?? 0);

    await detachVariantStopForeignReferences(client, stopIds, []);

    let sourceLinksDeleted = 0;
    let stopNamesDeleted = 0;

    if (options.deleteStopSourceLinks) {
        const deleted = await client.query(
            `delete from transport.source_links where entity_type = 'stop' and entity_id = any($1::bigint[])`,
            [stopIds],
        );
        sourceLinksDeleted = deleted.rowCount ?? 0;
    }

    if (options.deleteStopNames) {
        const deleted = await client.query(
            `delete from transport.stop_names where stop_id = any($1::bigint[])`,
            [stopIds],
        );
        stopNamesDeleted = deleted.rowCount ?? 0;
    }

    let stopsSoftDeleted = 0;
    let stopsHardDeleted = 0;

    if (options.hardDelete) {
        const deleted = await client.query(
            `delete from transport.stops where id = any($1::bigint[])`,
            [stopIds],
        );
        stopsHardDeleted = deleted.rowCount ?? 0;
    } else {
        const updated = await client.query(
            `
            update transport.stops
            set deleted_at = now(),
                is_active = false,
                review_status = case
                    when review_status in ('reviewed', 'verified', 'manual_protected')
                        then review_status
                    else 'rejected'
                end,
                normalized_data = coalesce(normalized_data, '{}'::jsonb)
                    || jsonb_build_object('cleanup_note', 'orphan_legacy_stop_soft_deleted'),
                updated_at = now()
            where id = any($1::bigint[])
              and deleted_at is null
            `,
            [stopIds],
        );
        stopsSoftDeleted = updated.rowCount ?? 0;
    }

    return {
        stops_soft_deleted: stopsSoftDeleted,
        stops_hard_deleted: stopsHardDeleted,
        source_links_deleted: sourceLinksDeleted,
        source_links_preserved: totalSourceLinks - sourceLinksDeleted,
        stop_names_deleted: stopNamesDeleted,
        stop_names_preserved: totalStopNames - stopNamesDeleted,
    };
}

export function aggregateBlockReasons(
    stops: Array<{ block_reasons: string[] }>,
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const stop of stops) {
        for (const reason of stop.block_reasons) {
            const key = reason.split("=")[0] ?? reason;
            counts[key] = (counts[key] ?? 0) + 1;
        }
    }
    return counts;
}

export function renderWorkflowCommands(reportDir: string): string {
  const rel = reportDir.startsWith(REPO_ROOT)
    ? reportDir.slice(REPO_ROOT.length + 1)
    : reportDir;
  return `## Phase D workflow commands (dry-run first)

### Phase D1 — legacy route trees only (stops kept)

\`\`\`bash
# 1) Report candidates (read-only)
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/report-legacy-cleanup-candidates.ts \\
  --report-dir ${rel}

# 2) Dry-run route tree cleanup
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-legacy-bus-routes.ts \\
  --report-dir ${rel} \\
  --dry-run

# 3) Validate after execute (run after --execute cleanup)
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate-legacy-route-cleanup.ts \\
  --report-dir ${rel}

# After full cleanup, require zero legacy routes:
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/validate-legacy-route-cleanup.ts \\
  --report-dir ${rel} \\
  --expect-zero
\`\`\`

Execute only after reviewing dry-run reports:

\`\`\`bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-legacy-bus-routes.ts \\
  --report-dir ${rel} \\
  --execute \\
  --confirm-legacy-route-cleanup
\`\`\`

### Phase D2 — orphan legacy stops (after D1 validation)

\`\`\`bash
# 1) Report orphan stop candidates (read-only)
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/report-orphan-legacy-stops.ts \\
  --report-dir ${rel}

# 2) Dry-run orphan stop cleanup
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-orphan-legacy-stops.ts \\
  --report-dir ${rel} \\
  --dry-run
\`\`\`

Execute only after D1 validation passes:

\`\`\`bash
npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-orphan-legacy-stops.ts \\
  --report-dir ${rel} \\
  --execute \\
  --confirm-orphan-stop-cleanup
\`\`\`
`;
}

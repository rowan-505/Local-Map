import type { PrismaClient } from "@prisma/client";

import {
    getCachedSearchIndexHealthReport,
    clearSearchIndexHealthCache,
} from "./search-index-health-cache.js";
import {
    deriveSearchIndexFamilySeverity,
    deriveSearchIndexOverallSeverity,
    severityToBinaryHealthStatus,
    type SearchIndexHealthSeverity,
} from "./search-index-health-severity.js";
import { SEARCH_INDEX_RUN_SUCCESSFUL_STATUS_SQL } from "./search-index-run-status.js";

export type SearchIndexHealthRow = {
    entity_family: string;
    search_entity_type: string;
    canonical_count: bigint | number;
    indexed_count: bigint | number;
    missing_count: bigint | number;
    ghost_count: bigint | number;
    stale_count: bigint | number;
    latest_indexed_at: Date | null;
    latest_source_updated_at: Date | null;
};

export type SearchIndexHealthIssueCounts = {
    missing: number;
    ghost: number;
    stale: number;
};

export type SearchIndexFamilyHealth = SearchIndexHealthRow & SearchIndexHealthIssueCounts;

/** Health entity_family → rebuild view key for `search.rebuild_search_documents`. */
export const SEARCH_HEALTH_FAMILY_REBUILD_VIEWS: Readonly<Record<string, string>> = {
    places: "places",
    admin_areas: "admin_areas",
    street_groups: "street_groups",
    addresses: "addresses",
    transport_stops: "bus_stops",
    transport_terminals: "transport_terminals",
    transport_routes: "bus_routes",
    transport_route_variants: "bus_routes",
    buildings: "buildings",
    landuse: "landuse",
    water_lines: "water_lines",
    water_polygons: "water_polygons",
};

export const SEARCH_INDEX_HEALTH_QUERY = `
WITH families AS (
    SELECT *
    FROM (
        VALUES
            ('places', 'place'),
            ('admin_areas', 'admin_area'),
            ('street_groups', 'street_group'),
            ('addresses', 'address'),
            ('transport_stops', 'transport_stop'),
            ('transport_terminals', 'transport_terminal'),
            ('transport_routes', 'transport_route'),
            ('transport_route_variants', 'transport_route_variant'),
            ('buildings', 'building'),
            ('landuse', 'landuse'),
            ('water_lines', 'water_line'),
            ('water_polygons', 'water_polygon')
    ) AS t(entity_family, search_entity_type)
),
canonical AS MATERIALIZED (
    SELECT entity_type, entity_id::bigint AS entity_id, source_updated_at
    FROM search.v_search_places_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_admin_areas_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_street_groups_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_addresses_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_bus_stops_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_bus_routes_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_transport_terminals_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_buildings_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_landuse_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_water_lines_source
    UNION ALL
    SELECT entity_type, entity_id::bigint, source_updated_at
    FROM search.v_search_water_polygons_source
),
indexed AS MATERIALIZED (
    SELECT
        entity_type,
        entity_id::bigint AS entity_id,
        source_updated_at,
        indexed_at
    FROM search.search_documents
    WHERE is_public = true
      AND is_active = true
),
joined AS MATERIALIZED (
    SELECT
        coalesce(c.entity_type, i.entity_type) AS entity_type,
        c.entity_id AS canonical_entity_id,
        i.entity_id AS indexed_entity_id,
        c.source_updated_at AS canonical_source_updated_at,
        i.source_updated_at AS indexed_source_updated_at,
        i.indexed_at
    FROM canonical c
    FULL OUTER JOIN indexed i
        ON i.entity_type = c.entity_type
       AND i.entity_id = c.entity_id
),
per_family AS (
    SELECT
        f.entity_family,
        f.search_entity_type,
        count(j.canonical_entity_id) AS canonical_count,
        count(j.indexed_entity_id) AS indexed_count,
        count(*) FILTER (
            WHERE j.canonical_entity_id IS NOT NULL
              AND j.indexed_entity_id IS NULL
        ) AS missing_count,
        count(*) FILTER (
            WHERE j.indexed_entity_id IS NOT NULL
              AND j.canonical_entity_id IS NULL
        ) AS ghost_count,
        count(*) FILTER (
            WHERE j.canonical_entity_id IS NOT NULL
              AND j.indexed_entity_id IS NOT NULL
              AND (
                  j.indexed_source_updated_at IS NULL
                  OR j.canonical_source_updated_at IS NULL
                  OR j.indexed_source_updated_at < j.canonical_source_updated_at
              )
        ) AS stale_count,
        max(j.indexed_at) AS latest_indexed_at,
        max(j.canonical_source_updated_at) AS latest_source_updated_at
    FROM families f
    LEFT JOIN joined j
        ON j.entity_type = f.search_entity_type
    GROUP BY f.entity_family, f.search_entity_type
)
SELECT
    entity_family,
    search_entity_type,
    canonical_count,
    indexed_count,
    missing_count,
    ghost_count,
    stale_count,
    latest_indexed_at,
    latest_source_updated_at
FROM per_family
ORDER BY entity_family
`;

export function toHealthCount(value: bigint | number): number {
    return typeof value === "bigint" ? Number(value) : value;
}

export function normalizeSearchIndexHealthRow(row: SearchIndexHealthRow): SearchIndexFamilyHealth {
    return {
        ...row,
        missing: toHealthCount(row.missing_count),
        ghost: toHealthCount(row.ghost_count),
        stale: toHealthCount(row.stale_count),
    };
}

export function isSearchIndexFamilyUnhealthy(row: Pick<SearchIndexFamilyHealth, "missing" | "ghost" | "stale">): boolean {
    return row.missing > 0 || row.ghost > 0 || row.stale > 0;
}

export function hasSearchIndexHealthIssues(
    rows: readonly Pick<SearchIndexFamilyHealth, "missing" | "ghost" | "stale">[],
): boolean {
    return rows.some(isSearchIndexFamilyUnhealthy);
}

export function buildRepairedByFamily(
    before: readonly SearchIndexFamilyHealth[],
    after: readonly SearchIndexFamilyHealth[],
): Map<string, boolean> {
    const afterByFamily = new Map(after.map((row) => [row.entity_family, row]));
    const repaired = new Map<string, boolean>();

    for (const row of before) {
        if (!isSearchIndexFamilyUnhealthy(row)) {
            repaired.set(row.entity_family, false);
            continue;
        }
        const next = afterByFamily.get(row.entity_family);
        repaired.set(row.entity_family, next != null && !isSearchIndexFamilyUnhealthy(next));
    }

    return repaired;
}

export const SEARCH_INDEX_HEALTH_FAMILIES = Object.keys(
    SEARCH_HEALTH_FAMILY_REBUILD_VIEWS,
) as (keyof typeof SEARCH_HEALTH_FAMILY_REBUILD_VIEWS)[];

export function isAllowlistedSearchIndexHealthFamily(
    entityFamily: string,
): entityFamily is keyof typeof SEARCH_HEALTH_FAMILY_REBUILD_VIEWS {
    return Object.prototype.hasOwnProperty.call(SEARCH_HEALTH_FAMILY_REBUILD_VIEWS, entityFamily);
}

export function resolveRebuildViewForHealthFamily(entityFamily: string): string | null {
    return SEARCH_HEALTH_FAMILY_REBUILD_VIEWS[entityFamily] ?? null;
}

export function resolveRebuildViewsForHealthFamilies(entityFamilies: Iterable<string>): string[] {
    const views = new Set<string>();
    for (const family of entityFamilies) {
        const view = SEARCH_HEALTH_FAMILY_REBUILD_VIEWS[family];
        if (view) {
            views.add(view);
        }
    }
    return [...views].sort();
}

export async function runSearchIndexHealthCheck(prisma: PrismaClient): Promise<SearchIndexFamilyHealth[]> {
    const rows = await prisma.$queryRawUnsafe<SearchIndexHealthRow[]>(SEARCH_INDEX_HEALTH_QUERY);
    return rows.map(normalizeSearchIndexHealthRow);
}

export function formatSearchHealthTimestamp(value: Date | null): string {
    if (!value) {
        return "-";
    }
    return value.toISOString().replace("T", " ").replace("Z", " UTC");
}

export type SearchIndexHealthStatus = "healthy" | "unhealthy";

export type { SearchIndexHealthSeverity } from "./search-index-health-severity.js";

export type SearchIndexRunRow = {
    id: bigint | number;
    status: string;
    started_at: Date;
    finished_at: Date | null;
    entity_counts: unknown;
};

export type SearchIndexRunSummary = {
    id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    entity_counts: unknown;
};

export type SearchIndexHealthFamilyReport = {
    entity_family: string;
    search_entity_type: string;
    /** Intended searchable rows from source views (same as canonical_count). */
    expected_searchable_count: number;
    canonical_count: number;
    indexed_count: number;
    missing_count: number;
    ghost_count: number;
    stale_count: number;
    latest_indexed_at: string | null;
    latest_source_updated_at: string | null;
    severity: SearchIndexHealthSeverity;
    severity_reasons: string[];
    status: SearchIndexHealthStatus;
};

export type SearchIndexHealthReport = {
    overall_status: SearchIndexHealthStatus;
    overall_severity: SearchIndexHealthSeverity;
    overall_severity_reasons: string[];
    health_query_ok: boolean;
    health_query_error: string | null;
    totals: {
        expected_searchable_count: number;
        canonical_count: number;
        indexed_count: number;
        missing_count: number;
        ghost_count: number;
        stale_count: number;
    };
    families: SearchIndexHealthFamilyReport[];
    last_rebuild_run: SearchIndexRunSummary | null;
    last_successful_run: SearchIndexRunSummary | null;
};

const LATEST_INDEX_RUN_QUERY = `
SELECT id, status, started_at, finished_at, entity_counts
FROM search.search_index_runs
ORDER BY id DESC
LIMIT 1
`;

const LATEST_SUCCESSFUL_INDEX_RUN_QUERY = `
SELECT id, status, started_at, finished_at, entity_counts
FROM search.search_index_runs
WHERE status = ${SEARCH_INDEX_RUN_SUCCESSFUL_STATUS_SQL}
ORDER BY finished_at DESC NULLS LAST, id DESC
LIMIT 1
`;

export function deriveSearchIndexFamilyStatus(
    row: Pick<SearchIndexFamilyHealth, "missing" | "ghost" | "stale">,
): SearchIndexHealthStatus {
    return isSearchIndexFamilyUnhealthy(row) ? "unhealthy" : "healthy";
}

export function deriveSearchIndexOverallStatus(
    rows: readonly Pick<SearchIndexFamilyHealth, "missing" | "ghost" | "stale">[],
): SearchIndexHealthStatus {
    return hasSearchIndexHealthIssues(rows) ? "unhealthy" : "healthy";
}

function serializeIndexRun(row: SearchIndexRunRow | undefined): SearchIndexRunSummary | null {
    if (!row) {
        return null;
    }
    return {
        id: String(toHealthCount(row.id)),
        status: row.status,
        started_at: row.started_at.toISOString(),
        finished_at: row.finished_at?.toISOString() ?? null,
        entity_counts: row.entity_counts,
    };
}

export function buildSearchIndexHealthReport(
    rows: readonly SearchIndexFamilyHealth[],
    runs: {
        latest: SearchIndexRunRow | null;
        lastSuccessful: SearchIndexRunRow | null;
    },
    options: {
        health_query_ok?: boolean;
        health_query_error?: string | null;
        now?: Date;
    } = {},
): SearchIndexHealthReport {
    const now = options.now ?? new Date();
    const healthQueryOk = options.health_query_ok ?? true;
    const healthQueryError = options.health_query_error ?? null;

    const families: SearchIndexHealthFamilyReport[] = rows.map((row) => {
        const expectedSearchableCount = toHealthCount(row.canonical_count);
        const familySeverity = deriveSearchIndexFamilySeverity(
            {
                missing_count: row.missing,
                ghost_count: row.ghost,
                stale_count: row.stale,
                expected_searchable_count: expectedSearchableCount,
                latest_indexed_at: row.latest_indexed_at,
            },
            now,
        );

        return {
            entity_family: row.entity_family,
            search_entity_type: row.search_entity_type,
            expected_searchable_count: expectedSearchableCount,
            canonical_count: expectedSearchableCount,
            indexed_count: toHealthCount(row.indexed_count),
            missing_count: row.missing,
            ghost_count: row.ghost,
            stale_count: row.stale,
            latest_indexed_at: row.latest_indexed_at?.toISOString() ?? null,
            latest_source_updated_at: row.latest_source_updated_at?.toISOString() ?? null,
            severity: familySeverity.severity,
            severity_reasons: familySeverity.reasons,
            status: severityToBinaryHealthStatus(familySeverity.severity),
        };
    });

    const totals = families.reduce(
        (acc, row) => ({
            expected_searchable_count: acc.expected_searchable_count + row.expected_searchable_count,
            canonical_count: acc.canonical_count + row.canonical_count,
            indexed_count: acc.indexed_count + row.indexed_count,
            missing_count: acc.missing_count + row.missing_count,
            ghost_count: acc.ghost_count + row.ghost_count,
            stale_count: acc.stale_count + row.stale_count,
        }),
        {
            expected_searchable_count: 0,
            canonical_count: 0,
            indexed_count: 0,
            missing_count: 0,
            ghost_count: 0,
            stale_count: 0,
        },
    );

    const overallSeverity = deriveSearchIndexOverallSeverity(
        {
            family_severities: families.map((family) => family.severity),
            last_rebuild_status: runs.latest?.status ?? null,
            last_successful_rebuild_finished_at: runs.lastSuccessful?.finished_at ?? null,
            health_query_ok: healthQueryOk,
        },
        now,
    );

    return {
        overall_status: severityToBinaryHealthStatus(overallSeverity.severity),
        overall_severity: overallSeverity.severity,
        overall_severity_reasons: healthQueryOk
            ? overallSeverity.reasons
            : ["health query failed"],
        health_query_ok: healthQueryOk,
        health_query_error: healthQueryError,
        totals,
        families,
        last_rebuild_run: serializeIndexRun(runs.latest ?? undefined),
        last_successful_run: serializeIndexRun(runs.lastSuccessful ?? undefined),
    };
}

export function buildFailedSearchIndexHealthReport(
    error: unknown,
    now: Date = new Date(),
): SearchIndexHealthReport {
    const message = error instanceof Error ? error.message : "search index health query failed";
    return buildSearchIndexHealthReport([], { latest: null, lastSuccessful: null }, {
        health_query_ok: false,
        health_query_error: message,
        now,
    });
}

export async function fetchSearchIndexRunMetadata(
    prisma: PrismaClient,
): Promise<{ latest: SearchIndexRunRow | null; lastSuccessful: SearchIndexRunRow | null }> {
    const [latestRows, successRows] = await Promise.all([
        prisma.$queryRawUnsafe<SearchIndexRunRow[]>(LATEST_INDEX_RUN_QUERY),
        prisma.$queryRawUnsafe<SearchIndexRunRow[]>(LATEST_SUCCESSFUL_INDEX_RUN_QUERY),
    ]);
    return {
        latest: latestRows[0] ?? null,
        lastSuccessful: successRows[0] ?? null,
    };
}

export async function loadSearchIndexHealthReportUncached(
    prisma: PrismaClient,
): Promise<SearchIndexHealthReport> {
    try {
        const [rows, runs] = await Promise.all([
            runSearchIndexHealthCheck(prisma),
            fetchSearchIndexRunMetadata(prisma),
        ]);
        return buildSearchIndexHealthReport(rows, runs);
    } catch (error) {
        return buildFailedSearchIndexHealthReport(error);
    }
}

export type SearchIndexHealthReportOptions = {
    /** Bypass the short-lived in-process cache. */
    refresh?: boolean;
};

export async function getSearchIndexHealthReport(
    prisma: PrismaClient,
    options: SearchIndexHealthReportOptions = {},
): Promise<SearchIndexHealthReport> {
    return getCachedSearchIndexHealthReport(
        () => loadSearchIndexHealthReportUncached(prisma),
        { refresh: options.refresh },
    );
}

export type SearchIndexHealthSeveritySummary = Pick<
    SearchIndexHealthReport,
    "overall_severity" | "overall_status" | "health_query_ok"
>;

/** Lightweight overview helper that reuses the cached full health report. */
export async function getSearchIndexHealthSeveritySummary(
    prisma: PrismaClient,
): Promise<SearchIndexHealthSeveritySummary> {
    const report = await getSearchIndexHealthReport(prisma);
    return {
        overall_severity: report.overall_severity,
        overall_status: report.overall_status,
        health_query_ok: report.health_query_ok,
    };
}

export { clearSearchIndexHealthCache };

export function printSearchIndexHealthTable(rows: readonly SearchIndexFamilyHealth[]): void {
    const headers = [
        "entity_family",
        "search_entity_type",
        "canonical",
        "indexed",
        "missing",
        "ghost",
        "stale",
        "latest_indexed_at",
        "latest_source_updated_at",
    ];

    const body = rows.map((row) => [
        row.entity_family,
        row.search_entity_type,
        String(toHealthCount(row.canonical_count)),
        String(toHealthCount(row.indexed_count)),
        String(row.missing),
        String(row.ghost),
        String(row.stale),
        formatSearchHealthTimestamp(row.latest_indexed_at),
        formatSearchHealthTimestamp(row.latest_source_updated_at),
    ]);

    const widths = headers.map((header, index) =>
        Math.max(header.length, ...body.map((line) => line[index]?.length ?? 0)),
    );

    const formatLine = (cells: string[]) =>
        cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");

    console.log(formatLine(headers));
    console.log(widths.map((width) => "-".repeat(width)).join("  "));
    for (const line of body) {
        console.log(formatLine(line));
    }
}

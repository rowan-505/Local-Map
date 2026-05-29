import { Prisma, type PrismaClient } from "@prisma/client";

import {
    getImportTransportFamilyConfig,
    importTransportOrderBySql,
    qualifiedImportTransportTable,
    type ImportTransportFamily,
} from "./import-transport.config.js";
import {
    ImportTransportBatchNotFoundError,
    ImportTransportInvalidScopeError,
} from "./import-transport.errors.js";
import { hidePromotedCandidatesSql } from "./import-transport-candidate-filters.js";
import type {
    ImportTransportBatchListItem,
    ImportTransportCandidateRowDb,
    ImportTransportListFilters,
    ImportTransportListQuery,
    ImportTransportScopeQuery,
    ImportTransportScopeResolved,
    ImportTransportScopeSelectedBy,
    ImportTransportSummaryFamilyMetrics,
} from "./import-transport.types.js";

type ImportBatchRowDb = {
    id: bigint;
    public_id: string;
    batch_name: string;
    source_snapshot_version: string | null;
    import_status: string;
    validation_status: string;
    source_dataset_id: bigint;
    imported_at: Date | null;
    created_at: Date;
    updated_at: Date;
};

type TableColumnCache = Map<string, Set<string>>;

function cacheKey(schema: string, table: string): string {
    return `${schema}.${table}`;
}

function optionalTextFilter(
    alias: string,
    column: string,
    value: string | undefined,
    cols: Set<string>
): Prisma.Sql | null {
    if (!value?.trim() || !cols.has(column)) {
        return null;
    }
    return Prisma.sql`${Prisma.raw(`${alias}.${column}`)} = ${value.trim()}`;
}

function buildSearchFilter(
    alias: string,
    columns: readonly string[],
    q: string | undefined,
    cols: Set<string>
): Prisma.Sql | null {
    const term = q?.trim();
    if (!term) {
        return null;
    }
    const pattern = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
    const parts: Prisma.Sql[] = [];
    for (const column of columns) {
        if (!cols.has(column)) {
            continue;
        }
        parts.push(Prisma.sql`${Prisma.raw(`${alias}.${column}`)}::text ILIKE ${pattern}`);
    }
    if (parts.length === 0) {
        return null;
    }
    return Prisma.join(parts, " OR ");
}

function reviewStatusSelect(alias: string, cols: Set<string>): string {
    if (cols.has("review_status")) {
        return `COALESCE(NULLIF(BTRIM(${alias}.review_status), ''), NULLIF(BTRIM(${alias}.match_status), ''), 'pending')`;
    }
    return `COALESCE(NULLIF(BTRIM(${alias}.match_status), ''), 'pending')`;
}

function externalIdSelect(family: ImportTransportFamily, alias: string, cols: Set<string>): string {
    const cfg = getImportTransportFamilyConfig(family);
    if (cols.has("external_id")) {
        return cfg.externalIdExpression;
    }
    switch (family) {
        case "routes":
            return `${alias}.source_route_id`;
        case "stops":
            return `${alias}.source_stop_id`;
        case "variants":
            return `${alias}.source_variant_id`;
        case "route_stops":
            return `COALESCE(NULLIF(BTRIM(${alias}.source_route_stop_id), ''), ${alias}.source_variant_id || ':' || ${alias}.source_stop_id)`;
        default:
            return "NULL";
    }
}

function nullableColumn(alias: string, column: string, cols: Set<string>): string {
    return cols.has(column) ? `${alias}.${column}` : "NULL";
}

function buildFromClause(family: ImportTransportFamily): string {
    switch (family) {
        case "routes":
            return `import_transport.raw_routes AS t
                LEFT JOIN import_transport.raw_operators AS o
                    ON o.id = t.raw_operator_id AND o.import_batch_id = t.import_batch_id`;
        case "variants":
            return `import_transport.raw_route_variants AS t
                LEFT JOIN import_transport.raw_routes AS r
                    ON r.id = t.raw_route_id AND r.import_batch_id = t.import_batch_id`;
        case "route_stops":
            return `import_transport.raw_route_stops AS t
                LEFT JOIN import_transport.raw_route_variants AS v
                    ON v.id = t.raw_route_variant_id AND v.import_batch_id = t.import_batch_id
                LEFT JOIN import_transport.raw_routes AS r
                    ON r.id = v.raw_route_id AND r.import_batch_id = t.import_batch_id
                LEFT JOIN import_transport.raw_stops AS s
                    ON s.id = t.raw_stop_id AND s.import_batch_id = t.import_batch_id`;
        case "stops":
        default:
            return `import_transport.raw_stops AS t`;
    }
}

function buildFamilySearchFilter(
    family: ImportTransportFamily,
    alias: string,
    columns: readonly string[],
    q: string | undefined,
    cols: Set<string>
): Prisma.Sql | null {
    const term = q?.trim();
    if (!term) {
        return null;
    }
    const pattern = `%${term.replace(/[%_\\]/g, "\\$&")}%`;
    const parts: Prisma.Sql[] = [];

    if (family === "route_stops") {
        parts.push(
            Prisma.sql`s.stop_name ILIKE ${pattern}`,
            Prisma.sql`s.stop_code ILIKE ${pattern}`,
            Prisma.sql`v.variant_code ILIKE ${pattern}`,
            Prisma.sql`r.route_code ILIKE ${pattern}`,
            Prisma.sql`t.source_stop_id ILIKE ${pattern}`,
            Prisma.sql`t.source_variant_id ILIKE ${pattern}`
        );
        return Prisma.join(parts, " OR ");
    }

    if (family === "variants") {
        parts.push(Prisma.sql`r.route_code ILIKE ${pattern}`);
    }

    const base = buildSearchFilter(alias, columns, q, cols);
    if (base && parts.length > 0) {
        return Prisma.sql`(${base} OR ${Prisma.join(parts, " OR ")})`;
    }
    return base ?? (parts.length > 0 ? Prisma.join(parts, " OR ") : null);
}

export class ImportTransportRepository {
    private readonly columnCache: TableColumnCache = new Map();

    constructor(private readonly prisma: PrismaClient) {}

    async tableExists(qualifiedName: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`
            SELECT to_regclass(${qualifiedName}) IS NOT NULL AS ok
        `;
        return rows[0]?.ok === true;
    }

    async getTableColumns(schema: string, table: string): Promise<Set<string>> {
        const key = cacheKey(schema, table);
        const cached = this.columnCache.get(key);
        if (cached) {
            return cached;
        }
        const rows = await this.prisma.$queryRaw<{ column_name: string }[]>`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = ${schema}
              AND table_name = ${table}
        `;
        const set = new Set(rows.map((r) => r.column_name));
        this.columnCache.set(key, set);
        return set;
    }

    /**
     * Resolves import batch scope for read paths. Returns null when the schema or batch row is missing
     * so list/summary endpoints can return empty payloads instead of 404.
     */
    async tryResolveScope(query: ImportTransportScopeQuery): Promise<ImportTransportScopeResolved | null> {
        if (!(await this.tableExists("import_transport.import_batches"))) {
            return null;
        }

        if (query.import_batch_id != null) {
            const rows = await this.prisma.$queryRaw<
                Pick<
                    ImportBatchRowDb,
                    "id" | "batch_name" | "source_snapshot_version" | "import_status" | "validation_status"
                >[]
            >`
                SELECT id, batch_name, source_snapshot_version, import_status, validation_status
                FROM import_transport.import_batches
                WHERE id = ${query.import_batch_id}
                LIMIT 1
            `;
            const row = rows[0];
            if (!row) {
                return null;
            }
            return {
                importBatchId: row.id,
                sourceSnapshotVersion: row.source_snapshot_version,
                batchName: row.batch_name,
                importStatus: row.import_status,
                validationStatus: row.validation_status,
                selectedBy: "import_batch_id",
            };
        }

        const snapshot = query.source_snapshot_version?.trim();
        if (!snapshot) {
            throw new ImportTransportInvalidScopeError(
                "Provide exactly one of import_batch_id or source_snapshot_version"
            );
        }

        const rows = await this.prisma.$queryRaw<
            Pick<
                ImportBatchRowDb,
                "id" | "batch_name" | "source_snapshot_version" | "import_status" | "validation_status"
            >[]
        >`
            SELECT id, batch_name, source_snapshot_version, import_status, validation_status
            FROM import_transport.import_batches
            WHERE source_snapshot_version = ${snapshot}
              AND import_status IS DISTINCT FROM 'archived'
            ORDER BY created_at DESC, id DESC
        `;

        if (rows.length === 0) {
            return null;
        }

        const selectedBy: ImportTransportScopeSelectedBy =
            rows.length === 1 ? "source_snapshot_version_unique" : "source_snapshot_version_latest";
        const row = query.latest === false && rows.length > 1 ? rows[rows.length - 1]! : rows[0]!;

        return {
            importBatchId: row.id,
            sourceSnapshotVersion: row.source_snapshot_version,
            batchName: row.batch_name,
            importStatus: row.import_status,
            validationStatus: row.validation_status,
            selectedBy,
        };
    }

    async resolveScope(query: ImportTransportScopeQuery): Promise<ImportTransportScopeResolved> {
        const scope = await this.tryResolveScope(query);
        if (scope) {
            return scope;
        }

        if (!(await this.tableExists("import_transport.import_batches"))) {
            throw new ImportTransportBatchNotFoundError(
                query.import_batch_id?.toString() ?? query.source_snapshot_version ?? "unknown"
            );
        }

        throw new ImportTransportBatchNotFoundError(
            query.import_batch_id?.toString() ?? query.source_snapshot_version ?? "unknown"
        );
    }

    async listBatches(input: {
        limit: number;
        offset: number;
        import_status?: string;
        validation_status?: string;
        source_snapshot_version?: string;
    }): Promise<{ items: ImportTransportBatchListItem[]; total: number }> {
        if (!(await this.tableExists("import_transport.import_batches"))) {
            return { items: [], total: 0 };
        }

        const filters: Prisma.Sql[] = [];
        if (input.import_status) {
            filters.push(Prisma.sql`import_status = ${input.import_status}`);
        }
        if (input.validation_status) {
            filters.push(Prisma.sql`validation_status = ${input.validation_status}`);
        }
        if (input.source_snapshot_version) {
            filters.push(Prisma.sql`source_snapshot_version = ${input.source_snapshot_version}`);
        }
        const where =
            filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;

        const totalRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM import_transport.import_batches
            ${where}
        `;

        const rows = await this.prisma.$queryRaw<ImportBatchRowDb[]>`
            SELECT
                id,
                public_id::text AS public_id,
                batch_name,
                source_snapshot_version,
                import_status,
                validation_status,
                source_dataset_id,
                imported_at,
                created_at,
                updated_at
            FROM import_transport.import_batches
            ${where}
            ORDER BY created_at DESC, id DESC
            LIMIT ${input.limit} OFFSET ${input.offset}
        `;

        return {
            total: Number(totalRows[0]?.count ?? 0n),
            items: rows.map((row) => ({
                id: row.id.toString(),
                public_id: row.public_id,
                batch_name: row.batch_name,
                source_snapshot_version: row.source_snapshot_version,
                import_status: row.import_status,
                validation_status: row.validation_status,
                source_dataset_id: row.source_dataset_id.toString(),
                imported_at: row.imported_at?.toISOString() ?? null,
                created_at: row.created_at.toISOString(),
                updated_at: row.updated_at.toISOString(),
            })),
        };
    }

    async fetchValidationIssueCounts(
        importBatchId: bigint
    ): Promise<{ blocked_count: number; warning_count: number }> {
        if (!(await this.tableExists("import_transport.validation_issues"))) {
            return { blocked_count: 0, warning_count: 0 };
        }

        const rows = await this.prisma.$queryRaw<
            [{ blocked_count: bigint; warning_count: bigint }]
        >`
            SELECT
                count(*) FILTER (
                    WHERE severity IN ('error', 'critical')
                      AND issue_status IS DISTINCT FROM 'resolved'
                )::bigint AS blocked_count,
                count(*) FILTER (
                    WHERE severity = 'warning'
                      AND issue_status IS DISTINCT FROM 'resolved'
                )::bigint AS warning_count
            FROM import_transport.validation_issues
            WHERE import_batch_id = ${importBatchId}
        `;

        const row = rows[0];
        return {
            blocked_count: Number(row?.blocked_count ?? 0n),
            warning_count: Number(row?.warning_count ?? 0n),
        };
    }

    async fetchFamilySummaryMetrics(
        family: ImportTransportFamily,
        importBatchId: bigint
    ): Promise<ImportTransportSummaryFamilyMetrics> {
        const cfg = getImportTransportFamilyConfig(family);
        const qualified = qualifiedImportTransportTable(family);
        if (!(await this.tableExists(qualified))) {
            return { entity_family: family, total: 0, pending: 0, approved: 0, promoted: 0 };
        }

        const cols = await this.getTableColumns(cfg.schema, cfg.tableName);
        const alias = cfg.alias;
        const reviewStatusExpr = reviewStatusSelect(alias, cols);

        const rows = await this.prisma.$queryRaw<
            [{ total: bigint; pending: bigint; approved: bigint; promoted: bigint }]
        >(
            Prisma.sql`
                SELECT
                    count(*)::bigint AS total,
                    count(*) FILTER (
                        WHERE ${Prisma.raw(reviewStatusExpr)} IN ('pending', 'needs_review', 'needs_more_review')
                    )::bigint AS pending,
                    count(*) FILTER (
                        WHERE ${Prisma.raw(reviewStatusExpr)} = 'approved'
                    )::bigint AS approved,
                    count(*) FILTER (
                        WHERE ${Prisma.raw(reviewStatusExpr)} = 'promoted'
                    )::bigint AS promoted
                FROM ${Prisma.raw(qualified)} AS ${Prisma.raw(alias)}
                WHERE ${Prisma.raw(`${alias}.import_batch_id`)} = ${importBatchId}
            `
        );

        const row = rows[0];
        return {
            entity_family: family,
            total: Number(row?.total ?? 0n),
            pending: Number(row?.pending ?? 0n),
            approved: Number(row?.approved ?? 0n),
            promoted: Number(row?.promoted ?? 0n),
        };
    }

    private async buildWhereClause(
        family: ImportTransportFamily,
        importBatchId: bigint,
        filters: ImportTransportListQuery
    ): Promise<{ where: Prisma.Sql; cols: Set<string>; alias: string }> {
        const cfg = getImportTransportFamilyConfig(family);
        const cols = await this.getTableColumns(cfg.schema, cfg.tableName);
        const alias = cfg.alias;
        const parts: Prisma.Sql[] = [
            Prisma.sql`${Prisma.raw(`${alias}.import_batch_id`)} = ${importBatchId}`,
        ];

        const reviewStatus = optionalTextFilter(alias, "review_status", filters.review_status, cols);
        if (reviewStatus) {
            parts.push(reviewStatus);
        } else if (filters.review_status && cols.has("match_status")) {
            parts.push(
                Prisma.sql`${Prisma.raw(`${alias}.match_status`)} = ${filters.review_status}`
            );
        }

        for (const [column, value] of [
            ["review_decision", filters.review_decision],
            ["promotion_status", filters.promotion_status],
            ["validation_status", filters.validation_status],
        ] as const) {
            const clause = optionalTextFilter(alias, column, value, cols);
            if (clause) {
                parts.push(clause);
            }
        }

        const hidePromoted = hidePromotedCandidatesSql(
            alias,
            cols,
            filters.include_promoted,
            filters.promotion_status
        );
        if (hidePromoted) {
            parts.push(hidePromoted);
        }

        const modeType = filters.mode_type?.trim();
        if (modeType) {
            if (family === "routes" && cols.has("transport_mode")) {
                parts.push(Prisma.sql`${Prisma.raw(`${alias}.transport_mode`)} = ${modeType}`);
            } else if (family === "variants" || family === "route_stops") {
                parts.push(Prisma.sql`r.transport_mode = ${modeType}`);
            }
        }

        const search = buildFamilySearchFilter(family, alias, cfg.searchColumns, filters.q, cols);
        if (search) {
            parts.push(Prisma.sql`(${search})`);
        }

        return {
            where: Prisma.join(parts, " AND "),
            cols,
            alias,
        };
    }

    private buildSelectClause(
        family: ImportTransportFamily,
        cols: Set<string>,
        alias: string,
        includeGeometry: boolean
    ): string {
        const cfg = getImportTransportFamilyConfig(family);
        const geometrySql =
            includeGeometry && cfg.hasGeometry && cols.has("geom")
                ? `, ST_AsGeoJSON(${alias}.geom)::json AS geometry`
                : "";

        const familyExtras: Record<ImportTransportFamily, string> = {
            routes: [
                cols.has("route_code") ? `${alias}.route_code` : "NULL AS route_code",
                cols.has("public_name") ? `${alias}.public_name` : "NULL AS public_name",
                cols.has("transport_mode") ? `${alias}.transport_mode AS mode_type` : "NULL AS mode_type",
                "o.operator_name AS operator",
            ].join(",\n"),
            stops: [
                cols.has("stop_code") ? `${alias}.stop_code` : "NULL AS stop_code",
                `COALESCE(${alias}.stop_name, ${alias}.stop_name_local) AS name`,
                cols.has("admin_area_code") ? `${alias}.admin_area_code AS admin_area` : "NULL AS admin_area",
                "NULL AS mode_type",
            ].join(",\n"),
            variants: [
                "r.route_code",
                cols.has("variant_code") ? `${alias}.variant_code` : "NULL AS variant_code",
                cols.has("direction_name") ? `${alias}.direction_name` : "NULL AS direction_name",
                cols.has("origin_name") ? `${alias}.origin_name` : "NULL AS origin_name",
                cols.has("destination_name") ? `${alias}.destination_name` : "NULL AS destination_name",
                `CASE WHEN ${alias}.geom IS NOT NULL THEN 'present' ELSE 'missing' END AS geometry_status`,
            ].join(",\n"),
            route_stops: [
                "r.route_code",
                "v.variant_code",
                `COALESCE(s.stop_name, s.stop_name_local) AS stop_name`,
                cols.has("stop_sequence") ? `${alias}.stop_sequence` : "NULL AS stop_sequence",
            ].join(",\n"),
        };

        return `
            ${alias}.id,
            ${alias}.import_batch_id,
            ${externalIdSelect(family, alias, cols)} AS external_id,
            ${alias}.match_status,
            ${alias}.validation_status,
            ${reviewStatusSelect(alias, cols)} AS review_status,
            ${nullableColumn(alias, "review_decision", cols)} AS review_decision,
            ${nullableColumn(alias, "promotion_status", cols)} AS promotion_status,
            ${nullableColumn(alias, "review_note", cols)} AS review_note,
            ${alias}.confidence_score,
            ${cols.has("normalized_data") ? `${alias}.normalized_data` : "'{}'::jsonb AS normalized_data"},
            ${cols.has("source_refs") ? `${alias}.source_refs` : "'{}'::jsonb AS source_refs"},
            ${alias}.created_at,
            ${alias}.updated_at,
            ${familyExtras[family]}
            ${geometrySql}
        `;
    }

    async countCandidates(
        family: ImportTransportFamily,
        importBatchId: bigint,
        filters: ImportTransportListQuery
    ): Promise<number> {
        const qualified = qualifiedImportTransportTable(family);
        if (!(await this.tableExists(qualified))) {
            return 0;
        }
        const { where } = await this.buildWhereClause(family, importBatchId, filters);
        const fromClause = buildFromClause(family);
        const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
            SELECT count(*)::bigint AS count
            FROM ${Prisma.raw(fromClause)}
            WHERE ${where}
        `;
        return Number(rows[0]?.count ?? 0n);
    }

    async listCandidates(
        family: ImportTransportFamily,
        scope: ImportTransportScopeResolved,
        query: ImportTransportListQuery
    ): Promise<{ rows: ImportTransportCandidateRowDb[]; hasMore: boolean }> {
        const qualified = qualifiedImportTransportTable(family);
        if (!(await this.tableExists(qualified))) {
            return { rows: [], hasMore: false };
        }

        const limit = query.limit ?? 50;
        const offset = query.offset ?? 0;
        const fetchLimit = limit + 1;
        const { where, cols, alias } = await this.buildWhereClause(
            family,
            scope.importBatchId,
            query
        );
        const select = this.buildSelectClause(family, cols, alias, query.include_geometry === true);
        const orderBy = importTransportOrderBySql(family, query.sort ?? "updated_at_desc");
        const fromClause = buildFromClause(family);

        const rows = await this.prisma.$queryRaw<ImportTransportCandidateRowDb[]>(
            Prisma.sql`
                SELECT ${Prisma.raw(select)}
                FROM ${Prisma.raw(fromClause)}
                WHERE ${where}
                ORDER BY ${Prisma.raw(orderBy)}
                LIMIT ${fetchLimit} OFFSET ${offset}
            `
        );

        const hasMore = rows.length > limit;
        return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
    }

    async getCandidateById(
        family: ImportTransportFamily,
        scope: ImportTransportScopeResolved,
        id: bigint,
        includeGeometry: boolean
    ): Promise<ImportTransportCandidateRowDb | null> {
        const qualified = qualifiedImportTransportTable(family);
        if (!(await this.tableExists(qualified))) {
            return null;
        }

        const cfg = getImportTransportFamilyConfig(family);
        const cols = await this.getTableColumns(cfg.schema, cfg.tableName);
        const alias = cfg.alias;
        const select = this.buildSelectClause(family, cols, alias, includeGeometry);
        const fromClause = buildFromClause(family);

        const rows = await this.prisma.$queryRaw<ImportTransportCandidateRowDb[]>(
            Prisma.sql`
                SELECT ${Prisma.raw(select)}
                FROM ${Prisma.raw(fromClause)}
                WHERE ${Prisma.raw(`${alias}.import_batch_id`)} = ${scope.importBatchId}
                  AND ${Prisma.raw(`${alias}.id`)} = ${id}
                LIMIT 1
            `
        );
        return rows[0] ?? null;
    }
}

/**
 * Tooling helper: rebuild unified search families via direct Postgres.
 * Uses the same `search.rebuild_search_documents` function as apps/api.
 */

import pg from "pg";

export type PgSearchFamilyRebuildOutcome = {
    views: string[];
    duration_ms: number;
    run_id: number | null;
    status: string;
    entity_counts: Record<string, unknown>;
    rows_indexed: number;
    success: boolean;
};

function summarizeIndexedRows(entityCounts: Record<string, unknown>): number {
    let total = 0;
    for (const value of Object.values(entityCounts)) {
        if (typeof value === "number" && Number.isFinite(value)) {
            total += value;
            continue;
        }
        if (typeof value === "bigint") {
            total += Number(value);
            continue;
        }
        if (value && typeof value === "object") {
            const row = value as Record<string, unknown>;
            const count = row.count ?? row.rows ?? row.indexed;
            if (typeof count === "number" && Number.isFinite(count)) {
                total += count;
            } else if (typeof count === "bigint") {
                total += Number(count);
            }
        }
    }
    return total;
}

function isRebuildStatusSuccessful(status: string): boolean {
    const normalized = status.trim().toLowerCase();
    return !normalized.includes("error") && !normalized.includes("fail");
}

export async function rebuildSearchFamiliesPg(
    databaseUrl: string,
    views: readonly string[],
    log: (message: string) => void = console.log,
): Promise<PgSearchFamilyRebuildOutcome | null> {
    const safeViews = [...new Set(views.map((view) => view.trim().toLowerCase()).filter(Boolean))].sort();
    if (safeViews.length === 0) {
        return null;
    }

    const client = new pg.Client({ connectionString: databaseUrl });
    const startedAt = Date.now();
    log(`[search-family-rebuild] started views=${safeViews.join(",")}`);

    try {
        await client.connect();
        await client.query("SET statement_timeout = 0");
        const result = await client.query<{ rebuild_search_documents: Record<string, unknown> }>(
            "SELECT search.rebuild_search_documents($1::text[]) AS rebuild_search_documents",
            [safeViews],
        );

        const payload = result.rows[0]?.rebuild_search_documents ?? {};
        const duration_ms = Date.now() - startedAt;
        const status = typeof payload.status === "string" ? payload.status : "unknown";
        const entity_counts =
            payload.entity_counts && typeof payload.entity_counts === "object"
                ? (payload.entity_counts as Record<string, unknown>)
                : {};
        const run_id =
            typeof payload.run_id === "number"
                ? payload.run_id
                : typeof payload.run_id === "string"
                  ? Number(payload.run_id)
                  : null;
        const rows_indexed = summarizeIndexedRows(entity_counts);
        const success = isRebuildStatusSuccessful(status);

        log(
            `[search-family-rebuild] finished views=${safeViews.join(",")} ` +
                `duration_ms=${duration_ms} run_id=${run_id ?? "?"} status=${status} ` +
                `rows_indexed=${rows_indexed} success=${success}`,
        );

        return {
            views: safeViews,
            duration_ms,
            run_id,
            status,
            entity_counts,
            rows_indexed,
            success,
        };
    } catch (err) {
        const duration_ms = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : String(err);
        log(
            `[search-family-rebuild] failed views=${safeViews.join(",")} ` +
                `duration_ms=${duration_ms} success=false error=${message}`,
        );
        return {
            views: safeViews,
            duration_ms,
            run_id: null,
            status: "error",
            entity_counts: {},
            rows_indexed: 0,
            success: false,
        };
    } finally {
        await client.end().catch(() => undefined);
    }
}

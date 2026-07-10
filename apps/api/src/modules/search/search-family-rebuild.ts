import type { Prisma, PrismaClient } from "@prisma/client";

/** Deprecated per-segment street views (removed in migration 121). */
export const DEPRECATED_SEARCH_REBUILD_VIEWS = new Set(["streets", "street"]);

export type SearchFamilyRebuildResult = {
    run_id: number;
    status: string;
    requested_views: string[];
    entity_counts: Record<string, unknown>;
};

export type SearchFamilyRebuildLog = {
    info?: (obj: Record<string, unknown>, msg: string) => void;
    warn?: (obj: Record<string, unknown>, msg: string) => void;
    error?: (obj: Record<string, unknown>, msg: string) => void;
};

export type SearchFamilyRebuildOutcome = {
    views: string[];
    duration_ms: number;
    run_id: number | null;
    status: string;
    entity_counts: Record<string, unknown>;
    success: boolean;
};

/**
 * Strip deprecated per-segment street views. Returns the safe list.
 * Throws if, after stripping, nothing is left to rebuild.
 */
export function guardDeprecatedSearchRebuildViews(views: readonly string[]): string[] {
    const requestedDeprecated = views.filter((view) => DEPRECATED_SEARCH_REBUILD_VIEWS.has(view));
    if (requestedDeprecated.length > 0) {
        console.warn(
            "[search-family-rebuild] deprecated per-segment street rebuild " +
                `(${requestedDeprecated.join(", ")}) is ignored; use street_groups instead.`,
        );
    }

    const safe = views
        .map((view) => view.trim().toLowerCase())
        .filter((view) => view.length > 0 && !DEPRECATED_SEARCH_REBUILD_VIEWS.has(view));

    if (safe.length === 0) {
        throw new Error(
            "No valid search views to rebuild after removing deprecated per-segment streets.",
        );
    }

    return [...new Set(safe)].sort();
}

function isRebuildStatusSuccessful(status: string): boolean {
    const normalized = status.trim().toLowerCase();
    return !normalized.includes("error") && !normalized.includes("fail");
}

export function summarizeSearchFamilyRebuildRows(entityCounts: Record<string, unknown>): number {
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

export type SearchFamilyRebuildDbClient = PrismaClient | Prisma.TransactionClient;

function isPrismaRootClient(client: SearchFamilyRebuildDbClient): client is PrismaClient {
    return typeof (client as PrismaClient).$transaction === "function";
}

async function executeSearchFamilyRebuild(
    client: SearchFamilyRebuildDbClient,
    safeViews: string[],
): Promise<Array<{ rebuild_search_documents: SearchFamilyRebuildResult }>> {
    await client.$executeRawUnsafe("SET LOCAL statement_timeout = 0");
    return client.$queryRawUnsafe<Array<{ rebuild_search_documents: SearchFamilyRebuildResult }>>(
        "SELECT search.rebuild_search_documents($1::text[]) AS rebuild_search_documents",
        safeViews,
    );
}

/**
 * Rebuild one or more unified search source families in a single
 * `search.rebuild_search_documents` call.
 */
export async function rebuildSearchFamilies(
    prisma: SearchFamilyRebuildDbClient,
    views: readonly string[],
    log?: SearchFamilyRebuildLog,
): Promise<SearchFamilyRebuildOutcome | null> {
    if (views.length === 0) {
        return null;
    }

    const safeViews = guardDeprecatedSearchRebuildViews(views);
    const startedAt = Date.now();
    log?.info?.({ views: safeViews }, "search family rebuild started");

    try {
        const rows = isPrismaRootClient(prisma)
            ? await prisma.$transaction(
                  async (tx) => executeSearchFamilyRebuild(tx, safeViews),
                  { timeout: 30 * 60 * 1000, maxWait: 60 * 1000 },
              )
            : await executeSearchFamilyRebuild(prisma, safeViews);

        const result = rows[0]?.rebuild_search_documents;
        const duration_ms = Date.now() - startedAt;
        const status = result?.status ?? "unknown";
        const entity_counts = result?.entity_counts ?? {};
        const success = isRebuildStatusSuccessful(status);
        const rows_indexed = summarizeSearchFamilyRebuildRows(entity_counts);

        log?.info?.(
            {
                views: safeViews,
                duration_ms,
                run_id: result?.run_id ?? null,
                status,
                rows_indexed,
                entity_counts,
                success,
            },
            success ? "search family rebuild finished" : "search family rebuild finished with failure status",
        );

        return {
            views: safeViews,
            duration_ms,
            run_id: result?.run_id ?? null,
            status,
            entity_counts,
            success,
        };
    } catch (err) {
        const duration_ms = Date.now() - startedAt;
        log?.error?.({ err, views: safeViews, duration_ms, success: false }, "search family rebuild failed");
        return {
            views: safeViews,
            duration_ms,
            run_id: null,
            status: "error",
            entity_counts: {},
            success: false,
        };
    }
}

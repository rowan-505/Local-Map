import type { Prisma, PrismaClient } from "@prisma/client";

/** Stable namespace for search index family rebuild advisory locks. */
export const SEARCH_INDEX_REBUILD_LOCK_NAMESPACE = 742_019;

const REBUILD_LOCK_TRANSACTION_TIMEOUT_MS = 90 * 60 * 1000;
const REBUILD_LOCK_TRANSACTION_MAX_WAIT_MS = 60 * 1000;

export type SearchIndexRebuildLockClient = PrismaClient | Prisma.TransactionClient;

export class SearchIndexRebuildLockError extends Error {
    constructor(
        message: string,
        public readonly views: readonly string[],
    ) {
        super(message);
        this.name = "SearchIndexRebuildLockError";
    }
}

function hashViewLockKey(view: string): number {
    let hash = 0;
    for (const char of view) {
        hash = (hash * 31 + char.charCodeAt(0)) | 0;
    }
    return Math.abs(hash) % 2_147_483_647;
}

export function searchIndexRebuildLockKeys(views: readonly string[]): number[] {
    return [...new Set(views.map(hashViewLockKey))].sort((a, b) => a - b);
}

/**
 * Acquire session-level advisory locks for the requested rebuild views on one DB
 * connection, then run the callback. Uses an interactive transaction so locks stay
 * pinned for the full rebuild even when DATABASE_URL points at a transaction pooler.
 */
export async function withSearchIndexRebuildLocks<T>(
    prisma: PrismaClient,
    views: readonly string[],
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
    const keys = searchIndexRebuildLockKeys(views);

    return prisma.$transaction(
        async (tx) => {
            const acquired: number[] = [];
            try {
                for (const key of keys) {
                    const rows = await tx.$queryRawUnsafe<Array<{ pg_try_advisory_lock: boolean }>>(
                        "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS pg_try_advisory_lock",
                        SEARCH_INDEX_REBUILD_LOCK_NAMESPACE,
                        key,
                    );
                    if (!rows[0]?.pg_try_advisory_lock) {
                        throw new SearchIndexRebuildLockError(
                            "Another search index rebuild is already running for one of the requested families.",
                            views,
                        );
                    }
                    acquired.push(key);
                }

                return await fn(tx);
            } finally {
                for (const key of acquired) {
                    await tx.$executeRawUnsafe(
                        "SELECT pg_advisory_unlock($1::integer, $2::integer)",
                        SEARCH_INDEX_REBUILD_LOCK_NAMESPACE,
                        key,
                    );
                }
            }
        },
        {
            timeout: REBUILD_LOCK_TRANSACTION_TIMEOUT_MS,
            maxWait: REBUILD_LOCK_TRANSACTION_MAX_WAIT_MS,
        },
    );
}

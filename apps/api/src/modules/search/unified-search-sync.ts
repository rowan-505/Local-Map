import type { PrismaClient } from "@prisma/client";

import { UnifiedSearchSyncRepository } from "./unified-search-sync.repo.js";
import { normalizeTransportSearchEntityType } from "./transport-search-entity.js";
import type {
    UnifiedSearchSyncEntityType,
    UnifiedSearchSyncResult,
    UnifiedSearchSyncSpec,
} from "./unified-search-sync.types.js";

import type { SearchAliasRefreshResult } from "./search-aliases.types.js";

type SyncLogger = {
    warn: (obj: Record<string, unknown>, msg: string) => void;
};

function dedupeSpecs(specs: readonly UnifiedSearchSyncSpec[]): UnifiedSearchSyncSpec[] {
    const seen = new Set<string>();
    const out: UnifiedSearchSyncSpec[] = [];
    for (const spec of specs) {
        const key = `${spec.entityType}:${spec.entityId.toString()}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(spec);
    }
    return out;
}

/** Fire-and-forget safe incremental unified search sync for one or more entities. */
export async function refreshUnifiedSearchDocuments(
    prisma: PrismaClient,
    specs: readonly UnifiedSearchSyncSpec[],
    log?: SyncLogger,
): Promise<void> {
    const repo = new UnifiedSearchSyncRepository(prisma);
    const grouped = new Map<string, bigint[]>();

    for (const spec of dedupeSpecs(specs)) {
        const bucket = grouped.get(spec.entityType) ?? [];
        bucket.push(spec.entityId);
        grouped.set(spec.entityType, bucket);
    }

    for (const [entityType, entityIds] of grouped) {
        try {
            const canonicalType = normalizeTransportSearchEntityType(entityType);
            const result = await repo.syncDocuments(
                canonicalType as UnifiedSearchSyncSpec["entityType"],
                entityIds,
            );
            if (result.synced === 0 && result.removed === 0 && entityIds.length > 0) {
                log?.warn(
                    { entityType, entityIds: entityIds.map(String), result },
                    "search.sync_search_documents made no index changes",
                );
            }
        } catch (err) {
            log?.warn(
                { err, entityType, entityIds: entityIds.map(String) },
                "search.sync_search_documents failed",
            );
        }
    }
}

/** Refresh grouped street search rows affected by a core street segment write. */
export async function refreshStreetGroupSearchForStreet(
    prisma: PrismaClient,
    streetId: bigint,
    log?: SyncLogger,
): Promise<void> {
    try {
        const repo = new UnifiedSearchSyncRepository(prisma);
        await repo.syncStreetGroupForStreet(streetId);
    } catch (err) {
        log?.warn({ err, streetId: streetId.toString() }, "search.sync_street_group_for_street failed");
    }
}

/** Schedule sync without blocking the caller or failing the canonical write. */
export function scheduleUnifiedSearchDocuments(
    prisma: PrismaClient,
    specs: readonly UnifiedSearchSyncSpec[],
    log?: SyncLogger,
): void {
    void refreshUnifiedSearchDocuments(prisma, specs, log);
}

export function scheduleStreetGroupSearchForStreet(
    prisma: PrismaClient,
    streetId: bigint,
    log?: SyncLogger,
): void {
    void refreshStreetGroupSearchForStreet(prisma, streetId, log);
}

export async function scheduleTransportRouteFamilySearchSync(
    prisma: PrismaClient,
    routePublicId: string,
    log?: SyncLogger,
): Promise<void> {
    try {
        const repo = new UnifiedSearchSyncRepository(prisma);
        const family = await repo.lookupTransportRouteFamilyIds(routePublicId);
        if (!family) {
            return;
        }
        const specs: UnifiedSearchSyncSpec[] = [
            { entityType: "transport_route", entityId: family.routeId },
            ...family.variantIds.map((entityId) => ({
                entityType: "transport_route_variant" as const,
                entityId,
            })),
        ];
        await refreshUnifiedSearchDocuments(prisma, specs, log);
    } catch (err) {
        log?.warn({ err, routePublicId }, "transport route family search sync failed");
    }
}

export function scheduleTransportStopSearchSyncByPublicId(
    prisma: PrismaClient,
    stopPublicId: string,
    log?: SyncLogger,
): void {
    void (async () => {
        try {
            const repo = new UnifiedSearchSyncRepository(prisma);
            const stopId = await repo.lookupTransportStopId(stopPublicId);
            if (!stopId) {
                return;
            }
            await refreshUnifiedSearchDocuments(
                prisma,
                [{ entityType: "transport_stop", entityId: stopId }],
                log,
            );
        } catch (err) {
            log?.warn({ err, stopPublicId }, "transport stop search sync failed");
        }
    })();
}

/** Fold active aliases into search documents for specific indexed entities only. */
export async function refreshSearchAliasesForEntities(
    prisma: PrismaClient,
    entityType: string,
    entityIds: readonly bigint[],
    log?: SyncLogger,
): Promise<{ ok: boolean; result?: SearchAliasRefreshResult; error?: string }> {
    if (entityIds.length === 0) {
        return { ok: true, result: { entity_type: entityType, entity_ids: [], names_removed: 0, names_added: 0, documents_updated: 0 } };
    }

    const repo = new UnifiedSearchSyncRepository(prisma);
    const canonicalType = normalizeTransportSearchEntityType(entityType);

    try {
        const result = await repo.refreshSearchAliases(canonicalType, entityIds);
        if (result.documents_updated === 0 && result.names_added === 0 && result.names_removed === 0) {
            log?.warn(
                {
                    entityType: canonicalType,
                    entityIds: entityIds.map(String),
                    result,
                },
                "search.refresh_search_aliases made no index changes",
            );
        }
        return { ok: true, result };
    } catch (err) {
        const error = err instanceof Error ? err.message : "search.refresh_search_aliases failed";
        log?.warn(
            { err, entityType: canonicalType, entityIds: entityIds.map(String) },
            "search.refresh_search_aliases failed",
        );
        return { ok: false, error };
    }
}

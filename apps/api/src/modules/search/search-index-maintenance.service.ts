import type { PrismaClient } from "@prisma/client";

import {
    rebuildSearchFamilies,
    summarizeSearchFamilyRebuildRows,
    type SearchFamilyRebuildLog,
    type SearchFamilyRebuildOutcome,
} from "./search-family-rebuild.js";
import {
    buildRepairedByFamily,
    buildSearchIndexHealthReport,
    fetchSearchIndexRunMetadata,
    getSearchIndexHealthReport,
    hasSearchIndexHealthIssues,
    isAllowlistedSearchIndexHealthFamily,
    isSearchIndexFamilyUnhealthy,
    resolveRebuildViewForHealthFamily,
    resolveRebuildViewsForHealthFamilies,
    runSearchIndexHealthCheck,
    type SearchIndexHealthReport,
} from "./search-index-health.js";
import {
    SearchIndexRebuildLockError,
    withSearchIndexRebuildLocks,
} from "./search-index-maintenance.lock.js";
import {
    SearchIndexMaintenanceRepository,
    type SearchIndexMaintenanceAuditContext,
} from "./search-index-maintenance.repo.js";
import type {
    ReindexSearchEntityBody,
    ReindexSearchFamilyBody,
} from "./search-index-maintenance.schema.js";
import { UnifiedSearchSyncRepository } from "./unified-search-sync.repo.js";
import { normalizeTransportSearchEntityType } from "./transport-search-entity.js";
import type { UnifiedSearchSyncEntityType } from "./unified-search-sync.types.js";

export class SearchIndexMaintenanceError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "SearchIndexMaintenanceError";
    }
}

export type SearchIndexMaintenanceActor = {
    publicId: string;
    ipAddress: string | null;
    userAgent: string | null;
};

export type SearchIndexMaintenanceOperationStatus =
    | "success"
    | "partial"
    | "failed"
    | "skipped"
    | "conflict";

export type SearchIndexMaintenanceOperationResult = {
    operation: "health_check" | "reindex_family" | "reindex_entity" | "repair_unhealthy";
    status: SearchIndexMaintenanceOperationStatus;
    duration_ms: number;
    affected_families: string[];
    entity_family: string | null;
    entity_type: string | null;
    entity_id: string | null;
    rebuild_views: string[];
    rebuild_run_id: string | null;
    rows_rebuilt: number;
    message: string | null;
    health_before: SearchIndexHealthReport;
    health_after: SearchIndexHealthReport;
};

type MaintenanceLog = SearchFamilyRebuildLog;

function deriveOperationStatus(input: {
    rebuild?: SearchFamilyRebuildOutcome | null;
    healthAfterUnhealthy: boolean;
    skipped?: boolean;
    conflict?: boolean;
    partialRepair?: boolean;
}): SearchIndexMaintenanceOperationStatus {
    if (input.conflict) {
        return "conflict";
    }
    if (input.skipped) {
        return "skipped";
    }
    if (input.rebuild?.success === false) {
        return "failed";
    }
    if (input.partialRepair || input.healthAfterUnhealthy) {
        return "partial";
    }
    return "success";
}

async function loadHealthReport(prisma: PrismaClient): Promise<SearchIndexHealthReport> {
    const [rows, runs] = await Promise.all([
        runSearchIndexHealthCheck(prisma),
        fetchSearchIndexRunMetadata(prisma),
    ]);
    return buildSearchIndexHealthReport(rows, runs);
}

function auditSnapshot(result: SearchIndexMaintenanceOperationResult): Record<string, unknown> {
    return {
        operation: result.operation,
        status: result.status,
        duration_ms: result.duration_ms,
        affected_families: result.affected_families,
        entity_family: result.entity_family,
        entity_type: result.entity_type,
        entity_id: result.entity_id,
        rebuild_views: result.rebuild_views,
        rebuild_run_id: result.rebuild_run_id,
        rows_rebuilt: result.rows_rebuilt,
        message: result.message,
        health_before_status: result.health_before.overall_status,
        health_after_status: result.health_after.overall_status,
    };
}

export class SearchIndexMaintenanceService {
    constructor(
        private readonly prisma: PrismaClient,
        private readonly repo = new SearchIndexMaintenanceRepository(prisma),
    ) {}

    private async writeAudit(
        actor: SearchIndexMaintenanceActor,
        actionType: string,
        entityId: bigint | null,
        before: SearchIndexMaintenanceOperationResult | null,
        after: SearchIndexMaintenanceOperationResult,
    ): Promise<void> {
        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        const audit: SearchIndexMaintenanceAuditContext = {
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        };
        await this.repo.insertAudit({
            actionType,
            entityId,
            before: before ? auditSnapshot(before) : null,
            after: auditSnapshot(after),
            audit,
        });
    }

    async runHealthCheck(actor: SearchIndexMaintenanceActor): Promise<SearchIndexMaintenanceOperationResult> {
        const startedAt = Date.now();
        const report = await getSearchIndexHealthReport(this.prisma);
        const result: SearchIndexMaintenanceOperationResult = {
            operation: "health_check",
            status: report.overall_status === "healthy" ? "success" : "partial",
            duration_ms: Date.now() - startedAt,
            affected_families: [],
            entity_family: null,
            entity_type: null,
            entity_id: null,
            rebuild_views: [],
            rebuild_run_id: null,
            rows_rebuilt: 0,
            message: null,
            health_before: report,
            health_after: report,
        };
        await this.writeAudit(actor, "search_index.health_check", null, null, result);
        return result;
    }

    async reindexFamily(
        actor: SearchIndexMaintenanceActor,
        body: ReindexSearchFamilyBody,
        log?: MaintenanceLog,
    ): Promise<SearchIndexMaintenanceOperationResult> {
        if (!isAllowlistedSearchIndexHealthFamily(body.entity_family)) {
            throw new SearchIndexMaintenanceError("Unknown search index family.", 400);
        }

        const rebuildView = resolveRebuildViewForHealthFamily(body.entity_family);
        if (!rebuildView) {
            throw new SearchIndexMaintenanceError("No rebuild view mapped for family.", 400);
        }

        const startedAt = Date.now();
        const healthBefore = await loadHealthReport(this.prisma);

        let rebuild: SearchFamilyRebuildOutcome | null = null;
        let status: SearchIndexMaintenanceOperationStatus = "failed";
        let message: string | null = null;

        try {
            rebuild = await withSearchIndexRebuildLocks(this.prisma, [rebuildView], (tx) =>
                rebuildSearchFamilies(tx, [rebuildView], log),
            );
        } catch (err) {
            if (err instanceof SearchIndexRebuildLockError) {
                message = err.message;
                status = "conflict";
            } else {
                throw err;
            }
        }

        const healthAfter = await loadHealthReport(this.prisma);
        const familyAfter = healthAfter.families.find((row) => row.entity_family === body.entity_family);

        if (status !== "conflict") {
            status = deriveOperationStatus({
                rebuild,
                healthAfterUnhealthy: familyAfter?.status === "unhealthy",
            });
        }

        const result: SearchIndexMaintenanceOperationResult = {
            operation: "reindex_family",
            status,
            duration_ms: Date.now() - startedAt,
            affected_families: [body.entity_family],
            entity_family: body.entity_family,
            entity_type: familyAfter?.search_entity_type ?? null,
            entity_id: null,
            rebuild_views: rebuild?.views ?? [rebuildView],
            rebuild_run_id: rebuild?.run_id != null ? String(rebuild.run_id) : null,
            rows_rebuilt: rebuild ? summarizeSearchFamilyRebuildRows(rebuild.entity_counts) : 0,
            message,
            health_before: healthBefore,
            health_after: healthAfter,
        };
        await this.writeAudit(actor, "search_index.reindex_family", null, null, result);
        return result;
    }

    async repairUnhealthyFamilies(
        actor: SearchIndexMaintenanceActor,
        log?: MaintenanceLog,
    ): Promise<SearchIndexMaintenanceOperationResult> {
        const startedAt = Date.now();
        const beforeRows = await runSearchIndexHealthCheck(this.prisma);
        const healthBefore = buildSearchIndexHealthReport(
            beforeRows,
            await fetchSearchIndexRunMetadata(this.prisma),
        );

        const unhealthy = beforeRows.filter(isSearchIndexFamilyUnhealthy);
        if (unhealthy.length === 0) {
            const result: SearchIndexMaintenanceOperationResult = {
                operation: "repair_unhealthy",
                status: "skipped",
                duration_ms: Date.now() - startedAt,
                affected_families: [],
                entity_family: null,
                entity_type: null,
                entity_id: null,
                rebuild_views: [],
                rebuild_run_id: null,
                rows_rebuilt: 0,
                message: "All search index families are already healthy.",
                health_before: healthBefore,
                health_after: healthBefore,
            };
            await this.writeAudit(actor, "search_index.repair_unhealthy", null, null, result);
            return result;
        }

        const rebuildViews = resolveRebuildViewsForHealthFamilies(unhealthy.map((row) => row.entity_family));
        if (rebuildViews.length === 0) {
            throw new SearchIndexMaintenanceError(
                "No rebuild views resolved for unhealthy families.",
                400,
            );
        }

        let rebuild: SearchFamilyRebuildOutcome | null = null;
        let status: SearchIndexMaintenanceOperationStatus = "failed";
        let message: string | null = null;

        try {
            rebuild = await withSearchIndexRebuildLocks(this.prisma, rebuildViews, (tx) =>
                rebuildSearchFamilies(tx, rebuildViews, log),
            );
        } catch (err) {
            if (err instanceof SearchIndexRebuildLockError) {
                message = err.message;
                status = "conflict";
                const healthAfter = await loadHealthReport(this.prisma);
                const result: SearchIndexMaintenanceOperationResult = {
                    operation: "repair_unhealthy",
                    status,
                    duration_ms: Date.now() - startedAt,
                    affected_families: unhealthy.map((row) => row.entity_family),
                    entity_family: null,
                    entity_type: null,
                    entity_id: null,
                    rebuild_views: rebuildViews,
                    rebuild_run_id: null,
                    rows_rebuilt: 0,
                    message,
                    health_before: healthBefore,
                    health_after: healthAfter,
                };
                await this.writeAudit(actor, "search_index.repair_unhealthy", null, null, result);
                return result;
            }
            throw err;
        }

        const afterRows = await runSearchIndexHealthCheck(this.prisma);
        const repairedByFamily = buildRepairedByFamily(beforeRows, afterRows);
        const repairedCount = [...repairedByFamily.values()].filter(Boolean).length;
        const healthAfter = buildSearchIndexHealthReport(
            afterRows,
            await fetchSearchIndexRunMetadata(this.prisma),
        );

        status = deriveOperationStatus({
            rebuild,
            healthAfterUnhealthy: hasSearchIndexHealthIssues(afterRows),
            partialRepair: repairedCount > 0 && repairedCount < unhealthy.length,
        });

        const result: SearchIndexMaintenanceOperationResult = {
            operation: "repair_unhealthy",
            status,
            duration_ms: Date.now() - startedAt,
            affected_families: unhealthy.map((row) => row.entity_family),
            entity_family: null,
            entity_type: null,
            entity_id: null,
            rebuild_views: rebuildViews,
            rebuild_run_id: rebuild?.run_id != null ? String(rebuild.run_id) : null,
            rows_rebuilt: rebuild ? summarizeSearchFamilyRebuildRows(rebuild.entity_counts) : 0,
            message:
                repairedCount < unhealthy.length
                    ? `Repaired ${repairedCount}/${unhealthy.length} unhealthy families.`
                    : null,
            health_before: healthBefore,
            health_after: healthAfter,
        };
        await this.writeAudit(actor, "search_index.repair_unhealthy", null, null, result);
        return result;
    }

    async reindexEntity(
        actor: SearchIndexMaintenanceActor,
        body: ReindexSearchEntityBody,
        log?: MaintenanceLog,
    ): Promise<SearchIndexMaintenanceOperationResult> {
        const startedAt = Date.now();
        const healthBefore = await loadHealthReport(this.prisma);
        const canonicalType = normalizeTransportSearchEntityType(body.entity_type);
        const syncRepo = new UnifiedSearchSyncRepository(this.prisma);

        let syncResult;
        try {
            syncResult = await syncRepo.syncDocuments(
                canonicalType as UnifiedSearchSyncEntityType,
                [body.entity_id],
            );
        } catch (err) {
            const message = err instanceof Error ? err.message : "search.sync_search_documents failed";
            log?.error?.({ err, entity_type: canonicalType, entity_id: body.entity_id.toString() }, message);
            throw new SearchIndexMaintenanceError(message, 500);
        }

        const healthAfter = await loadHealthReport(this.prisma);
        const rowsRebuilt = syncResult.synced + syncResult.removed;
        const familyAfter = healthAfter.families.find((row) => row.search_entity_type === canonicalType);

        const result: SearchIndexMaintenanceOperationResult = {
            operation: "reindex_entity",
            status: rowsRebuilt > 0 || familyAfter?.status === "healthy" ? "success" : "partial",
            duration_ms: Date.now() - startedAt,
            affected_families: familyAfter ? [familyAfter.entity_family] : [],
            entity_family: familyAfter?.entity_family ?? null,
            entity_type: canonicalType,
            entity_id: body.entity_id.toString(),
            rebuild_views: [],
            rebuild_run_id: null,
            rows_rebuilt: rowsRebuilt,
            message:
                rowsRebuilt === 0
                    ? "Incremental sync completed with no index row changes."
                    : null,
            health_before: healthBefore,
            health_after: healthAfter,
        };
        await this.writeAudit(actor, "search_index.reindex_entity", body.entity_id, null, result);
        return result;
    }
}

/** Shared repair flow for CLI reconcile script and admin API. */
export async function repairUnhealthySearchIndexFamilies(
    prisma: PrismaClient,
    log?: MaintenanceLog,
): Promise<{
    before: Awaited<ReturnType<typeof runSearchIndexHealthCheck>>;
    after: Awaited<ReturnType<typeof runSearchIndexHealthCheck>>;
    rebuild: SearchFamilyRebuildOutcome | null;
    rebuildViews: string[];
    skipped: boolean;
    repairedByFamily: Map<string, boolean>;
}> {
    const before = await runSearchIndexHealthCheck(prisma);
    const unhealthy = before.filter(isSearchIndexFamilyUnhealthy);

    if (unhealthy.length === 0) {
        return {
            before,
            after: before,
            rebuild: null,
            rebuildViews: [],
            skipped: true,
            repairedByFamily: buildRepairedByFamily(before, before),
        };
    }

    const rebuildViews = resolveRebuildViewsForHealthFamilies(unhealthy.map((row) => row.entity_family));
    if (rebuildViews.length === 0) {
        throw new Error("No rebuild views resolved for unhealthy families.");
    }

    const rebuild = await withSearchIndexRebuildLocks(prisma, rebuildViews, (tx) =>
        rebuildSearchFamilies(tx, rebuildViews, log),
    );
    const after = await runSearchIndexHealthCheck(prisma);

    return {
        before,
        after,
        rebuild,
        rebuildViews,
        skipped: false,
        repairedByFamily: buildRepairedByFamily(before, after),
    };
}

import type { PrismaClient } from "@prisma/client";

import { TransportRepository } from "./transport.repo.js";
import { TransportSchemaUnavailableError } from "./transport.errors.js";
import type { TransportAuditContext } from "./transport-audit.js";
import type {
    ListImportBatchesQuery,
    ListImportErrorsQuery,
    ListSourceLinksQuery,
    ListTransportRoutesQuery,
    ListTransportStopsQuery,
    ListTransportInfrastructureLinesQuery,
    ListTransportTerminalsQuery,
    UpdateInfrastructureLineInput,
    ListVariantStopsQuery,
    StopRoutesQuery,
    UpdateRouteInput,
    UpdateRouteStopInput,
    UpdateStopInput,
    UpdateTerminalInput,
    UpdateVariantInput,
} from "./transport.schema.js";
import type {
    TransportDataQualityQueues,
    TransportImportBatchListItem,
    TransportImportErrorListItem,
    TransportSourceLinkListItem,
    TransportOverview,
    TransportPaginated,
    TransportRouteDetail,
    TransportRouteListItem,
    TransportRouteStopItem,
    TransportStopDetail,
    TransportStopListItem,
    TransportStopRouteUsage,
    TransportTerminalDetail,
    TransportInfrastructureLineDetail,
    TransportInfrastructureLineListItem,
    TransportTerminalListItem,
    TransportVariantStopsResponse,
    TransportVariantSummary,
} from "./transport.types.js";

function emptyOverview(schemaAvailable: boolean): TransportOverview {
    return {
        counts: {
            routes: 0,
            routeVariants: 0,
            routePaths: 0,
            routeStops: 0,
            stops: 0,
            terminals: 0,
            infrastructureLines: 0,
            importBatches: 0,
            importErrors: 0,
        },
        byMode: { routes: {}, stops: {}, terminals: {}, infrastructureLines: {} },
        reviewStatus: { routes: {}, stops: {}, terminals: {}, infrastructureLines: {} },
        quality: {
            routesWithStops: 0,
            routesWithoutStops: 0,
            routeVariantsWithPath: 0,
            routeVariantsWithoutPath: 0,
            ferryTerminalsImportedUnreviewed: 0,
            generatedNameTerminals: 0,
            generatedNameStops: 0,
        },
        importIssues: {
            missingNameMm: 0,
            missingNameEn: 0,
            fallbackName: 0,
            routeGeometry: 0,
            routeStopMember: 0,
            lowConfidence: 0,
            other: 0,
        },
        schemaAvailable,
    };
}

function emptyDataQualityQueues(schemaAvailable: boolean): TransportDataQualityQueues {
    return {
        generatedNameStops: 0,
        generatedNameTerminals: 0,
        missingNameStops: 0,
        missingNameTerminals: 0,
        routesWithoutPath: 0,
        routesWithStopsButNoPath: 0,
        routesWithPathButNoStops: 0,
        ferryLandingCandidates: 0,
        lowConfidenceStops: 0,
        lowConfidenceTerminals: 0,
        lowConfidenceRoutes: 0,
        importErrors: 0,
        lowConfidenceThreshold: 60,
        schemaAvailable,
    };
}

/**
 * In-memory TTL for the two read-only aggregate endpoints. These run several
 * count/EXISTS subqueries against a remote pooled Postgres and are re-fetched on
 * every navigation to the Overview / Data Quality pages, so a short process-local
 * cache removes the repeated round-trip without risking stale data (it is also
 * invalidated after any Transport write mutation). No external cache is used.
 */
const AGGREGATE_CACHE_TTL_MS = 45_000;

type CacheEntry<T> = { value: T; expiresAt: number };

export class TransportService {
    private readonly repo: TransportRepository;
    private overviewCache: CacheEntry<TransportOverview> | null = null;
    private dataQualityCache: CacheEntry<TransportDataQualityQueues> | null = null;

    constructor(prisma: PrismaClient) {
        this.repo = new TransportRepository(prisma);
    }

    /** Drops cached Overview / Data Quality results so the next read reflects a write. */
    private invalidateAggregateCaches(): void {
        this.overviewCache = null;
        this.dataQualityCache = null;
    }

    /**
     * Returns a graceful empty overview (schemaAvailable=false) when transport tables
     * are missing. Successful results are cached for {@link AGGREGATE_CACHE_TTL_MS}.
     */
    async getOverview(): Promise<TransportOverview> {
        const now = Date.now();
        if (this.overviewCache && this.overviewCache.expiresAt > now) {
            return this.overviewCache.value;
        }
        try {
            const result = await this.repo.getOverview();
            this.overviewCache = { value: result, expiresAt: now + AGGREGATE_CACHE_TTL_MS };
            return result;
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return emptyOverview(false);
            }
            throw error;
        }
    }

    /** Returns an empty page when transport tables are missing, otherwise the filtered list. */
    async listImportBatches(
        query: ListImportBatchesQuery
    ): Promise<TransportPaginated<TransportImportBatchListItem>> {
        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;
        try {
            return await this.repo.listImportBatches(query);
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return { items: [], total: 0, limit, offset };
            }
            throw error;
        }
    }

    /** Returns an empty page when transport tables are missing, otherwise the filtered list. */
    async listImportErrors(
        query: ListImportErrorsQuery
    ): Promise<TransportPaginated<TransportImportErrorListItem>> {
        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;
        try {
            return await this.repo.listImportErrors(query);
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return { items: [], total: 0, limit, offset };
            }
            throw error;
        }
    }

    /** Returns an empty page when transport tables are missing, otherwise the filtered list. */
    async listSourceLinks(
        query: ListSourceLinksQuery
    ): Promise<TransportPaginated<TransportSourceLinkListItem>> {
        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;
        try {
            return await this.repo.listSourceLinks(query);
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return { items: [], total: 0, limit, offset };
            }
            throw error;
        }
    }

    /**
     * Returns zeroed queues (schemaAvailable=false) when transport tables are missing.
     * Successful results are cached for {@link AGGREGATE_CACHE_TTL_MS}.
     */
    async getDataQualityQueues(): Promise<TransportDataQualityQueues> {
        const now = Date.now();
        if (this.dataQualityCache && this.dataQualityCache.expiresAt > now) {
            return this.dataQualityCache.value;
        }
        try {
            const result = await this.repo.getDataQualityQueues();
            this.dataQualityCache = { value: result, expiresAt: now + AGGREGATE_CACHE_TTL_MS };
            return result;
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return emptyDataQualityQueues(false);
            }
            throw error;
        }
    }

    /** Returns an empty page when transport tables are missing, otherwise the filtered list. */
    async listRoutes(
        query: ListTransportRoutesQuery
    ): Promise<TransportPaginated<TransportRouteListItem>> {
        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;
        try {
            return await this.repo.listRoutes(query);
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return { items: [], total: 0, limit, offset };
            }
            throw error;
        }
    }

    /** Returns an empty page when transport tables are missing, otherwise the filtered list. */
    async listStops(
        query: ListTransportStopsQuery
    ): Promise<TransportPaginated<TransportStopListItem>> {
        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;
        try {
            return await this.repo.listStops(query);
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return { items: [], total: 0, limit, offset };
            }
            throw error;
        }
    }

    /** Returns an empty page when transport tables are missing, otherwise the filtered list. */
    async listTerminals(
        query: ListTransportTerminalsQuery
    ): Promise<TransportPaginated<TransportTerminalListItem>> {
        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;
        try {
            return await this.repo.listTerminals(query);
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return { items: [], total: 0, limit, offset };
            }
            throw error;
        }
    }

    /** Returns an empty page when transport tables are missing, otherwise the filtered list. */
    async listInfrastructureLines(
        query: ListTransportInfrastructureLinesQuery
    ): Promise<TransportPaginated<TransportInfrastructureLineListItem>> {
        const limit = query.limit;
        const offset = query.page !== undefined ? (query.page - 1) * limit : query.offset;
        try {
            return await this.repo.listInfrastructureLines(query);
        } catch (error) {
            if (error instanceof TransportSchemaUnavailableError) {
                return { items: [], total: 0, limit, offset };
            }
            throw error;
        }
    }

    getInfrastructureLine(publicId: string): Promise<TransportInfrastructureLineDetail> {
        return this.repo.getInfrastructureLineByPublicId(publicId);
    }

    async updateInfrastructureLine(
        publicId: string,
        input: UpdateInfrastructureLineInput,
        audit?: TransportAuditContext
    ): Promise<TransportInfrastructureLineDetail> {
        const result = await this.repo.updateInfrastructureLineByPublicId(publicId, input, audit);
        this.invalidateAggregateCaches();
        return result;
    }

    getTerminal(publicId: string): Promise<TransportTerminalDetail> {
        return this.repo.getTerminalByPublicId(publicId);
    }

    async updateTerminal(
        publicId: string,
        input: UpdateTerminalInput,
        audit?: TransportAuditContext
    ): Promise<TransportTerminalDetail> {
        const result = await this.repo.updateTerminalByPublicId(publicId, input, audit);
        this.invalidateAggregateCaches();
        return result;
    }

    getStop(publicId: string): Promise<TransportStopDetail> {
        return this.repo.getStopByPublicId(publicId);
    }

    listRoutesForStop(
        publicId: string,
        query: StopRoutesQuery
    ): Promise<TransportPaginated<TransportStopRouteUsage>> {
        return this.repo.listRoutesForStop(publicId, query);
    }

    async updateStop(
        publicId: string,
        input: UpdateStopInput,
        audit?: TransportAuditContext
    ): Promise<TransportStopDetail> {
        const result = await this.repo.updateStopByPublicId(publicId, input, audit);
        this.invalidateAggregateCaches();
        return result;
    }

    getRoute(publicId: string): Promise<TransportRouteDetail> {
        return this.repo.getRouteByPublicId(publicId);
    }

    listVariantsForRoute(routePublicId: string): Promise<TransportVariantSummary[]> {
        return this.repo.listVariantsForRoute(routePublicId);
    }

    listStopsForVariant(
        variantPublicId: string,
        query: ListVariantStopsQuery
    ): Promise<TransportVariantStopsResponse> {
        return this.repo.listStopsForVariant(variantPublicId, query);
    }

    async updateRoute(
        publicId: string,
        input: UpdateRouteInput,
        audit?: TransportAuditContext
    ): Promise<TransportRouteDetail> {
        const result = await this.repo.updateRouteByPublicId(publicId, input, audit);
        this.invalidateAggregateCaches();
        return result;
    }

    async updateVariant(
        variantPublicId: string,
        input: UpdateVariantInput,
        audit?: TransportAuditContext
    ): Promise<TransportVariantSummary> {
        const result = await this.repo.updateVariantByPublicId(variantPublicId, input, audit);
        this.invalidateAggregateCaches();
        return result;
    }

    async updateRouteStopFlags(
        id: bigint,
        input: UpdateRouteStopInput,
        audit?: TransportAuditContext
    ): Promise<TransportRouteStopItem> {
        const result = await this.repo.updateRouteStopFlags(id, input, audit);
        this.invalidateAggregateCaches();
        return result;
    }

    async moveRouteStop(
        id: bigint,
        direction: "up" | "down",
        audit?: TransportAuditContext
    ): Promise<{ moved: boolean; variantPublicId: string | null }> {
        const result = await this.repo.moveRouteStop(id, direction, audit);
        this.invalidateAggregateCaches();
        return result;
    }

    async removeRouteStop(
        id: bigint,
        audit?: TransportAuditContext,
        reason?: string
    ): Promise<{ deleted: boolean; variantPublicId: string | null }> {
        const result = await this.repo.removeRouteStop(id, audit, reason);
        this.invalidateAggregateCaches();
        return result;
    }
}

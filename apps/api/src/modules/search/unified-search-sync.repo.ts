import type { PrismaClient } from "@prisma/client";

import type {
    UnifiedSearchSyncEntityType,
    UnifiedSearchSyncResult,
} from "./unified-search-sync.types.js";
import type { SearchAliasRefreshResult } from "./search-aliases.types.js";

export class UnifiedSearchSyncRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async refreshSearchAliases(
        entityType: string,
        entityIds: readonly bigint[],
    ): Promise<SearchAliasRefreshResult> {
        if (entityIds.length === 0) {
            return {
                entity_type: entityType,
                entity_ids: [],
                names_removed: 0,
                names_added: 0,
                documents_updated: 0,
            };
        }

        const rows = await this.prisma.$queryRaw<
            Array<{ refresh_search_aliases: SearchAliasRefreshResult }>
        >`
            SELECT search.refresh_search_aliases(
                ${entityType}::text,
                ${entityIds}::bigint[]
            ) AS refresh_search_aliases
        `;

        return (
            rows[0]?.refresh_search_aliases ?? {
                entity_type: entityType,
                entity_ids: entityIds.map(String),
                names_removed: 0,
                names_added: 0,
                documents_updated: 0,
            }
        );
    }

    async syncDocuments(
        entityType: UnifiedSearchSyncEntityType,
        entityIds: readonly bigint[],
    ): Promise<UnifiedSearchSyncResult> {
        if (entityIds.length === 0) {
            return {
                entity_type: entityType,
                synced: 0,
                removed: 0,
                entity_ids: [],
            };
        }

        const rows = await this.prisma.$queryRaw<Array<{ sync_search_documents: UnifiedSearchSyncResult }>>`
            SELECT search.sync_search_documents(
                ${entityType}::text,
                ${entityIds}::bigint[]
            ) AS sync_search_documents
        `;

        return (
            rows[0]?.sync_search_documents ?? {
                entity_type: entityType,
                synced: 0,
                removed: 0,
                entity_ids: entityIds.map(String),
            }
        );
    }

    async syncStreetGroupForStreet(streetId: bigint): Promise<UnifiedSearchSyncResult> {
        const rows = await this.prisma.$queryRaw<
            Array<{ sync_street_group_for_street: UnifiedSearchSyncResult }>
        >`
            SELECT search.sync_street_group_for_street(${streetId}::bigint) AS sync_street_group_for_street
        `;

        return (
            rows[0]?.sync_street_group_for_street ?? {
                entity_type: "street_group",
                synced: 0,
                removed: 0,
                entity_ids: [streetId.toString()],
            }
        );
    }

    async lookupStreetId(streetPublicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT s.id
            FROM core.core_streets s
            WHERE s.public_id = ${streetPublicId}::uuid
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    async lookupTransportStopId(stopPublicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT s.id
            FROM transport.stops s
            WHERE s.public_id = ${stopPublicId}::uuid
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    async lookupTransportRouteFamilyIds(routePublicId: string): Promise<{
        routeId: bigint;
        variantIds: bigint[];
    } | null> {
        const rows = await this.prisma.$queryRaw<
            Array<{ route_id: bigint; variant_ids: bigint[] | null }>
        >`
            SELECT
                r.id AS route_id,
                coalesce(
                    array_agg(v.id) FILTER (WHERE v.id IS NOT NULL),
                    '{}'::bigint[]
                ) AS variant_ids
            FROM transport.routes r
            LEFT JOIN transport.route_variants v
                ON v.route_id = r.id
               AND v.deleted_at IS NULL
            WHERE r.public_id = ${routePublicId}::uuid
            GROUP BY r.id
            LIMIT 1
        `;
        const row = rows[0];
        if (!row) {
            return null;
        }
        return {
            routeId: row.route_id,
            variantIds: row.variant_ids ?? [],
        };
    }

    async lookupTransportRoutePublicIdByPath(pathId: bigint): Promise<string | null> {
        const rows = await this.prisma.$queryRaw<Array<{ public_id: string }>>`
            SELECT r.public_id::text AS public_id
            FROM transport.route_paths rp
            INNER JOIN transport.route_variants v ON v.id = rp.route_variant_id
            INNER JOIN transport.routes r ON r.id = v.route_id
            WHERE rp.id = ${pathId}
            LIMIT 1
        `;
        return rows[0]?.public_id ?? null;
    }

    async lookupTransportRoutePublicIdByVariant(variantPublicId: string): Promise<string | null> {
        const rows = await this.prisma.$queryRaw<Array<{ public_id: string }>>`
            SELECT r.public_id::text AS public_id
            FROM transport.route_variants v
            INNER JOIN transport.routes r ON r.id = v.route_id
            WHERE v.public_id = ${variantPublicId}::uuid
            LIMIT 1
        `;
        return rows[0]?.public_id ?? null;
    }
}

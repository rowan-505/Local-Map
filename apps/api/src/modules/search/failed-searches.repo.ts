import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    ListFailedSearchesQuery,
    UpdateFailedSearchBody,
} from "./failed-searches.schema.js";

export type FailedSearchRow = {
    id: bigint;
    query: string;
    normalized_query: string | null;
    lang: string | null;
    category: string | null;
    transport_type: string | null;
    transport_mode: string | null;
    entity_types_key: string | null;
    types: string[] | null;
    area_context_key: string | null;
    result_count: number;
    occurrence_count: number;
    first_seen_at: Date;
    last_seen_at: Date;
    resolved_at: Date | null;
    resolution_type: string | null;
    linked_alias_id: bigint | null;
    linked_alias_text: string | null;
    linked_entity_type: string | null;
    linked_entity_id: bigint | null;
    linked_entity_display_name: string | null;
    linked_entity_public_id: string | null;
};

const failedSearchSelect = Prisma.sql`
    SELECT
        f.id,
        f.query,
        f.normalized_query,
        f.lang,
        f.category,
        f.transport_type,
        f.transport_mode,
        f.entity_types_key,
        f.types,
        f.area_context_key,
        f.result_count,
        f.occurrence_count,
        f.first_seen_at,
        f.last_seen_at,
        f.resolved_at,
        f.resolution_type,
        f.linked_alias_id,
        a.alias_text AS linked_alias_text,
        a.entity_type AS linked_entity_type,
        a.entity_id AS linked_entity_id,
        d.display_name AS linked_entity_display_name,
        d.public_id::text AS linked_entity_public_id
    FROM search.failed_search_logs f
    LEFT JOIN search.search_aliases a ON a.id = f.linked_alias_id
    LEFT JOIN search.search_documents d
        ON d.entity_type = a.entity_type
       AND d.entity_id = a.entity_id
       AND d.is_active = true
`;

function buildListWhere(filters: ListFailedSearchesQuery): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];

    if (filters.q) {
        const term = `%${filters.q}%`;
        conditions.push(
            Prisma.sql`(
                f.query ILIKE ${term}
                OR f.normalized_query ILIKE ${term}
            )`,
        );
    }
    if (filters.lang) {
        conditions.push(Prisma.sql`f.lang = ${filters.lang}`);
    }
    if (filters.resolved === true) {
        conditions.push(Prisma.sql`f.resolved_at IS NOT NULL`);
    } else if (filters.resolved === false) {
        conditions.push(Prisma.sql`f.resolved_at IS NULL`);
    }
    if (filters.last_seen_from) {
        conditions.push(Prisma.sql`f.last_seen_at >= ${new Date(filters.last_seen_from)}`);
    }
    if (filters.last_seen_to) {
        conditions.push(Prisma.sql`f.last_seen_at <= ${new Date(filters.last_seen_to)}`);
    }
    if (filters.min_occurrence !== undefined) {
        conditions.push(Prisma.sql`f.occurrence_count >= ${filters.min_occurrence}`);
    }

    return conditions.length
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;
}

function buildListOrderSql(filters: ListFailedSearchesQuery): Prisma.Sql {
    const direction = filters.order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const nulls =
        filters.order === "asc" ? Prisma.sql`NULLS FIRST` : Prisma.sql`NULLS LAST`;

    switch (filters.sort) {
        case "query":
            return Prisma.sql`lower(coalesce(f.normalized_query, f.query)) ${direction} ${nulls}, f.id DESC`;
        case "first_seen_at":
            return Prisma.sql`f.first_seen_at ${direction} ${nulls}, f.id DESC`;
        case "last_seen_at":
            return Prisma.sql`f.last_seen_at ${direction} ${nulls}, f.id DESC`;
        case "occurrence_count":
        default:
            return Prisma.sql`f.occurrence_count ${direction} ${nulls}, f.last_seen_at DESC, f.id DESC`;
    }
}

export class FailedSearchesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async list(filters: ListFailedSearchesQuery): Promise<{ items: FailedSearchRow[]; total: number }> {
        const where = buildListWhere(filters);
        const order = buildListOrderSql(filters);
        const offset = (filters.page - 1) * filters.pageSize;

        const [items, countRows] = await Promise.all([
            this.prisma.$queryRaw<FailedSearchRow[]>(Prisma.sql`
                ${failedSearchSelect}
                ${where}
                ORDER BY ${order}
                LIMIT ${filters.pageSize}
                OFFSET ${offset}
            `),
            this.prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
                SELECT count(*)::bigint AS total
                FROM search.failed_search_logs f
                ${where}
            `),
        ]);

        return {
            items,
            total: Number(countRows[0]?.total ?? 0n),
        };
    }

    async findById(id: bigint): Promise<FailedSearchRow | null> {
        const rows = await this.prisma.$queryRaw<FailedSearchRow[]>(Prisma.sql`
            ${failedSearchSelect}
            WHERE f.id = ${id}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async findOpenByDedupeKey(dedupeKey: string, excludeId?: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
            SELECT id
            FROM search.failed_search_logs
            WHERE dedupe_key = ${dedupeKey}
              AND resolved_at IS NULL
              ${excludeId !== undefined ? Prisma.sql`AND id <> ${excludeId}` : Prisma.empty}
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async getDedupeKey(id: bigint): Promise<string | null> {
        const rows = await this.prisma.$queryRaw<Array<{ dedupe_key: string | null }>>(Prisma.sql`
            SELECT dedupe_key
            FROM search.failed_search_logs
            WHERE id = ${id}
            LIMIT 1
        `);
        return rows[0]?.dedupe_key ?? null;
    }

    async aliasExists(id: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
            SELECT id
            FROM search.search_aliases
            WHERE id = ${id}
            LIMIT 1
        `);
        return rows.length > 0;
    }

    async resolve(
        id: bigint,
        input: Extract<UpdateFailedSearchBody, { action: "resolve" }>,
    ): Promise<FailedSearchRow | null> {
        const linkedAliasId =
            input.linked_alias_id !== undefined ? BigInt(input.linked_alias_id) : null;

        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE search.failed_search_logs
            SET
                resolved_at = now(),
                resolution_type = ${input.resolution_type},
                linked_alias_id = ${linkedAliasId}
            WHERE id = ${id}
              AND resolved_at IS NULL
        `);

        return this.findById(id);
    }

    async reopen(id: bigint): Promise<FailedSearchRow | null> {
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE search.failed_search_logs
            SET
                resolved_at = NULL,
                resolution_type = NULL,
                linked_alias_id = NULL
            WHERE id = ${id}
              AND resolved_at IS NOT NULL
        `);

        return this.findById(id);
    }
}

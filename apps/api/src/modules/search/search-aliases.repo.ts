import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    CreateSearchAliasBody,
    ListSearchAliasesQuery,
    UpdateSearchAliasBody,
} from "./search-aliases.schema.js";
import { expandTransportSearchEntityTypeFilter } from "./transport-search-entity.js";

export const SEARCH_ALIAS_AUDIT_ENTITY_TYPE = "search_alias";

export type SearchAliasRow = {
    id: bigint;
    entity_type: string;
    entity_id: bigint;
    alias_text: string;
    normalized_alias: string;
    language_code: string | null;
    alias_type: string;
    source: string | null;
    is_active: boolean;
    created_by: bigint | null;
    created_at: Date;
    updated_at: Date;
    indexed_display_name: string | null;
    indexed_public_id: string | null;
    has_indexed_entity: boolean;
};

export type IndexedSearchEntityRow = {
    entity_type: string;
    entity_id: bigint;
    display_name: string;
    public_id: string;
};

export type SearchAliasAuditContext = {
    actorUserId: bigint | null;
    ipAddress: string | null;
    userAgent: string | null;
};

const aliasSelect = Prisma.sql`
    SELECT
        a.id,
        a.entity_type,
        a.entity_id,
        a.alias_text,
        a.normalized_alias,
        a.language_code,
        a.alias_type,
        a.source,
        a.is_active,
        a.created_by,
        a.created_at,
        a.updated_at,
        d.display_name AS indexed_display_name,
        d.public_id::text AS indexed_public_id,
        (d.id IS NOT NULL) AS has_indexed_entity
    FROM search.search_aliases a
    LEFT JOIN search.search_documents d
        ON d.entity_type = a.entity_type
       AND d.entity_id = a.entity_id
       AND d.is_active = true
`;

function buildListWhere(filters: ListSearchAliasesQuery): Prisma.Sql {
    const conditions: Prisma.Sql[] = [];

    if (filters.q) {
        const term = `%${filters.q}%`;
        conditions.push(
            Prisma.sql`(
                a.alias_text ILIKE ${term}
                OR a.normalized_alias ILIKE ${term}
                OR d.display_name ILIKE ${term}
            )`,
        );
    }
    if (filters.entity_type) {
        const types = expandTransportSearchEntityTypeFilter(filters.entity_type);
        conditions.push(Prisma.sql`a.entity_type IN (${Prisma.join(types)})`);
    }
    if (filters.language_code) {
        conditions.push(Prisma.sql`a.language_code = ${filters.language_code}`);
    }
    if (filters.alias_type) {
        conditions.push(Prisma.sql`a.alias_type = ${filters.alias_type}`);
    }
    if (filters.is_active !== undefined) {
        conditions.push(Prisma.sql`a.is_active = ${filters.is_active}`);
    }
    if (filters.entity_id !== undefined) {
        conditions.push(Prisma.sql`a.entity_id = ${filters.entity_id}`);
    }
    if (filters.has_indexed_entity === true) {
        conditions.push(Prisma.sql`d.id IS NOT NULL`);
    }
    if (filters.has_indexed_entity === false) {
        conditions.push(Prisma.sql`d.id IS NULL`);
    }

    return conditions.length
        ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
        : Prisma.empty;
}

function buildListOrderSql(filters: ListSearchAliasesQuery): Prisma.Sql {
    const direction = filters.order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const nulls =
        filters.order === "asc" ? Prisma.sql`NULLS FIRST` : Prisma.sql`NULLS LAST`;

    switch (filters.sort) {
        case "alias_text":
            return Prisma.sql`lower(a.alias_text) ${direction} ${nulls}, a.id DESC`;
        case "created_at":
            return Prisma.sql`a.created_at ${direction} ${nulls}, a.id DESC`;
        case "updated_at":
        default:
            return Prisma.sql`a.updated_at ${direction} ${nulls}, a.id DESC`;
    }
}

export class SearchAliasesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async findUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<Array<{ id: bigint }>>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async findIndexedEntity(
        entityType: string,
        entityId: bigint,
    ): Promise<IndexedSearchEntityRow | null> {
        const types = expandTransportSearchEntityTypeFilter(entityType);
        const rows = await this.prisma.$queryRaw<IndexedSearchEntityRow[]>(Prisma.sql`
            SELECT
                d.entity_type,
                d.entity_id,
                d.display_name,
                d.public_id::text AS public_id
            FROM search.search_documents d
            WHERE d.entity_id = ${entityId}
              AND d.entity_type IN (${Prisma.join(types)})
              AND d.is_active = true
            ORDER BY CASE WHEN d.entity_type = ${entityType} THEN 0 ELSE 1 END
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async list(
        filters: ListSearchAliasesQuery,
    ): Promise<{ items: SearchAliasRow[]; total: number }> {
        const where = buildListWhere(filters);
        const offset = (filters.page - 1) * filters.pageSize;

        const items = await this.prisma.$queryRaw<SearchAliasRow[]>(Prisma.sql`
            ${aliasSelect}
            ${where}
            ORDER BY ${buildListOrderSql(filters)}
            LIMIT ${filters.pageSize} OFFSET ${offset}
        `);

        const totalRows = await this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
            SELECT COUNT(*)::int AS total
            FROM search.search_aliases a
            LEFT JOIN search.search_documents d
                ON d.entity_type = a.entity_type
               AND d.entity_id = a.entity_id
               AND d.is_active = true
            ${where}
        `);

        return { items, total: totalRows[0]?.total ?? 0 };
    }

    async findById(id: bigint): Promise<SearchAliasRow | null> {
        const rows = await this.prisma.$queryRaw<SearchAliasRow[]>(Prisma.sql`
            ${aliasSelect}
            WHERE a.id = ${id}
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async create(
        input: CreateSearchAliasBody & {
            entityType: string;
            createdBy: bigint | null;
        },
    ): Promise<SearchAliasRow> {
        const rows = await this.prisma.$queryRaw<SearchAliasRow[]>(Prisma.sql`
            INSERT INTO search.search_aliases (
                entity_type,
                entity_id,
                alias_text,
                normalized_alias,
                language_code,
                alias_type,
                source,
                is_active,
                created_by
            )
            VALUES (
                ${input.entityType},
                ${input.entity_id},
                ${input.alias_text},
                lower(${input.alias_text}),
                ${input.language_code ?? null},
                ${input.alias_type},
                ${input.source ?? null},
                ${input.is_active},
                ${input.createdBy}
            )
            RETURNING
                id,
                entity_type,
                entity_id,
                alias_text,
                normalized_alias,
                language_code,
                alias_type,
                source,
                is_active,
                created_by,
                created_at,
                updated_at,
                NULL::text AS indexed_display_name,
                NULL::text AS indexed_public_id,
                false AS has_indexed_entity
        `);
        const created = rows[0];
        if (!created) {
            throw new Error("search alias insert returned no row");
        }
        return (await this.findById(created.id)) ?? created;
    }

    async update(
        id: bigint,
        input: UpdateSearchAliasBody,
    ): Promise<SearchAliasRow | null> {
        const sets: Prisma.Sql[] = [];

        if (input.alias_text !== undefined) {
            sets.push(Prisma.sql`alias_text = ${input.alias_text}`);
            sets.push(Prisma.sql`normalized_alias = lower(${input.alias_text})`);
        }
        if (input.alias_type !== undefined) {
            sets.push(Prisma.sql`alias_type = ${input.alias_type}`);
        }
        if (input.language_code !== undefined) {
            sets.push(Prisma.sql`language_code = ${input.language_code}`);
        }
        if (input.source !== undefined) {
            sets.push(Prisma.sql`source = ${input.source}`);
        }
        if (input.is_active !== undefined) {
            sets.push(Prisma.sql`is_active = ${input.is_active}`);
        }

        if (sets.length === 0) {
            return this.findById(id);
        }

        sets.push(Prisma.sql`updated_at = now()`);

        const rows = await this.prisma.$queryRaw<SearchAliasRow[]>(Prisma.sql`
            UPDATE search.search_aliases
            SET ${Prisma.join(sets, ", ")}
            WHERE id = ${id}
            RETURNING
                id,
                entity_type,
                entity_id,
                alias_text,
                normalized_alias,
                language_code,
                alias_type,
                source,
                is_active,
                created_by,
                created_at,
                updated_at,
                NULL::text AS indexed_display_name,
                NULL::text AS indexed_public_id,
                false AS has_indexed_entity
        `);

        if (!rows[0]) {
            return null;
        }
        return (await this.findById(id)) ?? rows[0];
    }

    async disable(id: bigint): Promise<SearchAliasRow | null> {
        return this.update(id, { is_active: false });
    }

    async insertAudit(input: {
        actionType: string;
        aliasId: bigint;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
        audit: SearchAliasAuditContext;
    }): Promise<void> {
        const before =
            input.before === null
                ? Prisma.sql`NULL`
                : Prisma.sql`${JSON.stringify(input.before)}::jsonb`;
        const after =
            input.after === null
                ? Prisma.sql`NULL`
                : Prisma.sql`${JSON.stringify(input.after)}::jsonb`;

        await this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO system.audit_logs (
                actor_user_id,
                action_type,
                entity_type,
                entity_id,
                before_snapshot,
                after_snapshot,
                ip_address,
                user_agent
            )
            VALUES (
                ${input.audit.actorUserId},
                ${input.actionType},
                ${SEARCH_ALIAS_AUDIT_ENTITY_TYPE},
                ${input.aliasId},
                ${before},
                ${after},
                ${input.audit.ipAddress},
                ${input.audit.userAgent}
            )
        `);
    }
}

export function isSearchAliasUniqueViolation(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2010") {
            const meta = error.meta as { code?: string; message?: string } | undefined;
            if (meta?.code === "23505") {
                return true;
            }
            const message = String(meta?.message ?? error.message ?? "");
            if (message.includes("search_aliases_active_unique_idx")) {
                return true;
            }
        }
    }

    const message = error instanceof Error ? error.message : String(error);
    return message.includes("search_aliases_active_unique_idx") || message.includes("23505");
}

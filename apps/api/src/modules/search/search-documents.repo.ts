import { Prisma, type PrismaClient } from "@prisma/client";

import {
    buildCanonicalFreshnessUnionSql,
    buildCanonicalInventoryUnionSql,
    buildIndexedSyncStateFilterSql,
    buildIndexedSyncStateSql,
    computeSearchDocumentSyncState,
    resolveSearchDocumentEntityTypesForFilter,
    type SearchDocumentEntityKey,
    type SearchDocumentEntityType,
    type SearchDocumentSyncState,
} from "./search-canonical-source.js";
import type { ListSearchDocumentsQuery } from "./search-documents.schema.js";
import { expandTransportSearchEntityTypeFilter } from "./transport-search-entity.js";

export type SearchDocumentRow = {
    search_document_id: bigint | null;
    entity_type: string;
    entity_id: bigint;
    public_id: string | null;
    display_name: string | null;
    primary_name_my: string | null;
    primary_name_en: string | null;
    primary_name_und: string | null;
    transport_mode: string | null;
    review_status: string | null;
    is_verified: boolean;
    is_public: boolean;
    is_active: boolean;
    importance_score: number;
    confidence_score: number;
    indexed_at: Date | null;
    source_updated_at: Date | null;
    canonical_source_updated_at: Date | null;
    alias_count: number;
    sync_state: SearchDocumentSyncState;
};

type ResolvedListQuery = ListSearchDocumentsQuery & {
    entityTypes: SearchDocumentEntityType[] | null;
};

type IndexedDocumentPageRow = Omit<
    SearchDocumentRow,
    "alias_count" | "sync_state" | "canonical_source_updated_at"
>;

type AliasCountRow = {
    entity_type: string;
    entity_id: bigint;
    alias_count: number;
};

export function needsCanonicalJoinForList(filters: Pick<ListSearchDocumentsQuery, "sync_state">): boolean {
    return (
        filters.sync_state === "current" ||
        filters.sync_state === "stale" ||
        filters.sync_state === "ghost"
    );
}

export function buildHasAliasExistsSql(hasAlias: boolean, documentAlias = "d"): Prisma.Sql {
    const document = Prisma.raw(documentAlias);
    if (hasAlias) {
        return Prisma.sql`EXISTS (
            SELECT 1
            FROM search.search_aliases a
            WHERE a.is_active = true
              AND a.entity_type = ${document}.entity_type
              AND a.entity_id = ${document}.entity_id
        )`;
    }

    return Prisma.sql`NOT EXISTS (
        SELECT 1
        FROM search.search_aliases a
        WHERE a.is_active = true
          AND a.entity_type = ${document}.entity_type
          AND a.entity_id = ${document}.entity_id
    )`;
}

export function entityKey(entityType: string, entityId: bigint): string {
    return `${entityType}:${entityId.toString()}`;
}

export function enrichIndexedDocumentRows(
    rows: readonly IndexedDocumentPageRow[],
    aliasCounts: ReadonlyMap<string, number>,
    canonicalFreshness: ReadonlyMap<string, Date | null> | null,
): SearchDocumentRow[] {
    return rows.map((row) => {
        const key = entityKey(row.entity_type, row.entity_id);
        const aliasCount = aliasCounts.get(key) ?? 0;

        if (!canonicalFreshness) {
            return {
                ...row,
                canonical_source_updated_at: null,
                alias_count: aliasCount,
                // List fast path: indexed rows are treated as current; use sync_state
                // filters for accurate canonical freshness (street_group views are expensive).
                sync_state: "current",
            };
        }

        const canonicalSourceUpdatedAt = canonicalFreshness.get(key) ?? null;
        const hasCanonical = canonicalFreshness.has(key);

        return {
            ...row,
            canonical_source_updated_at: canonicalSourceUpdatedAt,
            alias_count: aliasCount,
            sync_state: computeSearchDocumentSyncState({
                hasCanonical,
                indexedSourceUpdatedAt: row.source_updated_at,
                canonicalSourceUpdatedAt,
            }),
        };
    });
}

function resolveEntityTypes(filters: ListSearchDocumentsQuery): SearchDocumentEntityType[] | null {
    const resolved = resolveSearchDocumentEntityTypesForFilter(filters.entity_type);
    if (resolved && resolved.length === 0) {
        return [];
    }
    return resolved;
}

function buildSortSql(filters: ListSearchDocumentsQuery, missingMode: boolean): Prisma.Sql {
    const direction = filters.order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const nulls = filters.order === "asc" ? Prisma.sql`NULLS FIRST` : Prisma.sql`NULLS LAST`;

    switch (filters.sort) {
        case "name":
            return Prisma.sql`lower(coalesce(display_name, '')) ${direction} ${nulls}, entity_type ASC, entity_id ASC`;
        case "entity_type":
            return Prisma.sql`entity_type ${direction}, lower(coalesce(display_name, '')) ASC, entity_id ASC`;
        case "importance":
            return Prisma.sql`importance_score ${direction} ${nulls}, entity_type ASC, entity_id ASC`;
        case "confidence":
            return Prisma.sql`confidence_score ${direction} ${nulls}, entity_type ASC, entity_id ASC`;
        case "source_updated_at":
            return Prisma.sql`source_updated_at ${direction} ${nulls}, entity_type ASC, entity_id ASC`;
        case "indexed_at":
        default:
            if (missingMode) {
                return Prisma.sql`canonical_source_updated_at ${direction} ${nulls}, entity_type ASC, entity_id ASC`;
            }
            return Prisma.sql`indexed_at ${direction} ${nulls}, entity_type ASC, entity_id ASC`;
    }
}

function buildIndexedDocumentFilters(
    filters: ResolvedListQuery,
    documentAlias = "d",
): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];
    const d = Prisma.raw(documentAlias);

    if (filters.entityTypes) {
        if (filters.entityTypes.length === 0) {
            conditions.push(Prisma.sql`false`);
            return conditions;
        }
        conditions.push(Prisma.sql`${d}.entity_type IN (${Prisma.join(filters.entityTypes)})`);
    }

    if (filters.q) {
        const term = `%${filters.q}%`;
        conditions.push(Prisma.sql`(
            ${d}.display_name ILIKE ${term}
            OR ${d}.trigram_text ILIKE ${term}
            OR ${d}.public_id ILIKE ${term}
            OR ${d}.entity_id::text = ${filters.q}
        )`);
    }

    if (filters.transport_mode) {
        conditions.push(Prisma.sql`lower(coalesce(${d}.address_parts->>'mode', ${d}.category_code, '')) = ${filters.transport_mode}`);
    }

    if (filters.review_status) {
        conditions.push(
            Prisma.sql`lower(coalesce(${d}.address_parts->>'review_status', '')) = ${filters.review_status.toLowerCase()}`,
        );
    }

    if (filters.is_verified !== undefined) {
        conditions.push(Prisma.sql`${d}.is_verified = ${filters.is_verified}`);
    }
    if (filters.is_public !== undefined) {
        conditions.push(Prisma.sql`${d}.is_public = ${filters.is_public}`);
    }
    if (filters.is_active !== undefined) {
        conditions.push(Prisma.sql`${d}.is_active = ${filters.is_active}`);
    }

    if (filters.entity_id) {
        conditions.push(Prisma.sql`${d}.entity_id = ${BigInt(filters.entity_id)}`);
    }

    if (filters.language === "my") {
        conditions.push(Prisma.sql`${d}.primary_name_my IS NOT NULL AND btrim(${d}.primary_name_my) <> ''`);
    } else if (filters.language === "en") {
        conditions.push(Prisma.sql`${d}.primary_name_en IS NOT NULL AND btrim(${d}.primary_name_en) <> ''`);
    } else if (filters.language === "und") {
        conditions.push(Prisma.sql`${d}.primary_name_und IS NOT NULL AND btrim(${d}.primary_name_und) <> ''`);
    }

    if (filters.has_alias === true) {
        conditions.push(buildHasAliasExistsSql(true, documentAlias));
    } else if (filters.has_alias === false) {
        conditions.push(buildHasAliasExistsSql(false, documentAlias));
    }

    return conditions;
}

function buildMissingDocumentFilters(filters: ResolvedListQuery, canonicalAlias = "c"): Prisma.Sql[] {
    const conditions: Prisma.Sql[] = [];
    const c = Prisma.raw(canonicalAlias);

    if (filters.entityTypes) {
        if (filters.entityTypes.length === 0) {
            conditions.push(Prisma.sql`false`);
            return conditions;
        }
        conditions.push(Prisma.sql`${c}.entity_type IN (${Prisma.join(filters.entityTypes)})`);
    }

    if (filters.q) {
        const term = `%${filters.q}%`;
        conditions.push(Prisma.sql`(
            ${c}.display_name ILIKE ${term}
            OR ${c}.public_id ILIKE ${term}
            OR ${c}.entity_id::text = ${filters.q}
        )`);
    }

    if (filters.transport_mode) {
        conditions.push(
            Prisma.sql`lower(coalesce(${c}.address_parts->>'mode', '')) = ${filters.transport_mode}`,
        );
    }

    if (filters.review_status) {
        conditions.push(
            Prisma.sql`lower(coalesce(${c}.address_parts->>'review_status', '')) = ${filters.review_status.toLowerCase()}`,
        );
    }

    if (filters.is_verified !== undefined) {
        conditions.push(Prisma.sql`${c}.is_verified = ${filters.is_verified}`);
    }

    if (filters.entity_id) {
        conditions.push(Prisma.sql`${c}.entity_id = ${BigInt(filters.entity_id)}`);
    }

    if (filters.language === "my") {
        conditions.push(Prisma.sql`${c}.primary_name_my IS NOT NULL AND btrim(${c}.primary_name_my) <> ''`);
    } else if (filters.language === "en") {
        conditions.push(Prisma.sql`${c}.primary_name_en IS NOT NULL AND btrim(${c}.primary_name_en) <> ''`);
    } else if (filters.language === "und") {
        conditions.push(Prisma.sql`${c}.primary_name_und IS NOT NULL AND btrim(${c}.primary_name_und) <> ''`);
    }

    if (filters.is_public !== undefined || filters.is_active !== undefined || filters.has_alias !== undefined) {
        // Missing rows have no indexed document; only true filters for is_public/is_active/has_alias can match nothing.
        if (filters.is_public === true || filters.is_active === true || filters.has_alias === true) {
            conditions.push(Prisma.sql`false`);
        }
    }

    return conditions;
}

function buildWhereClause(conditions: Prisma.Sql[]): Prisma.Sql {
    return conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

const INDEXED_DOCUMENT_SELECT = Prisma.sql`
    d.id AS search_document_id,
    d.entity_type,
    d.entity_id,
    d.public_id,
    d.display_name,
    d.primary_name_my,
    d.primary_name_en,
    d.primary_name_und,
    nullif(btrim(coalesce(d.address_parts->>'mode', d.category_code, '')), '') AS transport_mode,
    nullif(btrim(coalesce(d.address_parts->>'review_status', '')), '') AS review_status,
    d.is_verified,
    d.is_public,
    d.is_active,
    d.importance_score::double precision AS importance_score,
    d.confidence_score::double precision AS confidence_score,
    d.indexed_at,
    d.source_updated_at
`;

export class SearchDocumentsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async list(filters: ListSearchDocumentsQuery): Promise<{ items: SearchDocumentRow[]; total: number }> {
        const resolved: ResolvedListQuery = {
            ...filters,
            entityTypes: resolveEntityTypes(filters),
        };

        if (resolved.sync_state === "missing") {
            return this.listMissing(resolved);
        }

        if (needsCanonicalJoinForList(resolved)) {
            return this.listIndexedWithCanonicalJoin(resolved);
        }

        return this.listIndexedFast(resolved);
    }

    private async listIndexedFast(
        resolved: ResolvedListQuery,
    ): Promise<{ items: SearchDocumentRow[]; total: number }> {
        const offset = (resolved.page - 1) * resolved.pageSize;
        const documentConditions = buildIndexedDocumentFilters(resolved);
        const where = buildWhereClause(documentConditions);
        const sortSql = buildSortSql(resolved, false);

        const [pageRows, totalRows] = await Promise.all([
            this.prisma.$queryRaw<IndexedDocumentPageRow[]>(Prisma.sql`
                SELECT ${INDEXED_DOCUMENT_SELECT}
                FROM search.search_documents d
                ${where}
                ORDER BY ${sortSql}
                LIMIT ${resolved.pageSize} OFFSET ${offset}
            `),
            this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
                SELECT count(*)::int AS total
                FROM search.search_documents d
                ${where}
            `),
        ]);

        if (pageRows.length === 0) {
            return { items: [], total: totalRows[0]?.total ?? 0 };
        }

        const aliasCounts = await this.fetchAliasCountsForEntityKeys(pageRows);

        return {
            items: enrichIndexedDocumentRows(pageRows, aliasCounts, null),
            total: totalRows[0]?.total ?? 0,
        };
    }

    private async listIndexedWithCanonicalJoin(
        resolved: ResolvedListQuery,
    ): Promise<{ items: SearchDocumentRow[]; total: number }> {
        const offset = (resolved.page - 1) * resolved.pageSize;
        const documentConditions = buildIndexedDocumentFilters(resolved);
        const canonicalUnion = buildCanonicalFreshnessUnionSql(resolved.entityTypes);

        if (resolved.sync_state === "current") {
            documentConditions.push(buildIndexedSyncStateFilterSql("current"));
        } else if (resolved.sync_state === "stale") {
            documentConditions.push(buildIndexedSyncStateFilterSql("stale"));
        } else if (resolved.sync_state === "ghost") {
            documentConditions.push(buildIndexedSyncStateFilterSql("ghost"));
        }

        const where = buildWhereClause(documentConditions);
        const sortSql = buildSortSql(resolved, false);

        const baseFrom = Prisma.sql`
            FROM search.search_documents d
            LEFT JOIN (
                ${canonicalUnion}
            ) c ON c.entity_type = d.entity_type AND c.entity_id = d.entity_id
        `;

        const [items, totalRows] = await Promise.all([
            this.prisma.$queryRaw<SearchDocumentRow[]>(Prisma.sql`
                SELECT
                    d.id AS search_document_id,
                    d.entity_type,
                    d.entity_id,
                    d.public_id,
                    d.display_name,
                    d.primary_name_my,
                    d.primary_name_en,
                    d.primary_name_und,
                    nullif(btrim(coalesce(d.address_parts->>'mode', d.category_code, '')), '') AS transport_mode,
                    nullif(btrim(coalesce(d.address_parts->>'review_status', '')), '') AS review_status,
                    d.is_verified,
                    d.is_public,
                    d.is_active,
                    d.importance_score::double precision AS importance_score,
                    d.confidence_score::double precision AS confidence_score,
                    d.indexed_at,
                    d.source_updated_at,
                    c.source_updated_at AS canonical_source_updated_at,
                    0 AS alias_count,
                    ${buildIndexedSyncStateSql()} AS sync_state
                ${baseFrom}
                ${where}
                ORDER BY ${sortSql}
                LIMIT ${resolved.pageSize} OFFSET ${offset}
            `),
            this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
                SELECT count(*)::int AS total
                ${baseFrom}
                ${where}
            `),
        ]);

        if (items.length === 0) {
            return { items, total: totalRows[0]?.total ?? 0 };
        }

        const aliasCounts = await this.fetchAliasCountsForEntityKeys(items);
        return {
            items: items.map((row) => ({
                ...row,
                alias_count: aliasCounts.get(entityKey(row.entity_type, row.entity_id)) ?? 0,
            })),
            total: totalRows[0]?.total ?? 0,
        };
    }

    private async fetchAliasCountsForEntityKeys(
        keys: readonly SearchDocumentEntityKey[],
    ): Promise<Map<string, number>> {
        if (keys.length === 0) {
            return new Map();
        }

        const tuples = keys.map(
            (key) => Prisma.sql`(${key.entity_type}, ${key.entity_id})`,
        );

        const rows = await this.prisma.$queryRaw<AliasCountRow[]>(Prisma.sql`
            SELECT entity_type, entity_id, count(*)::int AS alias_count
            FROM search.search_aliases
            WHERE is_active = true
              AND (entity_type, entity_id) IN (${Prisma.join(tuples)})
            GROUP BY entity_type, entity_id
        `);

        return new Map(
            rows.map((row) => [entityKey(row.entity_type, row.entity_id), row.alias_count]),
        );
    }

    private async listMissing(resolved: ResolvedListQuery): Promise<{ items: SearchDocumentRow[]; total: number }> {
        const offset = (resolved.page - 1) * resolved.pageSize;
        const canonicalUnion = buildCanonicalInventoryUnionSql(resolved.entityTypes);
        const conditions = buildMissingDocumentFilters(resolved);
        conditions.push(Prisma.sql`d.id IS NULL`);

        const where = Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`;
        const sortSql = buildSortSql(resolved, true);

        const baseFrom = Prisma.sql`
            FROM (
                ${canonicalUnion}
            ) c
            LEFT JOIN search.search_documents d
                ON d.entity_type = c.entity_type
               AND d.entity_id = c.entity_id
        `;

        const items = await this.prisma.$queryRaw<SearchDocumentRow[]>(Prisma.sql`
            SELECT
                d.id AS search_document_id,
                c.entity_type,
                c.entity_id,
                c.public_id,
                c.display_name,
                c.primary_name_my,
                c.primary_name_en,
                c.primary_name_und,
                nullif(btrim(coalesce(c.address_parts->>'mode', '')), '') AS transport_mode,
                nullif(btrim(coalesce(c.address_parts->>'review_status', '')), '') AS review_status,
                coalesce(c.is_verified, false) AS is_verified,
                coalesce(d.is_public, false) AS is_public,
                coalesce(d.is_active, false) AS is_active,
                coalesce(c.importance_score, 0)::double precision AS importance_score,
                coalesce(c.confidence_score, 0)::double precision AS confidence_score,
                d.indexed_at,
                d.source_updated_at,
                c.source_updated_at AS canonical_source_updated_at,
                0 AS alias_count,
                'missing'::text AS sync_state
            ${baseFrom}
            ${where}
            ORDER BY ${sortSql}
            LIMIT ${resolved.pageSize} OFFSET ${offset}
        `);

        const totalRows = await this.prisma.$queryRaw<Array<{ total: number }>>(Prisma.sql`
            SELECT count(*)::int AS total
            ${baseFrom}
            ${where}
        `);

        return { items, total: totalRows[0]?.total ?? 0 };
    }
}

/** Expand legacy transport entity filters for alias lookup consistency. */
export function expandSearchDocumentEntityTypeFilter(entityType: string): string[] {
    return expandTransportSearchEntityTypeFilter(entityType);
}

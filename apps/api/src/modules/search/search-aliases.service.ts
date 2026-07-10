import type { PrismaClient } from "@prisma/client";

import {
    isSearchAliasUniqueViolation,
    SearchAliasesRepository,
    type SearchAliasAuditContext,
    type SearchAliasRow,
} from "./search-aliases.repo.js";
import type {
    CreateSearchAliasBody,
    ListSearchAliasesQuery,
    UpdateSearchAliasBody,
} from "./search-aliases.schema.js";
import { isSearchAliasEntityType } from "./search-aliases.schema.js";
import { refreshSearchAliasesForEntities } from "./unified-search-sync.js";
import { normalizeTransportSearchEntityType } from "./transport-search-entity.js";

export class SearchAliasesError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "SearchAliasesError";
    }
}

export type SearchAliasActor = {
    publicId: string;
    ipAddress: string | null;
    userAgent: string | null;
};

export type SearchAliasIndexSync = {
    ok: boolean;
    names_added: number;
    names_removed: number;
    documents_updated: number;
    error?: string;
};

export type SearchAliasResponse = {
    id: string;
    entity_type: string;
    entity_id: string;
    alias_text: string;
    normalized_alias: string;
    language_code: string | null;
    alias_type: string;
    source: string | null;
    is_active: boolean;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    indexed_entity: {
        display_name: string;
        public_id: string;
    } | null;
    index_sync?: SearchAliasIndexSync;
};

export type SearchAliasListResponse = {
    items: SearchAliasResponse[];
    total: number;
    page: number;
    pageSize: number;
    sort: ListSearchAliasesQuery["sort"];
    order: ListSearchAliasesQuery["order"];
};

function serializeAlias(
    row: SearchAliasRow,
    indexSync?: SearchAliasIndexSync,
): SearchAliasResponse {
    return {
        id: row.id.toString(),
        entity_type: row.entity_type,
        entity_id: row.entity_id.toString(),
        alias_text: row.alias_text,
        normalized_alias: row.normalized_alias,
        language_code: row.language_code,
        alias_type: row.alias_type,
        source: row.source,
        is_active: row.is_active,
        created_by: row.created_by?.toString() ?? null,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
        indexed_entity:
            row.has_indexed_entity && row.indexed_display_name && row.indexed_public_id
                ? {
                      display_name: row.indexed_display_name,
                      public_id: row.indexed_public_id,
                  }
                : null,
        ...(indexSync ? { index_sync: indexSync } : {}),
    };
}

function toIndexSync(result: {
    ok: boolean;
    result?: { names_added: number; names_removed: number; documents_updated: number };
    error?: string;
}): SearchAliasIndexSync {
    return {
        ok: result.ok,
        names_added: result.result?.names_added ?? 0,
        names_removed: result.result?.names_removed ?? 0,
        documents_updated: result.result?.documents_updated ?? 0,
        ...(result.error ? { error: result.error } : {}),
    };
}

function snapshot(row: SearchAliasRow): Record<string, unknown> {
    return {
        id: row.id.toString(),
        entity_type: row.entity_type,
        entity_id: row.entity_id.toString(),
        alias_text: row.alias_text,
        normalized_alias: row.normalized_alias,
        language_code: row.language_code,
        alias_type: row.alias_type,
        source: row.source,
        is_active: row.is_active,
    };
}

export class SearchAliasesService {
    constructor(
        private readonly repo: SearchAliasesRepository,
        private readonly prisma: PrismaClient,
    ) {}

    async list(filters: ListSearchAliasesQuery): Promise<SearchAliasListResponse> {
        const result = await this.repo.list(filters);
        return {
            items: result.items.map((row) => serializeAlias(row)),
            total: result.total,
            page: filters.page,
            pageSize: filters.pageSize,
            sort: filters.sort,
            order: filters.order,
        };
    }

    async create(
        actor: SearchAliasActor,
        body: CreateSearchAliasBody,
    ): Promise<SearchAliasResponse> {
        const entityType = this.resolveEntityType(body.entity_type);
        await this.assertIndexedEntity(entityType, body.entity_id);

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        const audit: SearchAliasAuditContext = {
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        };

        let created: SearchAliasRow;
        try {
            created = await this.repo.create({
                ...body,
                entityType,
                createdBy: actorUserId,
            });
        } catch (error) {
            if (isSearchAliasUniqueViolation(error)) {
                throw new SearchAliasesError(
                    "An active alias with the same normalized text and language already exists for this entity",
                    409,
                );
            }
            throw error;
        }

        const sync = await this.refreshIndexedAliases(entityType, body.entity_id);

        await this.repo.insertAudit({
            actionType: "search_alias.create",
            aliasId: created.id,
            before: null,
            after: snapshot(created),
            audit,
        });

        return serializeAlias(created, toIndexSync(sync));
    }

    async update(
        actor: SearchAliasActor,
        id: bigint,
        body: UpdateSearchAliasBody,
    ): Promise<SearchAliasResponse> {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new SearchAliasesError("Search alias not found", 404);
        }

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        const audit: SearchAliasAuditContext = {
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        };

        let updated: SearchAliasRow | null;
        try {
            updated = await this.repo.update(id, body);
        } catch (error) {
            if (isSearchAliasUniqueViolation(error)) {
                throw new SearchAliasesError(
                    "An active alias with the same normalized text and language already exists for this entity",
                    409,
                );
            }
            throw error;
        }

        if (!updated) {
            throw new SearchAliasesError("Search alias not found", 404);
        }

        const sync = await this.refreshIndexedAliases(updated.entity_type, updated.entity_id);

        await this.repo.insertAudit({
            actionType: "search_alias.update",
            aliasId: updated.id,
            before: snapshot(existing),
            after: snapshot(updated),
            audit,
        });

        return serializeAlias(updated, toIndexSync(sync));
    }

    async disable(actor: SearchAliasActor, id: bigint): Promise<SearchAliasResponse> {
        const existing = await this.repo.findById(id);
        if (!existing) {
            throw new SearchAliasesError("Search alias not found", 404);
        }
        if (!existing.is_active) {
            return serializeAlias(existing);
        }

        const actorUserId = await this.repo.findUserIdByPublicId(actor.publicId);
        const audit: SearchAliasAuditContext = {
            actorUserId,
            ipAddress: actor.ipAddress,
            userAgent: actor.userAgent,
        };

        const updated = await this.repo.disable(id);
        if (!updated) {
            throw new SearchAliasesError("Search alias not found", 404);
        }

        const sync = await this.refreshIndexedAliases(updated.entity_type, updated.entity_id);

        await this.repo.insertAudit({
            actionType: "search_alias.disable",
            aliasId: updated.id,
            before: snapshot(existing),
            after: snapshot(updated),
            audit,
        });

        return serializeAlias(updated, toIndexSync(sync));
    }

    private resolveEntityType(input: string): string {
        const normalized = normalizeTransportSearchEntityType(input);
        if (!isSearchAliasEntityType(normalized)) {
            throw new SearchAliasesError(`Unsupported searchable entity_type: ${input}`, 400);
        }
        return normalized;
    }

    private async assertIndexedEntity(entityType: string, entityId: bigint): Promise<void> {
        const indexed = await this.repo.findIndexedEntity(entityType, entityId);
        if (!indexed) {
            throw new SearchAliasesError(
                "Entity is not currently indexed for public search. Rebuild or sync the search document before adding aliases.",
                400,
            );
        }
    }

    private async refreshIndexedAliases(
        entityType: string,
        entityId: bigint,
    ): Promise<{ ok: boolean; result?: { names_added: number; names_removed: number; documents_updated: number }; error?: string }> {
        return refreshSearchAliasesForEntities(this.prisma, entityType, [entityId]);
    }
}

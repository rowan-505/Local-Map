import {
    FailedSearchesRepository,
    type FailedSearchRow,
} from "./failed-searches.repo.js";
import type {
    ListFailedSearchesQuery,
    UpdateFailedSearchBody,
} from "./failed-searches.schema.js";

export class FailedSearchesError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "FailedSearchesError";
    }
}

export type FailedSearchLinkedAlias = {
    id: string;
    alias_text: string;
};

export type FailedSearchLinkedEntity = {
    entity_type: string;
    entity_id: string;
    display_name: string;
    public_id: string;
};

export type FailedSearchItem = {
    id: string;
    query: string;
    normalized_query: string | null;
    language: string | null;
    category: string | null;
    transport_type: string | null;
    transport_mode: string | null;
    entity_types_key: string | null;
    types: string[] | null;
    area_context_key: string | null;
    result_count: number;
    occurrence_count: number;
    first_seen_at: string;
    last_seen_at: string;
    is_resolved: boolean;
    resolved_at: string | null;
    resolution_type: string | null;
    linked_alias: FailedSearchLinkedAlias | null;
    linked_entity: FailedSearchLinkedEntity | null;
};

export type FailedSearchListResponse = {
    items: FailedSearchItem[];
    total: number;
    page: number;
    pageSize: number;
    sort: ListFailedSearchesQuery["sort"];
    order: ListFailedSearchesQuery["order"];
};

function serializeRow(row: FailedSearchRow): FailedSearchItem {
    const linkedAlias =
        row.linked_alias_id !== null && row.linked_alias_text
            ? {
                  id: row.linked_alias_id.toString(),
                  alias_text: row.linked_alias_text,
              }
            : null;

    const linkedEntity =
        row.linked_entity_type &&
        row.linked_entity_id !== null &&
        row.linked_entity_display_name &&
        row.linked_entity_public_id
            ? {
                  entity_type: row.linked_entity_type,
                  entity_id: row.linked_entity_id.toString(),
                  display_name: row.linked_entity_display_name,
                  public_id: row.linked_entity_public_id,
              }
            : null;

    return {
        id: row.id.toString(),
        query: row.query,
        normalized_query: row.normalized_query,
        language: row.lang,
        category: row.category,
        transport_type: row.transport_type,
        transport_mode: row.transport_mode,
        entity_types_key: row.entity_types_key,
        types: row.types,
        area_context_key: row.area_context_key,
        result_count: row.result_count,
        occurrence_count: row.occurrence_count,
        first_seen_at: row.first_seen_at.toISOString(),
        last_seen_at: row.last_seen_at.toISOString(),
        is_resolved: row.resolved_at !== null,
        resolved_at: row.resolved_at?.toISOString() ?? null,
        resolution_type: row.resolution_type,
        linked_alias: linkedAlias,
        linked_entity: linkedEntity,
    };
}

export class FailedSearchesService {
    constructor(private readonly repo: FailedSearchesRepository) {}

    async list(filters: ListFailedSearchesQuery): Promise<FailedSearchListResponse> {
        const result = await this.repo.list(filters);
        return {
            items: result.items.map(serializeRow),
            total: result.total,
            page: filters.page,
            pageSize: filters.pageSize,
            sort: filters.sort,
            order: filters.order,
        };
    }

    async getById(id: string): Promise<FailedSearchItem> {
        const row = await this.repo.findById(BigInt(id));
        if (!row) {
            throw new FailedSearchesError("Failed search log not found.", 404);
        }
        return serializeRow(row);
    }

    async update(id: string, body: UpdateFailedSearchBody): Promise<FailedSearchItem> {
        const numericId = BigInt(id);
        const existing = await this.repo.findById(numericId);
        if (!existing) {
            throw new FailedSearchesError("Failed search log not found.", 404);
        }

        if (body.action === "resolve") {
            if (existing.resolved_at !== null) {
                throw new FailedSearchesError("Failed search is already resolved.", 409);
            }
            if (body.resolution_type === "alias") {
                if (!body.linked_alias_id) {
                    throw new FailedSearchesError(
                        "linked_alias_id is required when resolution_type is alias.",
                        400,
                    );
                }
                const aliasExists = await this.repo.aliasExists(BigInt(body.linked_alias_id));
                if (!aliasExists) {
                    throw new FailedSearchesError("Linked alias was not found.", 404);
                }
            } else if (body.linked_alias_id) {
                throw new FailedSearchesError(
                    "linked_alias_id is only allowed when resolution_type is alias.",
                    400,
                );
            }

            const updated = await this.repo.resolve(numericId, body);
            if (!updated || updated.resolved_at === null) {
                throw new FailedSearchesError("Failed search log not found.", 404);
            }
            return serializeRow(updated);
        }

        if (existing.resolved_at === null) {
            throw new FailedSearchesError("Failed search is not resolved.", 409);
        }

        const dedupeKey = await this.repo.getDedupeKey(numericId);
        if (dedupeKey) {
            const conflictId = await this.repo.findOpenByDedupeKey(dedupeKey, numericId);
            if (conflictId !== null) {
                throw new FailedSearchesError(
                    "An unresolved log with the same query context already exists.",
                    409,
                );
            }
        }

        const updated = await this.repo.reopen(numericId);
        if (!updated || updated.resolved_at !== null) {
            throw new FailedSearchesError("Failed search log not found.", 404);
        }
        return serializeRow(updated);
    }
}

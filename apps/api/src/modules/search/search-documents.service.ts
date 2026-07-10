import {
    SearchDocumentsRepository,
    type SearchDocumentRow,
} from "./search-documents.repo.js";
import type { ListSearchDocumentsQuery } from "./search-documents.schema.js";
import type { SearchDocumentSyncState } from "./search-canonical-source.js";

export class SearchDocumentsError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
    ) {
        super(message);
        this.name = "SearchDocumentsError";
    }
}

export type SearchDocumentListItem = {
    search_document_id: string | null;
    entity_type: string;
    entity_id: string;
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
    indexed_at: string | null;
    source_updated_at: string | null;
    canonical_source_updated_at: string | null;
    alias_count: number;
    sync_state: SearchDocumentSyncState;
};

export type SearchDocumentListResponse = {
    items: SearchDocumentListItem[];
    total: number;
    page: number;
    pageSize: number;
    sort: ListSearchDocumentsQuery["sort"];
    order: ListSearchDocumentsQuery["order"];
};

function serializeRow(row: SearchDocumentRow): SearchDocumentListItem {
    return {
        search_document_id: row.search_document_id?.toString() ?? null,
        entity_type: row.entity_type,
        entity_id: row.entity_id.toString(),
        public_id: row.public_id,
        display_name: row.display_name,
        primary_name_my: row.primary_name_my,
        primary_name_en: row.primary_name_en,
        primary_name_und: row.primary_name_und,
        transport_mode: row.transport_mode,
        review_status: row.review_status,
        is_verified: row.is_verified,
        is_public: row.is_public,
        is_active: row.is_active,
        importance_score: row.importance_score,
        confidence_score: row.confidence_score,
        indexed_at: row.indexed_at?.toISOString() ?? null,
        source_updated_at: row.source_updated_at?.toISOString() ?? null,
        canonical_source_updated_at: row.canonical_source_updated_at?.toISOString() ?? null,
        alias_count: row.alias_count,
        sync_state: row.sync_state,
    };
}

export class SearchDocumentsService {
    constructor(private readonly repo: SearchDocumentsRepository) {}

    async list(filters: ListSearchDocumentsQuery): Promise<SearchDocumentListResponse> {
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
}

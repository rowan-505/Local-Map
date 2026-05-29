import {
    IMPORT_TRANSPORT_FAMILIES,
    IMPORT_TRANSPORT_MODE_TYPES,
    IMPORT_TRANSPORT_SORT_OPTIONS,
    type ImportTransportFamily,
} from "./import-transport.config.js";
import {
    emptyImportTransportCandidatesList,
    emptyImportTransportSummary,
} from "./import-transport-empty-reads.js";
import { ImportTransportCandidateNotFoundError } from "./import-transport.errors.js";
import { ImportTransportRepository } from "./import-transport.repo.js";
import type { ImportTransportBatchesListQueryInput } from "./import-transport.schema.js";
import type {
    ImportTransportBatchesListResponse,
    ImportTransportCandidateListItem,
    ImportTransportCandidateRowDb,
    ImportTransportCandidatesListResponse,
    ImportTransportListQuery,
    ImportTransportOptionsResponse,
    ImportTransportScopeQuery,
    ImportTransportSummaryResponse,
} from "./import-transport.types.js";

function toIso(value: Date | string | null | undefined): string | null {
    if (value == null) {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value);
}

function toNumber(value: number | string | null | undefined): number | null {
    if (value == null || value === "") {
        return null;
    }
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
    if (value == null) {
        return null;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function mapCandidateRow(row: ImportTransportCandidateRowDb): ImportTransportCandidateListItem {
    const { id, import_batch_id: _batchId, geometry, ...rest } = row;
    return {
        ...rest,
        id: id.toString(),
        external_id: row.external_id == null ? null : String(row.external_id),
        review_status: String(row.review_status ?? row.match_status ?? "pending"),
        review_decision: row.review_decision == null ? null : String(row.review_decision),
        promotion_status: row.promotion_status == null ? null : String(row.promotion_status),
        validation_status: row.validation_status == null ? null : String(row.validation_status),
        confidence_score: toNumber(row.confidence_score),
        review_note: row.review_note == null ? null : String(row.review_note),
        normalized_data: jsonRecord(row.normalized_data),
        source_refs: jsonRecord(row.source_refs),
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
        ...(geometry !== undefined ? { geometry } : {}),
    };
}

export class ImportTransportService {
    constructor(private readonly repo: ImportTransportRepository) {}

    async getSummary(scopeQuery: ImportTransportScopeQuery): Promise<ImportTransportSummaryResponse> {
        const scope = await this.repo.tryResolveScope(scopeQuery);
        if (!scope) {
            return emptyImportTransportSummary(scopeQuery);
        }
        const [families, validation] = await Promise.all([
            Promise.all(
                IMPORT_TRANSPORT_FAMILIES.map((family) =>
                    this.repo.fetchFamilySummaryMetrics(family, scope.importBatchId)
                )
            ),
            this.repo.fetchValidationIssueCounts(scope.importBatchId),
        ]);

        const rollup = families.reduce(
            (acc, family) => {
                acc.total_candidates += family.total;
                acc.pending += family.pending;
                acc.ready_for_promotion += family.approved;
                acc.promoted += family.promoted;
                return acc;
            },
            {
                total_candidates: 0,
                pending: 0,
                ready_for_promotion: 0,
                promoted: 0,
            }
        );

        return {
            import_batch_id: scope.importBatchId.toString(),
            source_snapshot_version: scope.sourceSnapshotVersion,
            selected_by: scope.selectedBy,
            batch_name: scope.batchName,
            import_status: scope.importStatus,
            validation_status: scope.validationStatus,
            families,
            validation,
            rollup,
        };
    }

    async listBatches(input: ImportTransportBatchesListQueryInput): Promise<ImportTransportBatchesListResponse> {
        const result = await this.repo.listBatches(input);
        return {
            items: result.items,
            total: result.total,
            limit: input.limit,
            offset: input.offset,
        };
    }

    getOptions(): ImportTransportOptionsResponse {
        return {
            families: [...IMPORT_TRANSPORT_FAMILIES],
            mode_types: [...IMPORT_TRANSPORT_MODE_TYPES],
            sort_options: IMPORT_TRANSPORT_SORT_OPTIONS.map((value) => ({
                value,
                label: value.replace(/_/g, " "),
            })),
            review_statuses: [
                "pending",
                "needs_review",
                "needs_more_review",
                "approved",
                "rejected",
                "ignored",
                "promoted",
                "promotion_failed",
            ],
            review_decisions: ["approved", "rejected", "needs_more_review", "ignored", "merged"],
            promotion_statuses: ["ready", "batched", "promoted", "promotion_failed", "blocked"],
            validation_statuses: ["not_validated", "valid", "warning", "blocked"],
        };
    }

    async listCandidates(
        family: ImportTransportFamily,
        query: ImportTransportListQuery
    ): Promise<ImportTransportCandidatesListResponse> {
        const scope = await this.repo.tryResolveScope(query);
        if (!scope) {
            return emptyImportTransportCandidatesList(query);
        }

        const { rows, hasMore } = await this.repo.listCandidates(family, scope, query);
        const total =
            query.include_total === true
                ? await this.repo.countCandidates(family, scope.importBatchId, query)
                : undefined;

        return {
            items: rows.map(mapCandidateRow),
            total,
            has_more: hasMore,
            import_batch_id: scope.importBatchId.toString(),
            source_snapshot_version: scope.sourceSnapshotVersion,
            selected_by: scope.selectedBy,
        };
    }

    async getCandidateById(
        family: ImportTransportFamily,
        id: bigint,
        query: ImportTransportScopeQuery & { include_geometry?: boolean }
    ): Promise<ImportTransportCandidateListItem> {
        const scope = await this.repo.resolveScope(query);
        const row = await this.repo.getCandidateById(
            family,
            scope,
            id,
            query.include_geometry === true
        );
        if (!row) {
            throw new ImportTransportCandidateNotFoundError(family, id.toString());
        }
        return mapCandidateRow(row);
    }
}

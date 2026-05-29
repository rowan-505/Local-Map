import { IMPORT_TRANSPORT_FAMILIES, type ImportTransportFamily } from "./import-transport.config.js";
import { ImportTransportCandidateNotFoundError, ImportTransportValidationWarningNoteRequiredError } from "./import-transport.errors.js";
import { ImportTransportRepository } from "./import-transport.repo.js";
import type { ImportTransportScopeQuery } from "./import-transport.types.js";
import {
    partitionValidationIssues,
    resolveValidationStatusFromIssues,
    validationIssuesRequireConfirmation,
} from "./import-transport-validation-rules.js";
import { ImportTransportValidationRepository } from "./import-transport-validation.repo.js";
import type {
    ImportTransportBatchValidationResult,
    ImportTransportValidateCandidateResult,
    ImportTransportValidationIssuesListResponse,
} from "./import-transport-validation.types.js";

export class ImportTransportValidationService {
    constructor(
        private readonly repo: ImportTransportRepository,
        private readonly validationRepo: ImportTransportValidationRepository
    ) {}

    async validateCandidate(
        family: ImportTransportFamily,
        candidateId: bigint,
        scopeQuery: ImportTransportScopeQuery,
        options: { confirm_warnings?: boolean; review_note?: string | null } = {}
    ): Promise<ImportTransportValidateCandidateResult> {
        const scope = await this.repo.resolveScope(scopeQuery);
        const existing = await this.repo.getCandidateById(family, scope, candidateId, false);
        if (!existing) {
            throw new ImportTransportCandidateNotFoundError(family, candidateId.toString());
        }

        const draftIssues = await this.validationRepo.evaluateCandidate(
            family,
            scope.importBatchId,
            candidateId
        );
        const validationStatus = resolveValidationStatusFromIssues(draftIssues);
        const { errors, warnings } = partitionValidationIssues(draftIssues);

        if (
            validationIssuesRequireConfirmation(validationStatus) &&
            options.confirm_warnings === true &&
            !options.review_note?.trim()
        ) {
            throw new ImportTransportValidationWarningNoteRequiredError();
        }

        const entitySourceId = await this.validationRepo.getCandidateSourceId(
            family,
            scope.importBatchId,
            candidateId
        );

        const reviewNote =
            validationIssuesRequireConfirmation(validationStatus) && options.confirm_warnings
                ? options.review_note?.trim() ?? null
                : null;

        const persistedIssues = await this.validationRepo.persistValidationResult({
            family,
            importBatchId: scope.importBatchId,
            candidateId,
            entitySourceId,
            validationStatus,
            issues: draftIssues,
            reviewNote,
        });

        return {
            family,
            candidate_id: candidateId.toString(),
            validation_status: validationStatus,
            issues: persistedIssues,
            errors,
            warnings,
            requires_confirmation: validationIssuesRequireConfirmation(validationStatus),
            promotion_blocked: validationStatus === "blocked" || validationStatus === "not_validated",
        };
    }

    async validateBatch(
        scopeQuery: ImportTransportScopeQuery,
        input: {
            families?: ImportTransportFamily[] | undefined;
            confirm_warnings?: boolean | undefined;
            review_note?: string | null | undefined;
        } = {}
    ): Promise<ImportTransportBatchValidationResult> {
        const scope = await this.repo.resolveScope(scopeQuery);
        const families = input.families?.length ? input.families : [...IMPORT_TRANSPORT_FAMILIES];

        const resultsByFamily = Object.fromEntries(
            IMPORT_TRANSPORT_FAMILIES.map((family) => [
                family,
                { validated_count: 0, valid_count: 0, warning_count: 0, blocked_count: 0 },
            ])
        ) as ImportTransportBatchValidationResult["results_by_family"];

        let validatedCount = 0;
        let validCount = 0;
        let warningCount = 0;
        let blockedCount = 0;

        for (const family of families) {
            const ids = await this.validationRepo.listCandidateIds(family, scope.importBatchId);
            for (const id of ids) {
                const result = await this.validateCandidate(family, id, scopeQuery, {
                    confirm_warnings: input.confirm_warnings,
                    review_note: input.review_note,
                });
                validatedCount += 1;
                resultsByFamily[family].validated_count += 1;
                if (result.validation_status === "valid") {
                    validCount += 1;
                    resultsByFamily[family].valid_count += 1;
                } else if (result.validation_status === "warning") {
                    warningCount += 1;
                    resultsByFamily[family].warning_count += 1;
                } else if (result.validation_status === "blocked") {
                    blockedCount += 1;
                    resultsByFamily[family].blocked_count += 1;
                }
            }
        }

        return {
            import_batch_id: scope.importBatchId.toString(),
            families,
            validated_count: validatedCount,
            valid_count: validCount,
            warning_count: warningCount,
            blocked_count: blockedCount,
            results_by_family: resultsByFamily,
        };
    }

    async listIssues(
        scopeQuery: ImportTransportScopeQuery,
        query: {
            entity_kind?: string | undefined;
            entity_id?: number | undefined;
            severity?: string | undefined;
            limit?: number | undefined;
            offset?: number | undefined;
        }
    ): Promise<ImportTransportValidationIssuesListResponse> {
        const scope = await this.repo.resolveScope(scopeQuery);
        const limit = query.limit ?? 100;
        const offset = query.offset ?? 0;
        const entityId = query.entity_id != null ? BigInt(query.entity_id) : undefined;

        const result = await this.validationRepo.listIssues({
            importBatchId: scope.importBatchId,
            entityKind: query.entity_kind,
            entityId,
            severity: query.severity,
            limit,
            offset,
        });

        return {
            items: result.items,
            total: result.total,
            limit,
            offset,
        };
    }
}

import type { CoreReviewListQueryParsed } from "../core-review.schema.js";
import { resolveCoreReviewListStatus } from "../core-review-list-status.js";
import { resolveCoreReviewSortBy, type CoreReviewEntityDefinition } from "../core-review.entity-registry.js";
import { buildDetailResponse, buildListResponse, pageToOffset } from "../core-review.pagination.js";
import { isSettlementTypeCode } from "./settlements.constants.js";
import {
    CoreReviewSettlementsRepository,
    serializeCoreReviewSettlement,
    serializeSettlementDuplicateWarning,
    type CoreReviewSettlementsListParams,
    type SettlementDuplicateWarningParams,
} from "./settlements.repo.js";

function toSettlementListParams(
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed,
): CoreReviewSettlementsListParams {
    const settlementTypeRaw = query.settlementType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
    return {
        limit: query.pageSize,
        offset: pageToOffset(query.page, query.pageSize),
        search: query.search,
        sortBy: resolveCoreReviewSortBy(def, query.sortBy),
        sortOrder: query.sortOrder,
        verificationStatus: query.verificationStatus,
        townshipId: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        settlementType: settlementTypeRaw && isSettlementTypeCode(settlementTypeRaw) ? settlementTypeRaw : undefined,
        status: resolveCoreReviewListStatus(query),
    };
}

export async function listCoreReviewSettlements(
    repo: CoreReviewSettlementsRepository,
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed,
) {
    const params = toSettlementListParams(def, query);
    const [rows, total] = await Promise.all([
        repo.listSettlements(params),
        repo.countSettlements(params),
    ]);

    return buildListResponse({
        data: rows.map(serializeCoreReviewSettlement),
        page: query.page,
        pageSize: query.pageSize,
        total,
        filters: {
            search: query.search,
            status: resolveCoreReviewListStatus(query),
            verification_status: query.verificationStatus,
            adminAreaId: query.adminAreaId,
            settlementType: params.settlementType,
        },
        meta: { entity: "settlements", sortBy: params.sortBy, sortOrder: params.sortOrder },
    });
}

export async function getCoreReviewSettlementDetail(
    repo: CoreReviewSettlementsRepository,
    id: string,
    options: { anyStatus?: boolean } = {},
) {
    const row = await repo.getSettlementById(id, options);
    if (!row) {
        return null;
    }
    return buildDetailResponse(serializeCoreReviewSettlement(row));
}

export async function listSettlementDuplicateWarnings(
    repo: CoreReviewSettlementsRepository,
    params: SettlementDuplicateWarningParams,
) {
    const rows = await repo.findDuplicateWarnings(params);
    return {
        data: rows.map(serializeSettlementDuplicateWarning),
        meta: { warningOnly: true },
    };
}

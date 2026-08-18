import type { CoreReviewListQueryParsed } from "../core-review.schema.js";
import { resolveCoreReviewListStatus } from "../core-review-list-status.js";
import { resolveCoreReviewSortBy, type CoreReviewEntityDefinition } from "../core-review.entity-registry.js";
import { buildDetailResponse, buildListResponse, pageToOffset } from "../core-review.pagination.js";
import {
    CoreReviewLandAreasRepository,
    serializeCoreReviewLandArea,
    type CoreReviewLandAreasListParams,
} from "./land-areas.repo.js";

function toLandAreaListParams(
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
): CoreReviewLandAreasListParams {
    const detailLevel = query.detailLevel?.trim();
    return {
        limit: query.pageSize,
        offset: pageToOffset(query.page, query.pageSize),
        search: query.search,
        sortBy: resolveCoreReviewSortBy(def, query.sortBy),
        sortOrder: query.sortOrder,
        verificationStatus: query.verificationStatus,
        adminAreaId: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        landAreaClassId: query.landAreaClassId ? BigInt(query.landAreaClassId) : undefined,
        detailLevel:
            detailLevel === "zone" || detailLevel === "parcel" ? detailLevel : undefined,
        cropCode: query.cropCode?.trim() || undefined,
        status: resolveCoreReviewListStatus(query),
    };
}

export async function listCoreReviewLandAreas(
    repo: CoreReviewLandAreasRepository,
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
) {
    const params = toLandAreaListParams(def, query);
    const [rows, total] = await Promise.all([repo.listLandAreas(params), repo.countLandAreas(params)]);

    return buildListResponse({
        data: rows.map(serializeCoreReviewLandArea),
        page: query.page,
        pageSize: query.pageSize,
        total,
        filters: {
            search: query.search,
            status: resolveCoreReviewListStatus(query),
            verification_status: query.verificationStatus,
            adminAreaId: query.adminAreaId,
            landAreaClassId: query.landAreaClassId,
            detailLevel: query.detailLevel,
            cropCode: query.cropCode,
        },
        meta: { entity: "land-areas", sortBy: params.sortBy, sortOrder: params.sortOrder },
    });
}

export async function getCoreReviewLandAreaDetail(
    repo: CoreReviewLandAreasRepository,
    id: string,
    options: { anyStatus?: boolean } = {}
) {
    const row = await repo.getLandAreaById(id, options);
    if (!row) {
        return null;
    }
    return buildDetailResponse(serializeCoreReviewLandArea(row));
}

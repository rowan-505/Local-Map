import type { CoreReviewListQueryParsed } from "../core-review.schema.js";
import { resolveCoreReviewListStatus } from "../core-review-list-status.js";
import { resolveCoreReviewSortBy, type CoreReviewEntityDefinition } from "../core-review.entity-registry.js";
import { buildDetailResponse, buildListResponse, pageToOffset } from "../core-review.pagination.js";
import {
    CoreReviewLanduseRepository,
    serializeCoreReviewLanduse,
    type CoreReviewLanduseListParams,
} from "./landuse.repo.js";

function toLanduseListParams(
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
): CoreReviewLanduseListParams {
    const detailLevel = query.detailLevel?.trim();
    return {
        limit: query.pageSize,
        offset: pageToOffset(query.page, query.pageSize),
        search: query.search,
        sortBy: resolveCoreReviewSortBy(def, query.sortBy),
        sortOrder: query.sortOrder,
        isVerified: query.isVerified,
        adminAreaId: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        landuseClassId: query.landuseClassId ? BigInt(query.landuseClassId) : undefined,
        detailLevel:
            detailLevel === "zone" || detailLevel === "parcel" ? detailLevel : undefined,
        cropCode: query.cropCode?.trim() || undefined,
        status: resolveCoreReviewListStatus(query),
    };
}

export async function listCoreReviewLanduse(
    repo: CoreReviewLanduseRepository,
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
) {
    const params = toLanduseListParams(def, query);
    const [rows, total] = await Promise.all([repo.listLanduse(params), repo.countLanduse(params)]);

    return buildListResponse({
        data: rows.map(serializeCoreReviewLanduse),
        page: query.page,
        pageSize: query.pageSize,
        total,
        filters: {
            search: query.search,
            status: resolveCoreReviewListStatus(query),
            isVerified: query.isVerified,
            adminAreaId: query.adminAreaId,
            landuseClassId: query.landuseClassId,
            detailLevel: query.detailLevel,
            cropCode: query.cropCode,
        },
        meta: { entity: "landuse", sortBy: params.sortBy, sortOrder: params.sortOrder },
    });
}

export async function getCoreReviewLanduseDetail(
    repo: CoreReviewLanduseRepository,
    id: string,
    options: { anyStatus?: boolean } = {}
) {
    const row = await repo.getLanduseById(id, options);
    if (!row) {
        return null;
    }
    return buildDetailResponse(serializeCoreReviewLanduse(row));
}

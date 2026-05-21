import { StreetsRepository, type ListStreetsParams } from "../../streets/streets.repo.js";
import { buildDetailResponse, buildListResponse, pageToOffset } from "../core-review.pagination.js";
import { serializeCoreReviewStreet } from "../core-review-serializers.js";
import type { CoreReviewListQueryParsed } from "../core-review.schema.js";
import { resolveCoreReviewSortBy, type CoreReviewEntityDefinition } from "../core-review.entity-registry.js";

export async function listCoreReviewStreets(
    repo: StreetsRepository,
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
) {
    const offset = pageToOffset(query.page, query.pageSize);
    const sortBy = resolveCoreReviewSortBy(def, query.sortBy) as ListStreetsParams["sortBy"];
    const filterParams = {
        q: query.search,
        include_deleted: query.includeDeleted ?? false,
        is_verified: query.isVerified,
        admin_area_id: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        road_class_id: query.roadClassId ? BigInt(query.roadClassId) : undefined,
    };

    const [rows, total] = await Promise.all([
        repo.listStreets({
            limit: query.pageSize,
            offset,
            sortBy,
            sortOrder: query.sortOrder,
            ...filterParams,
        }),
        repo.countStreets(filterParams),
    ]);

    return buildListResponse({
        data: rows.map(serializeCoreReviewStreet),
        page: query.page,
        pageSize: query.pageSize,
        total,
        filters: {
            search: query.search,
            isVerified: query.isVerified,
            adminAreaId: query.adminAreaId,
            roadClassId: query.roadClassId,
            includeDeleted: query.includeDeleted,
        },
        meta: { entity: "streets", sortBy, sortOrder: query.sortOrder },
    });
}

export async function getCoreReviewStreetDetail(repo: StreetsRepository, id: string) {
    const row = await repo.getStreetByPublicId(id);
    if (!row) {
        return null;
    }
    return buildDetailResponse(serializeCoreReviewStreet(row));
}

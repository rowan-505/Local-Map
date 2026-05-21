import { PlacesRepository, type ListPlacesParams } from "../../places/places.repo.js";
import { buildDetailResponse, buildListResponse, pageToOffset } from "../core-review.pagination.js";
import { serializeCoreReviewPlace } from "../core-review-serializers.js";
import type { CoreReviewListQueryParsed } from "../core-review.schema.js";
import { resolveCoreReviewSortBy, type CoreReviewEntityDefinition } from "../core-review.entity-registry.js";

export async function listCoreReviewPlaces(
    repo: PlacesRepository,
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
) {
    const offset = pageToOffset(query.page, query.pageSize);
    const sortBy = resolveCoreReviewSortBy(def, query.sortBy) as ListPlacesParams["sortBy"];
    const filterParams = {
        q: query.search,
        category_id: query.categoryId ? BigInt(query.categoryId) : undefined,
        admin_area_id: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        is_public: query.isPublic,
        is_verified: query.isVerified,
    };

    const [rows, total] = await Promise.all([
        repo.listPlaces({
            limit: query.pageSize,
            offset,
            sortBy,
            sortOrder: query.sortOrder,
            ...filterParams,
        }),
        repo.countPlaces(filterParams),
    ]);

    return buildListResponse({
        data: rows.map((r) => serializeCoreReviewPlace(r)),
        page: query.page,
        pageSize: query.pageSize,
        total,
        filters: {
            search: query.search,
            isVerified: query.isVerified,
            adminAreaId: query.adminAreaId,
            categoryId: query.categoryId,
            isPublic: query.isPublic,
        },
        meta: { entity: "places", sortBy, sortOrder: query.sortOrder },
    });
}

export async function getCoreReviewPlaceDetail(repo: PlacesRepository, id: string) {
    const row = await repo.getPlaceDetailByPublicId(id);
    if (!row) {
        return null;
    }
    return buildDetailResponse(serializeCoreReviewPlace(row, true));
}

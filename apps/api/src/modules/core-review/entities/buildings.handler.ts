import {
    BuildingsRepository,
    type ActiveBuildingsListParams,
} from "../../buildings/buildings.repo.js";
import { buildDetailResponse, buildListResponse, pageToOffset } from "../core-review.pagination.js";
import { serializeCoreReviewBuilding } from "../core-review-serializers.js";
import type { CoreReviewListQueryParsed } from "../core-review.schema.js";
import { resolveCoreReviewSortBy, type CoreReviewEntityDefinition } from "../core-review.entity-registry.js";

export async function listCoreReviewBuildings(
    repo: BuildingsRepository,
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
) {
    const offset = pageToOffset(query.page, query.pageSize);
    const sortBy = resolveCoreReviewSortBy(def, query.sortBy) as ActiveBuildingsListParams["sortBy"];
    const filterParams = {
        q: query.search,
        is_verified: query.isVerified,
        admin_area_id: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        building_type_id: query.buildingTypeId ? BigInt(query.buildingTypeId) : undefined,
    };

    const [rows, total] = await Promise.all([
        repo.listActiveBuildings({
            limit: query.pageSize,
            offset,
            sortBy,
            sortOrder: query.sortOrder,
            ...filterParams,
        }),
        repo.countActiveBuildings(filterParams),
    ]);

    return buildListResponse({
        data: rows.map(serializeCoreReviewBuilding),
        page: query.page,
        pageSize: query.pageSize,
        total,
        filters: {
            search: query.search,
            isVerified: query.isVerified,
            adminAreaId: query.adminAreaId,
            buildingTypeId: query.buildingTypeId,
        },
        meta: { entity: "buildings", sortBy, sortOrder: query.sortOrder },
    });
}

export async function getCoreReviewBuildingDetail(repo: BuildingsRepository, id: string) {
    const row = await repo.getActiveBuildingByPublicId(id);
    if (!row) {
        return null;
    }
    return buildDetailResponse(serializeCoreReviewBuilding(row));
}

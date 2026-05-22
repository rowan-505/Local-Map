import { buildDetailResponse, buildListResponse, pageToOffset } from "../core-review.pagination.js";
import { resolveCoreReviewListStatus } from "../core-review-list-status.js";
import type { CoreReviewListQueryParsed } from "../core-review.schema.js";
import { resolveCoreReviewSortBy, type CoreReviewEntityDefinition } from "../core-review.entity-registry.js";
import type { CoreReviewEntityListParams } from "../core-review-entities.repo.js";
import { CoreReviewAddressesRepository } from "./addresses.repo.js";
import { attachComposedFields, groupComponentsByAddressId } from "./addresses-compose.js";
import { serializeCoreReviewAddress } from "./addresses.serializer.js";

function toListParams(
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
): CoreReviewEntityListParams {
    return {
        limit: query.pageSize,
        offset: pageToOffset(query.page, query.pageSize),
        search: query.search,
        sortBy: resolveCoreReviewSortBy(def, query.sortBy),
        sortOrder: query.sortOrder,
        isVerified: query.isVerified,
        adminAreaId: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        isPublic: query.isPublic,
        status: resolveCoreReviewListStatus(query),
    };
}

export async function listCoreReviewAddresses(
    repo: CoreReviewAddressesRepository,
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed
) {
    const params = toListParams(def, query);
    const [listRows, total] = await Promise.all([
        repo.listAddresses(params),
        repo.countAddresses(params),
    ]);
    const addressIds = listRows.map((r) => r.id);
    const components = await repo.listComponentsByAddressIds(addressIds);
    const componentsByAddressId = groupComponentsByAddressId(components);
    const composed = attachComposedFields(listRows, componentsByAddressId);

    return buildListResponse({
        data: composed.map((row) => serializeCoreReviewAddress(row)),
        page: query.page,
        pageSize: query.pageSize,
        total,
        filters: {
            search: query.search,
            isVerified: query.isVerified,
            adminAreaId: query.adminAreaId,
            isPublic: query.isPublic,
            status: resolveCoreReviewListStatus(query),
        },
        meta: { entity: "addresses", sortBy: params.sortBy, sortOrder: params.sortOrder },
    });
}

export async function getCoreReviewAddressDetail(
    repo: CoreReviewAddressesRepository,
    publicId: string,
    options: { anyStatus?: boolean } = {}
) {
    const row = await repo.getAddressByPublicId(publicId, options);
    if (!row) {
        return null;
    }
    const components = await repo.listComponentsByAddressIds([row.id]);
    const composed = attachComposedFields([row], groupComponentsByAddressId(components))[0]!;
    return buildDetailResponse(
        serializeCoreReviewAddress(composed, { components, includeDetail: true })
    );
}

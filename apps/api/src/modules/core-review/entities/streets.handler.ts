import {
    CORE_REVIEW_STREETS_MAX_PAGE_SIZE,
    StreetsRepository,
    type ListStreetsParams,
    type StreetsCoreReviewScopeCounts,
} from "../../streets/streets.repo.js";
import { resolveStreetsCoreReviewSortColumn } from "../../streets/streets-list-query.js";
import { buildDetailResponse, buildListResponse, pageToOffset } from "../core-review.pagination.js";
import { resolveCoreReviewListStatus } from "../core-review-list-status.js";
import { serializeCoreReviewStreet, serializeCoreReviewStreetListItem } from "../core-review-serializers.js";
import type { CoreReviewListQueryParsed } from "../core-review.schema.js";
import { resolveCoreReviewSortBy, type CoreReviewEntityDefinition } from "../core-review.entity-registry.js";
import type { CoreReviewVerificationStatus } from "../core-review-verification-filter.js";

function scopeFilterParams(
    query: CoreReviewListQueryParsed,
    listStatus: ReturnType<typeof resolveCoreReviewListStatus>,
) {
    return {
        q: query.search,
        include_deleted: listStatus === "all",
        status: listStatus,
        admin_area_id: query.adminAreaId ? BigInt(query.adminAreaId) : undefined,
        road_class_id: query.roadClassId ? BigInt(query.roadClassId) : undefined,
    };
}

function listFilterEcho(
    query: CoreReviewListQueryParsed,
    listStatus: ReturnType<typeof resolveCoreReviewListStatus>,
) {
    return {
        search: query.search,
        verification_status: query.verificationStatus,
        adminAreaId: query.adminAreaId,
        roadClassId: query.roadClassId,
        includeDeleted: query.includeDeleted,
        status: listStatus,
    };
}

function paginationTotalFromScopeBreakdown(
    breakdown: StreetsCoreReviewScopeCounts,
    verificationStatus: CoreReviewVerificationStatus | undefined,
    fallbackTotal: number,
): number {
    if (!verificationStatus) {
        return breakdown.total;
    }
    if (verificationStatus === "verified") {
        return breakdown.verified;
    }
    if (verificationStatus === "unverified") {
        return breakdown.unverified;
    }
    return fallbackTotal;
}

function buildStreetsListParams(
    query: CoreReviewListQueryParsed,
    def: CoreReviewEntityDefinition,
    pageSize: number,
    listStatus: ReturnType<typeof resolveCoreReviewListStatus>,
    fetchLimit: number,
    options: { fastList?: boolean } = {},
): ListStreetsParams {
    const sortBy = resolveStreetsCoreReviewSortColumn(
        resolveCoreReviewSortBy(def, query.sortBy),
    ) as ListStreetsParams["sortBy"];
    const scopeFilters = scopeFilterParams(query, listStatus);
    const updatedAtSort = sortBy === "updated" || sortBy === "updated_at";
    const hasCursor = Boolean(query.cursorUpdatedAt && query.cursorId);
    const offset =
        options.fastList && updatedAtSort && !hasCursor && query.page === 1
            ? 0
            : pageToOffset(query.page, pageSize);

    return {
        limit: fetchLimit,
        offset,
        sortBy,
        sortOrder: query.sortOrder,
        fast_list: options.fastList ?? false,
        ...scopeFilters,
        verification_status: query.verificationStatus,
        ...(hasCursor
            ? {
                  cursor_updated_at: new Date(query.cursorUpdatedAt!),
                  cursor_id: BigInt(query.cursorId!),
              }
            : {}),
    };
}

function streetsNextCursor(
    rows: { updated_at: Date; id: string }[],
    pageSize: number,
): { updatedAt: string; id: string } | null {
    const lastRow = rows.at(-1);
    if (!lastRow || rows.length < pageSize) {
        return null;
    }
    return {
        updatedAt: lastRow.updated_at.toISOString(),
        id: lastRow.id,
    };
}

export async function countCoreReviewStreets(
    repo: StreetsRepository,
    query: CoreReviewListQueryParsed,
) {
    const listStatus = resolveCoreReviewListStatus(query);
    const scopeFilters = scopeFilterParams(query, listStatus);
    const filterParams = {
        ...scopeFilters,
        verification_status: query.verificationStatus,
    };

    const needsFilteredCount =
        query.verificationStatus !== undefined &&
        query.verificationStatus !== "verified" &&
        query.verificationStatus !== "unverified";

    const [scopeBreakdown, filteredCount] = await Promise.all([
        repo.countStreetsCoreReviewScopeBreakdown(scopeFilters),
        needsFilteredCount ? repo.countStreetsCoreReview(filterParams) : Promise.resolve(0),
    ]);

    const total = paginationTotalFromScopeBreakdown(
        scopeBreakdown,
        query.verificationStatus,
        filteredCount,
    );

    return {
        total,
        verificationCounts: scopeBreakdown,
        filters: listFilterEcho(query, listStatus),
    };
}

export async function listCoreReviewStreets(
    repo: StreetsRepository,
    def: CoreReviewEntityDefinition,
    query: CoreReviewListQueryParsed,
) {
    const pageSize = Math.min(query.pageSize, CORE_REVIEW_STREETS_MAX_PAGE_SIZE);
    const listStatus = resolveCoreReviewListStatus(query);
    const includeTotal = query.includeTotal === true;
    const sortBy = resolveStreetsCoreReviewSortColumn(
        resolveCoreReviewSortBy(def, query.sortBy),
    ) as ListStreetsParams["sortBy"];

    if (!includeTotal) {
        const fetchLimit = pageSize + 1;
        const listParams = buildStreetsListParams(query, def, pageSize, listStatus, fetchLimit, {
            fastList: true,
        });
        const rows = await repo.listStreetsCoreReview(listParams);
        const hasNextPage = rows.length > pageSize;
        const pageRows = hasNextPage ? rows.slice(0, pageSize) : rows;

        return buildListResponse({
            data: pageRows.map(serializeCoreReviewStreetListItem),
            page: query.page,
            pageSize,
            total: null,
            filters: listFilterEcho(query, listStatus),
            meta: {
                entity: "streets",
                sortBy,
                sortOrder: query.sortOrder,
                hasNextPage,
                totalKnown: false,
                nextCursor: streetsNextCursor(pageRows, pageSize),
            },
        });
    }

    const listParams = buildStreetsListParams(query, def, pageSize, listStatus, pageSize, {
        fastList: true,
    });
    const scopeFilters = scopeFilterParams(query, listStatus);
    const filterParams = {
        ...scopeFilters,
        verification_status: query.verificationStatus,
    };

    const needsFilteredCount =
        query.verificationStatus !== undefined &&
        query.verificationStatus !== "verified" &&
        query.verificationStatus !== "unverified";

    const [rows, scopeBreakdown, filteredCount] = await Promise.all([
        repo.listStreetsCoreReview(listParams),
        repo.countStreetsCoreReviewScopeBreakdown(scopeFilters),
        needsFilteredCount ? repo.countStreetsCoreReview(filterParams) : Promise.resolve(0),
    ]);

    const total = paginationTotalFromScopeBreakdown(
        scopeBreakdown,
        query.verificationStatus,
        filteredCount,
    );

    return buildListResponse({
        data: rows.map(serializeCoreReviewStreetListItem),
        page: query.page,
        pageSize,
        total,
        filters: listFilterEcho(query, listStatus),
        meta: {
            entity: "streets",
            sortBy,
            sortOrder: query.sortOrder,
            totalKnown: true,
            verificationCounts: scopeBreakdown,
            nextCursor: streetsNextCursor(rows, pageSize),
        },
    });
}

export async function getCoreReviewStreetDetail(
    repo: StreetsRepository,
    id: string,
    options: { anyStatus?: boolean } = {},
) {
    const row = await repo.getStreetByPublicId(id, undefined, options);
    if (!row) {
        return null;
    }
    return buildDetailResponse(serializeCoreReviewStreet(row));
}

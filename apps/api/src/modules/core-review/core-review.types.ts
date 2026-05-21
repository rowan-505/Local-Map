import type { CoreReviewPaginationMeta } from "./core-review.pagination.js";

export type CoreReviewEntitySlug =
    | "buildings"
    | "places"
    | "streets"
    | "bus-stops"
    | "bus-routes"
    | "bus-route-variants"
    | "landuse"
    | "water-lines"
    | "water-polygons"
    | "addresses"
    | "admin-areas";

export type CoreReviewListResponse<T> = {
    data: T[];
    pagination: CoreReviewPaginationMeta;
    filters?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};

export type CoreReviewDetailResponse<T> = {
    data: T;
};

export type CoreReviewNameDto = {
    id: string;
    name: string;
    languageCode: string | null;
    scriptCode: string | null;
    nameType: string;
    isPrimary: boolean;
    searchWeight?: number;
};

export type CoreReviewListStatus = "active" | "deleted" | "all";

export type CoreReviewListQuery = {
    page: number;
    pageSize: number;
    search?: string;
    sortBy: string;
    sortOrder: "asc" | "desc";
    status?: CoreReviewListStatus;
    isVerified?: boolean;
    adminAreaId?: string;
    categoryId?: string;
    buildingTypeId?: string;
    roadClassId?: string;
    isPublic?: boolean;
    includeDeleted?: boolean;
    routeId?: string;
};

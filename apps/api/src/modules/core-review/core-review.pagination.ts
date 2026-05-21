export type CoreReviewPaginationMeta = {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
};

export function pageToOffset(page: number, pageSize: number): number {
    return Math.max(0, (page - 1) * pageSize);
}

export function buildPaginationMeta(
    page: number,
    pageSize: number,
    total: number
): CoreReviewPaginationMeta {
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    return {
        page,
        pageSize,
        total,
        totalPages,
    };
}

export function buildListResponse<T>(input: {
    data: T[];
    page: number;
    pageSize: number;
    total: number;
    filters?: Record<string, unknown>;
    meta?: Record<string, unknown>;
}) {
    return {
        data: input.data,
        pagination: buildPaginationMeta(input.page, input.pageSize, input.total),
        ...(input.filters !== undefined ? { filters: input.filters } : {}),
        ...(input.meta !== undefined ? { meta: input.meta } : {}),
    };
}

export function buildDetailResponse<T>(data: T) {
    return { data };
}

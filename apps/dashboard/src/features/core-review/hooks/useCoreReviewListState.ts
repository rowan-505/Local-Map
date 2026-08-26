"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { DataTableArrange } from "@/src/components/dashboard/DataTableToolbar";
import {
    getCoreReviewList,
    getCoreReviewStreetsCount,
    isAbortError,
    type CoreReviewEntitySlug,
    type CoreReviewListResponse,
    type CoreReviewListParams,
    type CoreReviewPagination,
} from "@/src/lib/api";
import { listApiSortOrder } from "@/src/lib/listToolbarSortOrder";

import type { CoreReviewFilterSupport } from "../config/entity-config-types";
import {
    parseCoreReviewVerificationStatusFilter,
    verificationFilterToApiParam,
    type CoreReviewVerificationStatusFilter,
} from "../verification/coreReviewVerificationFilter";
import {
    parseListVerificationCounts,
    type CoreReviewListVerificationCounts,
} from "./useCoreReviewVerificationTotals";
import {
    parseCoreReviewStatusFilter,
    type CoreReviewLifecycleStatusFilter,
} from "../lifecycle/coreReviewLifecycleUtils";

export type CoreReviewVerifiedFilter = "all" | "verified" | "unverified";
export type { CoreReviewVerificationStatusFilter };

export type CoreReviewListDraft = {
    searchDraft: string;
    sortBy: string;
    arrange: DataTableArrange;
    pageSize: number;
    verificationStatusFilter: CoreReviewVerificationStatusFilter;
    statusFilter: CoreReviewLifecycleStatusFilter;
    adminAreaId: string;
    settlementType: string;
    categoryId: string;
    buildingTypeId: string;
    roadClassId: string;
    isPublic: string;
    routeId: string;
    landAreaClassId: string;
    detailLevel: string;
    cropCode: string;
    boundaryStatus: string;
    addressUsage: string;
    isOfficialBoundary: string;
    cursorUpdatedAt: string;
    cursorId: string;
};

const PAGE_SIZE_CHOICES = [25, 50, 100] as const;

const CORE_REVIEW_LIST_STALE_MS = 5 * 60 * 1000;
const CORE_REVIEW_LIST_GC_MS = 30 * 60 * 1000;
const CORE_REVIEW_FILTER_DEBOUNCE_MS = 350;

function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delayMs: number): T {
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    return useCallback(
        ((...args: Parameters<T>) => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }
            timerRef.current = setTimeout(() => {
                fnRef.current(...args);
            }, delayMs);
        }) as T,
        [delayMs],
    );
}

export const CORE_REVIEW_STREETS_LIST_ERROR_MESSAGE = "Failed to load roads. Check API logs.";

function formatCoreReviewListLoadError(
    apiSlug: CoreReviewEntitySlug,
    error: unknown
): string {
    if (apiSlug === "streets") {
        return CORE_REVIEW_STREETS_LIST_ERROR_MESSAGE;
    }

    if (error instanceof Error) {
        return error.message;
    }

    return error ? String(error) : "Failed to load data";
}

function shouldRetryCoreReviewListQuery(failureCount: number, error: unknown): boolean {
    if (failureCount >= 2) {
        return false;
    }

    if (!(error instanceof Error)) {
        return true;
    }

    const message = error.message.toLowerCase();
    if (
        message.includes("database connection timed out") ||
        message.includes("db_pool_timeout")
    ) {
        return false;
    }

    return true;
}

function parsePageSize(raw: string | null): number {
    const n = Number(raw);
    if (PAGE_SIZE_CHOICES.includes(n as (typeof PAGE_SIZE_CHOICES)[number])) {
        return n;
    }
    return 50;
}

function parseArrange(sortBy: string, sortOrder: string | null): DataTableArrange {
    const order = sortOrder === "asc" ? "asc" : "desc";
    const dateFields = new Set(["created", "created_at", "updated", "updated_at"]);
    if (dateFields.has(sortBy)) {
        return order === "desc" ? "newest" : "oldest";
    }
    return order === "desc" ? "za" : "az";
}

function readDraftFromSearchParams(
    searchParams: URLSearchParams,
    defaults: { defaultSortBy: string }
): CoreReviewListDraft {
    const sortBy = searchParams.get("sortBy")?.trim() || defaults.defaultSortBy;
    const sortOrder = searchParams.get("sortOrder");
    return {
        searchDraft: searchParams.get("search")?.trim() ?? "",
        sortBy,
        arrange: parseArrange(sortBy, sortOrder),
        pageSize: parsePageSize(searchParams.get("pageSize")),
        verificationStatusFilter: parseCoreReviewVerificationStatusFilter(
            searchParams.get("verification_status"),
            searchParams.get("isVerified")
        ),
        adminAreaId: searchParams.get("adminAreaId")?.trim() ?? "",
        settlementType: searchParams.get("settlementType")?.trim() ?? "",
        categoryId: searchParams.get("categoryId")?.trim() ?? "",
        buildingTypeId: searchParams.get("buildingTypeId")?.trim() ?? "",
        roadClassId: searchParams.get("roadClassId")?.trim() ?? "",
        isPublic: searchParams.get("isPublic")?.trim() ?? "",
        statusFilter: parseCoreReviewStatusFilter(
            searchParams.get("status"),
            searchParams.get("includeDeleted") === "true"
        ),
        routeId: searchParams.get("routeId")?.trim() ?? "",
        landAreaClassId: searchParams.get("landAreaClassId")?.trim() ?? "",
        detailLevel: searchParams.get("detailLevel")?.trim() ?? "",
        cropCode: searchParams.get("cropCode")?.trim() ?? "",
        boundaryStatus: searchParams.get("boundaryStatus")?.trim() ?? "",
        addressUsage: searchParams.get("addressUsage")?.trim() ?? "",
        isOfficialBoundary: searchParams.get("isOfficialBoundary")?.trim() ?? "",
        cursorUpdatedAt: searchParams.get("cursorUpdatedAt")?.trim() ?? "",
        cursorId: searchParams.get("cursorId")?.trim() ?? "",
    };
}

/** Exported for verification total queries (pageSize 1, count from pagination.total). */
export function buildListParamsFromDraft(
    draft: CoreReviewListDraft,
    page: number,
    filterSupport: CoreReviewFilterSupport,
    verificationStatusOverride?: CoreReviewVerificationStatusFilter
): CoreReviewListParams {
    const verificationStatusFilter = verificationStatusOverride ?? draft.verificationStatusFilter;
    const params: CoreReviewListParams = {
        page,
        pageSize: draft.pageSize,
        sortBy: draft.sortBy,
        sortOrder: listApiSortOrder(draft.sortBy, draft.arrange),
    };
    if (draft.searchDraft) {
        params.search = draft.searchDraft;
    }
    const verificationStatus = verificationFilterToApiParam(verificationStatusFilter);
    if (filterSupport.isVerified && verificationStatus) {
        params.verification_status = verificationStatus;
    }
    if (filterSupport.adminAreaId && draft.adminAreaId) {
        params.adminAreaId = draft.adminAreaId;
    }
    if (filterSupport.settlementType && draft.settlementType) {
        params.settlementType = draft.settlementType;
    }
    if (filterSupport.categoryId && draft.categoryId) {
        params.categoryId = draft.categoryId;
    }
    if (filterSupport.buildingTypeId && draft.buildingTypeId) {
        params.buildingTypeId = draft.buildingTypeId;
    }
    if (filterSupport.roadClassId && draft.roadClassId) {
        params.roadClassId = draft.roadClassId;
    }
    if (filterSupport.isPublic && draft.isPublic !== "") {
        params.isPublic = draft.isPublic === "true";
    }
    if (draft.statusFilter !== "active") {
        params.status = draft.statusFilter;
    }
    if (filterSupport.routeId && draft.routeId) {
        params.routeId = draft.routeId;
    }
    if (filterSupport.landAreaClassId && draft.landAreaClassId) {
        params.landAreaClassId = draft.landAreaClassId;
    }
    if (filterSupport.detailLevel && draft.detailLevel) {
        params.detailLevel = draft.detailLevel as "zone" | "parcel";
    }
    if (filterSupport.cropCode && draft.cropCode) {
        params.cropCode = draft.cropCode;
    }
    if (filterSupport.boundaryStatus && draft.boundaryStatus) {
        params.boundaryStatus = draft.boundaryStatus;
    }
    if (filterSupport.addressUsage && draft.addressUsage) {
        params.addressUsage = draft.addressUsage;
    }
    if (filterSupport.isOfficialBoundary && draft.isOfficialBoundary !== "") {
        params.isOfficialBoundary = draft.isOfficialBoundary === "true";
    }
    if (draft.cursorUpdatedAt && draft.cursorId) {
        params.cursorUpdatedAt = draft.cursorUpdatedAt;
        params.cursorId = draft.cursorId;
    }
    return params;
}

/** Filter params for GET /core-review/streets/count (no pagination). */
export function buildStreetsCountParamsFromDraft(
    draft: CoreReviewListDraft,
    filterSupport: CoreReviewFilterSupport,
): Omit<CoreReviewListParams, "page" | "pageSize" | "includeTotal" | "include_total"> {
    const { page: _page, pageSize: _pageSize, includeTotal: _includeTotal, ...rest } =
        buildListParamsFromDraft(draft, 1, filterSupport);
    return rest;
}

function parseHasNextPage(meta: Record<string, unknown> | undefined): boolean | null {
    if (!meta || meta.hasNextPage === undefined) {
        return null;
    }
    return meta.hasNextPage === true;
}

function buildStreetsCountQueryKey(input: {
    search: string;
    status: string;
    verificationStatus: string;
    adminAreaId: string;
    roadClassId: string;
}) {
    return [
        "core-review",
        "streets-count",
        input.search,
        input.status,
        input.verificationStatus,
        input.adminAreaId,
        input.roadClassId,
    ] as const;
}

function buildCoreReviewListQueryKey(input: {
    apiSlug: CoreReviewEntitySlug;
    page: number;
    pageSize: number;
    sortBy: string;
    sortOrder: string;
    search: string;
    status: string;
    verificationStatus: string;
    adminAreaId: string;
    settlementType: string;
    categoryId: string;
    buildingTypeId: string;
    roadClassId: string;
    isPublic: string;
    routeId: string;
    landAreaClassId: string;
    detailLevel: string;
    cropCode: string;
    boundaryStatus: string;
    addressUsage: string;
    isOfficialBoundary: string;
    cursorUpdatedAt: string;
    cursorId: string;
}) {
    return [
        "core-review",
        "list",
        input.apiSlug,
        input.page,
        input.pageSize,
        input.sortBy,
        input.sortOrder,
        input.search,
        input.status,
        input.verificationStatus,
        input.adminAreaId,
        input.settlementType,
        input.categoryId,
        input.buildingTypeId,
        input.roadClassId,
        input.isPublic,
        input.routeId,
        input.landAreaClassId,
        input.detailLevel,
        input.cropCode,
        input.boundaryStatus,
        input.addressUsage,
        input.isOfficialBoundary,
        input.cursorUpdatedAt,
        input.cursorId,
    ] as const;
}

function draftToUrlParams(
    draft: CoreReviewListDraft,
    page: number,
    cursor?: { updatedAt: string; id: string } | null,
): Record<string, string> {
    const p: Record<string, string> = {
        page: String(page),
        pageSize: String(draft.pageSize),
        sortBy: draft.sortBy,
        sortOrder: listApiSortOrder(draft.sortBy, draft.arrange),
    };
    if (draft.searchDraft) {
        p.search = draft.searchDraft;
    }
    if (draft.verificationStatusFilter !== "all") {
        p.verification_status = draft.verificationStatusFilter;
    }
    if (draft.adminAreaId) {
        p.adminAreaId = draft.adminAreaId;
    }
    if (draft.settlementType) {
        p.settlementType = draft.settlementType;
    }
    if (draft.categoryId) {
        p.categoryId = draft.categoryId;
    }
    if (draft.buildingTypeId) {
        p.buildingTypeId = draft.buildingTypeId;
    }
    if (draft.roadClassId) {
        p.roadClassId = draft.roadClassId;
    }
    if (draft.isPublic !== "") {
        p.isPublic = draft.isPublic;
    }
    if (draft.statusFilter !== "active") {
        p.status = draft.statusFilter;
    }
    if (draft.routeId) {
        p.routeId = draft.routeId;
    }
    if (draft.landAreaClassId) {
        p.landAreaClassId = draft.landAreaClassId;
    }
    if (draft.detailLevel) {
        p.detailLevel = draft.detailLevel;
    }
    if (draft.cropCode) {
        p.cropCode = draft.cropCode;
    }
    if (draft.boundaryStatus) {
        p.boundaryStatus = draft.boundaryStatus;
    }
    if (draft.addressUsage) {
        p.addressUsage = draft.addressUsage;
    }
    if (draft.isOfficialBoundary !== "") {
        p.isOfficialBoundary = draft.isOfficialBoundary;
    }
    if (page > 1 && cursor?.updatedAt && cursor.id) {
        p.cursorUpdatedAt = cursor.updatedAt;
        p.cursorId = cursor.id;
    }
    return p;
}

export function useCoreReviewListState<T extends Record<string, unknown>>(options: {
    apiSlug: CoreReviewEntitySlug;
    defaultSortBy: string;
    filterSupport: CoreReviewFilterSupport;
    getRowId: (row: T) => string;
}) {
    const { apiSlug, defaultSortBy, filterSupport, getRowId } = options;
    const searchParams = useSearchParams();
    const pathname = usePathname() ?? "";
    const router = useRouter();

    const queryClient = useQueryClient();

    const searchKey = searchParams.toString();

    const appliedPage = useMemo(() => {
        const sp = new URLSearchParams(searchKey);
        return Math.max(1, Number(sp.get("page")) || 1);
    }, [searchKey]);

    const appliedDraft = useMemo(
        () => readDraftFromSearchParams(new URLSearchParams(searchKey), { defaultSortBy }),
        [searchKey, defaultSortBy]
    );

    const [draft, setDraft] = useState<CoreReviewListDraft>(appliedDraft);

    useEffect(() => {
        setDraft(appliedDraft);
    }, [appliedDraft]);

    const listParams = useMemo(() => {
        const params = buildListParamsFromDraft(appliedDraft, appliedPage, filterSupport);
        const normalized = {
            ...params,
            search: params.search?.trim() ?? "",
        };
        if (apiSlug === "streets") {
            return { ...normalized, includeTotal: false };
        }
        return normalized;
    }, [apiSlug, appliedDraft, appliedPage, filterSupport]);

    const queryKey = useMemo(() => {
        const sortOrder = listParams.sortOrder ?? "desc";
        return buildCoreReviewListQueryKey({
            apiSlug,
            page: listParams.page ?? appliedPage,
            pageSize: listParams.pageSize ?? appliedDraft.pageSize,
            sortBy: listParams.sortBy ?? defaultSortBy,
            sortOrder,
            search: (listParams.search ?? "").trim(),
            status: listParams.status ?? "active",
            verificationStatus: listParams.verification_status ?? "",
            adminAreaId: listParams.adminAreaId?.trim() ?? "",
            settlementType: listParams.settlementType?.trim() ?? "",
            categoryId: listParams.categoryId?.trim() ?? "",
            buildingTypeId: listParams.buildingTypeId?.trim() ?? "",
            roadClassId: listParams.roadClassId?.trim() ?? "",
            isPublic:
                listParams.isPublic === true ? "true" : listParams.isPublic === false ? "false" : "",
            routeId: listParams.routeId?.trim() ?? "",
            landAreaClassId: listParams.landAreaClassId?.trim() ?? "",
            detailLevel: listParams.detailLevel?.trim() ?? "",
            cropCode: listParams.cropCode?.trim() ?? "",
            boundaryStatus: listParams.boundaryStatus?.trim() ?? "",
            addressUsage: listParams.addressUsage?.trim() ?? "",
            isOfficialBoundary:
                listParams.isOfficialBoundary === true
                    ? "true"
                    : listParams.isOfficialBoundary === false
                      ? "false"
                      : "",
            cursorUpdatedAt: listParams.cursorUpdatedAt?.trim() ?? "",
            cursorId: listParams.cursorId?.trim() ?? "",
        });
    }, [
        apiSlug,
        appliedDraft.pageSize,
        appliedPage,
        defaultSortBy,
        listParams.addressUsage,
        listParams.adminAreaId,
        listParams.settlementType,
        listParams.boundaryStatus,
        listParams.buildingTypeId,
        listParams.categoryId,
        listParams.cropCode,
        listParams.cursorId,
        listParams.cursorUpdatedAt,
        listParams.detailLevel,
        listParams.isOfficialBoundary,
        listParams.isPublic,
        listParams.verification_status,
        listParams.landAreaClassId,
        listParams.page,
        listParams.pageSize,
        listParams.roadClassId,
        listParams.routeId,
        listParams.search,
        listParams.sortBy,
        listParams.sortOrder,
        listParams.status,
    ]);

    const query = useQuery<CoreReviewListResponse<T>, Error>({
        queryKey,
        queryFn: async ({ signal }) => {
            try {
                return await getCoreReviewList<T>(apiSlug, listParams, { signal });
            } catch (err) {
                if (isAbortError(err)) {
                    throw err;
                }
                if (apiSlug === "streets") {
                    throw new Error(CORE_REVIEW_STREETS_LIST_ERROR_MESSAGE);
                }
                const msg = err instanceof Error ? err.message : "Failed to load data";
                if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
                    throw new Error("API not implemented yet for this entity.");
                }
                throw new Error(msg);
            }
        },
        staleTime: CORE_REVIEW_LIST_STALE_MS,
        gcTime: CORE_REVIEW_LIST_GC_MS,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        placeholderData: keepPreviousData,
        retry: shouldRetryCoreReviewListQuery,
    });

    const streetsCountParams = useMemo(() => {
        if (apiSlug !== "streets") {
            return null;
        }
        return buildStreetsCountParamsFromDraft(appliedDraft, filterSupport);
    }, [apiSlug, appliedDraft, filterSupport]);

    const streetsCountQueryKey = useMemo(() => {
        if (apiSlug !== "streets" || !streetsCountParams) {
            return null;
        }
        return buildStreetsCountQueryKey({
            search: (streetsCountParams.search ?? "").trim(),
            status: streetsCountParams.status ?? "active",
            verificationStatus: streetsCountParams.verification_status ?? "",
            adminAreaId: streetsCountParams.adminAreaId?.trim() ?? "",
            roadClassId: streetsCountParams.roadClassId?.trim() ?? "",
        });
    }, [apiSlug, streetsCountParams]);

    const { status, fetchStatus, data, isError, error: queryError } = query;

    const hasLoadFailed = status === "error" || isError;

    const streetsCountQuery = useQuery({
        queryKey: streetsCountQueryKey ?? ["core-review", "streets-count", "disabled"],
        queryFn: async ({ signal }) => {
            if (!streetsCountParams) {
                throw new Error("Streets count params required");
            }
            return getCoreReviewStreetsCount(streetsCountParams, { signal });
        },
        enabled:
            apiSlug === "streets" &&
            streetsCountParams !== null &&
            data !== undefined &&
            !hasLoadFailed,
        staleTime: CORE_REVIEW_LIST_STALE_MS,
        gcTime: CORE_REVIEW_LIST_GC_MS,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: shouldRetryCoreReviewListQuery,
    });

    const rows = data?.data ?? [];

    const pagination: CoreReviewPagination = useMemo(() => {
        const fallback: CoreReviewPagination = {
            page: appliedPage,
            pageSize: appliedDraft.pageSize,
            total: 0,
            totalPages: 1,
        };
        const base = data?.pagination ?? fallback;
        if (apiSlug !== "streets") {
            return base;
        }
        const countTotal = streetsCountQuery.data?.total;
        if (countTotal === undefined) {
            return {
                ...base,
                total: base.total ?? 0,
                totalPages: base.totalPages ?? 1,
            };
        }
        const pageSize = base.pageSize || appliedDraft.pageSize;
        return {
            ...base,
            total: countTotal,
            totalPages: countTotal === 0 ? 0 : Math.ceil(countTotal / pageSize),
        };
    }, [apiSlug, appliedDraft.pageSize, appliedPage, data?.pagination, streetsCountQuery.data?.total]);

    const hasNextPage = useMemo(() => {
        if (apiSlug !== "streets") {
            return null;
        }
        const countTotal = streetsCountQuery.data?.total;
        if (countTotal !== undefined) {
            return appliedPage * appliedDraft.pageSize < countTotal;
        }
        return parseHasNextPage(data?.meta);
    }, [
        apiSlug,
        appliedDraft.pageSize,
        appliedPage,
        data?.meta,
        streetsCountQuery.data?.total,
    ]);

    const totalKnown = useMemo(() => {
        if (apiSlug !== "streets") {
            return true;
        }
        return streetsCountQuery.data !== undefined && !streetsCountQuery.isError;
    }, [apiSlug, streetsCountQuery.data, streetsCountQuery.isError]);

    const totalLoading =
        apiSlug === "streets" &&
        streetsCountQuery.isFetching &&
        streetsCountQuery.data === undefined &&
        !streetsCountQuery.isError;

    const countUnavailable = apiSlug === "streets" && streetsCountQuery.isError;

    const pushDraft = useCallback(
        (nextDraft: CoreReviewListDraft, page = 1, cursor?: { updatedAt: string; id: string } | null) => {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(draftToUrlParams(nextDraft, page, cursor))) {
                params.set(key, value);
            }
            router.push(`${pathname}?${params.toString()}`);
        },
        [pathname, router]
    );

    const applyFilters = useCallback(() => {
        pushDraft(draft, 1);
    }, [draft, pushDraft]);

    const applyDraft = useCallback(
        (nextDraft: CoreReviewListDraft, page = 1) => {
            setDraft(nextDraft);
            pushDraft(nextDraft, page);
        },
        [pushDraft]
    );

    const setPage = useCallback(
        (page: number) => {
            let cursor: { updatedAt: string; id: string } | null = null;
            if (apiSlug === "streets" && page > appliedPage && data?.meta?.nextCursor) {
                const raw = data.meta.nextCursor as { updatedAt?: string; id?: string };
                if (raw.updatedAt && raw.id) {
                    cursor = { updatedAt: raw.updatedAt, id: raw.id };
                }
            }
            pushDraft(appliedDraft, page, cursor);
        },
        [apiSlug, appliedDraft, appliedPage, data?.meta?.nextCursor, pushDraft]
    );

    const reload = useCallback(() => {
        pushDraft(appliedDraft, appliedPage);
    }, [appliedDraft, appliedPage, pushDraft]);

    const applyVerificationFilter = useCallback(
        (verificationStatusFilter: CoreReviewVerificationStatusFilter) => {
            const nextDraft = { ...draft, verificationStatusFilter };
            setDraft(nextDraft);
            pushDraft(nextDraft, 1);
        },
        [draft, pushDraft]
    );

    const applyVerificationFilterDebounced = useDebouncedCallback(
        applyVerificationFilter,
        CORE_REVIEW_FILTER_DEBOUNCE_MS,
    );

    const patchRow = useCallback(
        (rowId: string, updater: (row: T) => T) => {
            queryClient.setQueryData<CoreReviewListResponse<T>>(queryKey, (prev) => {
                if (!prev) {
                    return prev;
                }
                return {
                    ...prev,
                    data: prev.data.map((row: T) => (getRowId(row) === rowId ? updater(row) : row)),
                };
            });
        },
        [getRowId, queryClient, queryKey],
    );

    const isLoading =
        !hasLoadFailed &&
        data === undefined &&
        (status === "pending" || fetchStatus === "fetching");

    const verificationCounts: CoreReviewListVerificationCounts | null = useMemo(() => {
        if (apiSlug === "streets" && streetsCountQuery.data?.verificationCounts) {
            return parseListVerificationCounts({
                verificationCounts: streetsCountQuery.data.verificationCounts,
            });
        }
        return parseListVerificationCounts(data?.meta);
    }, [apiSlug, data?.meta, streetsCountQuery.data?.verificationCounts]);

    return {
        rows,
        pagination,
        isLoading,
        error: hasLoadFailed ? formatCoreReviewListLoadError(apiSlug, queryError) : "",
        verificationCounts,
        hasNextPage,
        totalKnown,
        totalLoading,
        countUnavailable,
        draft,
        setDraft,
        appliedDraft,
        appliedPage,
        applyFilters,
        applyVerificationFilter: applyVerificationFilterDebounced,
        applyDraft,
        setPage,
        reload,
        patchRow,
        pageSizeChoices: PAGE_SIZE_CHOICES,
        isFetching: query.isFetching,
    };
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DataTableArrange } from "@/src/components/dashboard/DataTableToolbar";
import {
    getCoreReviewList,
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
    categoryId: string;
    buildingTypeId: string;
    roadClassId: string;
    isPublic: string;
    routeId: string;
    landuseClassId: string;
    detailLevel: string;
    cropCode: string;
    boundaryStatus: string;
    addressUsage: string;
    isOfficialBoundary: string;
};

const PAGE_SIZE_CHOICES = [25, 50, 100] as const;

const CORE_REVIEW_LIST_STALE_MS = 5 * 60 * 1000;
const CORE_REVIEW_LIST_GC_MS = 30 * 60 * 1000;

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
        categoryId: searchParams.get("categoryId")?.trim() ?? "",
        buildingTypeId: searchParams.get("buildingTypeId")?.trim() ?? "",
        roadClassId: searchParams.get("roadClassId")?.trim() ?? "",
        isPublic: searchParams.get("isPublic")?.trim() ?? "",
        statusFilter: parseCoreReviewStatusFilter(
            searchParams.get("status"),
            searchParams.get("includeDeleted") === "true"
        ),
        routeId: searchParams.get("routeId")?.trim() ?? "",
        landuseClassId: searchParams.get("landuseClassId")?.trim() ?? "",
        detailLevel: searchParams.get("detailLevel")?.trim() ?? "",
        cropCode: searchParams.get("cropCode")?.trim() ?? "",
        boundaryStatus: searchParams.get("boundaryStatus")?.trim() ?? "",
        addressUsage: searchParams.get("addressUsage")?.trim() ?? "",
        isOfficialBoundary: searchParams.get("isOfficialBoundary")?.trim() ?? "",
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
    if (filterSupport.landuseClassId && draft.landuseClassId) {
        params.landuseClassId = draft.landuseClassId;
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
    return params;
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
    categoryId: string;
    buildingTypeId: string;
    roadClassId: string;
    isPublic: string;
    routeId: string;
    landuseClassId: string;
    detailLevel: string;
    cropCode: string;
    boundaryStatus: string;
    addressUsage: string;
    isOfficialBoundary: string;
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
        input.categoryId,
        input.buildingTypeId,
        input.roadClassId,
        input.isPublic,
        input.routeId,
        input.landuseClassId,
        input.detailLevel,
        input.cropCode,
        input.boundaryStatus,
        input.addressUsage,
        input.isOfficialBoundary,
    ] as const;
}

function draftToUrlParams(draft: CoreReviewListDraft, page: number): Record<string, string> {
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
    if (draft.landuseClassId) {
        p.landuseClassId = draft.landuseClassId;
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
        return {
            ...params,
            search: params.search?.trim() ?? "",
        };
    }, [appliedDraft, appliedPage, filterSupport]);

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
            categoryId: listParams.categoryId?.trim() ?? "",
            buildingTypeId: listParams.buildingTypeId?.trim() ?? "",
            roadClassId: listParams.roadClassId?.trim() ?? "",
            isPublic:
                listParams.isPublic === true ? "true" : listParams.isPublic === false ? "false" : "",
            routeId: listParams.routeId?.trim() ?? "",
            landuseClassId: listParams.landuseClassId?.trim() ?? "",
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
        });
    }, [
        apiSlug,
        appliedDraft.pageSize,
        appliedPage,
        defaultSortBy,
        listParams.addressUsage,
        listParams.adminAreaId,
        listParams.boundaryStatus,
        listParams.buildingTypeId,
        listParams.categoryId,
        listParams.cropCode,
        listParams.detailLevel,
        listParams.isOfficialBoundary,
        listParams.isPublic,
        listParams.verification_status,
        listParams.landuseClassId,
        listParams.page,
        listParams.pageSize,
        listParams.roadClassId,
        listParams.routeId,
        listParams.search,
        listParams.sortBy,
        listParams.sortOrder,
        listParams.status,
    ]);

    const query = useQuery({
        queryKey,
        queryFn: async ({ signal }) => {
            try {
                return await getCoreReviewList<T>(apiSlug, listParams, { signal });
            } catch (err) {
                if (isAbortError(err)) {
                    throw err;
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
    });

    const rows = query.data?.data ?? [];
    const pagination: CoreReviewPagination =
        query.data?.pagination ?? {
            page: appliedPage,
            pageSize: appliedDraft.pageSize,
            total: 0,
            totalPages: 1,
        };

    const pushDraft = useCallback(
        (nextDraft: CoreReviewListDraft, page = 1) => {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(draftToUrlParams(nextDraft, page))) {
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
            pushDraft(appliedDraft, page);
        },
        [appliedDraft, pushDraft]
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

    return {
        rows,
        pagination,
        isLoading: query.isPending && !query.data,
        error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : "",
        draft,
        setDraft,
        appliedDraft,
        appliedPage,
        applyFilters,
        applyVerificationFilter,
        applyDraft,
        setPage,
        reload,
        patchRow,
        pageSizeChoices: PAGE_SIZE_CHOICES,
        isFetching: query.isFetching,
    };
}

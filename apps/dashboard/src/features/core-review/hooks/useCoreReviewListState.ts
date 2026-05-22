"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DataTableArrange } from "@/src/components/dashboard/DataTableToolbar";
import {
    getCoreReviewList,
    isAbortError,
    type CoreReviewEntitySlug,
    type CoreReviewListParams,
    type CoreReviewPagination,
} from "@/src/lib/api";
import { listApiSortOrder } from "@/src/lib/listToolbarSortOrder";

import type { CoreReviewFilterSupport } from "../config/entity-config-types";
import {
    parseCoreReviewStatusFilter,
    type CoreReviewLifecycleStatusFilter,
} from "../lifecycle/coreReviewLifecycleUtils";

export type CoreReviewVerifiedFilter = "all" | "verified" | "unverified";

export type CoreReviewListDraft = {
    searchDraft: string;
    sortBy: string;
    arrange: DataTableArrange;
    pageSize: number;
    verifiedFilter: CoreReviewVerifiedFilter;
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

function parseVerified(raw: string | null): CoreReviewVerifiedFilter {
    if (raw === "true") {
        return "verified";
    }
    if (raw === "false") {
        return "unverified";
    }
    return "all";
}

function verifiedToParam(v: CoreReviewVerifiedFilter): boolean | undefined {
    if (v === "verified") {
        return true;
    }
    if (v === "unverified") {
        return false;
    }
    return undefined;
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
        verifiedFilter: parseVerified(searchParams.get("isVerified")),
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
    verifiedOverride?: CoreReviewVerifiedFilter
): CoreReviewListParams {
    const verifiedFilter = verifiedOverride ?? draft.verifiedFilter;
    const params: CoreReviewListParams = {
        page,
        pageSize: draft.pageSize,
        sortBy: draft.sortBy,
        sortOrder: listApiSortOrder(draft.sortBy, draft.arrange),
    };
    if (draft.searchDraft) {
        params.search = draft.searchDraft;
    }
    const verified = verifiedToParam(verifiedFilter);
    if (filterSupport.isVerified && verified !== undefined) {
        params.isVerified = verified;
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
    if (draft.verifiedFilter === "verified") {
        p.isVerified = "true";
    } else if (draft.verifiedFilter === "unverified") {
        p.isVerified = "false";
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
}) {
    const { apiSlug, defaultSortBy, filterSupport } = options;
    const searchParams = useSearchParams();
    const pathname = usePathname() ?? "";
    const router = useRouter();

    const appliedPage = Math.max(1, Number(searchParams.get("page")) || 1);

    const appliedDraft = useMemo(
        () => readDraftFromSearchParams(searchParams, { defaultSortBy }),
        [searchParams, defaultSortBy]
    );

    const [draft, setDraft] = useState<CoreReviewListDraft>(appliedDraft);
    const [rows, setRows] = useState<T[]>([]);
    const [pagination, setPagination] = useState<CoreReviewPagination>({
        page: 1,
        pageSize: 50,
        total: 0,
        totalPages: 1,
    });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        setDraft(appliedDraft);
    }, [appliedDraft]);

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

    useEffect(() => {
        const controller = new AbortController();
        setIsLoading(true);
        setError("");

        const params = buildListParamsFromDraft(appliedDraft, appliedPage, filterSupport);

        void getCoreReviewList<T>(apiSlug, params, { signal: controller.signal })
            .then((res) => {
                setRows(res.data);
                setPagination(res.pagination);
            })
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                const msg = err instanceof Error ? err.message : "Failed to load data";
                if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
                    setError("API not implemented yet for this entity.");
                } else {
                    setError(msg);
                }
                setRows([]);
                setPagination({
                    page: appliedPage,
                    pageSize: appliedDraft.pageSize,
                    total: 0,
                    totalPages: 1,
                });
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            });

        return () => controller.abort();
    }, [apiSlug, appliedDraft, appliedPage, filterSupport]);

    return {
        rows,
        pagination,
        isLoading,
        error,
        draft,
        setDraft,
        appliedDraft,
        appliedPage,
        applyFilters,
        applyDraft,
        setPage,
        reload,
        pageSizeChoices: PAGE_SIZE_CHOICES,
    };
}

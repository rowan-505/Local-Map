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

export type CoreReviewVerifiedFilter = "all" | "verified" | "unverified";

export type CoreReviewListDraft = {
    searchDraft: string;
    sortBy: string;
    arrange: DataTableArrange;
    pageSize: number;
    verifiedFilter: CoreReviewVerifiedFilter;
    adminAreaId: string;
    categoryId: string;
    buildingTypeId: string;
    roadClassId: string;
    isPublic: string;
    includeDeleted: boolean;
    routeId: string;
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
        includeDeleted: searchParams.get("includeDeleted") === "true",
        routeId: searchParams.get("routeId")?.trim() ?? "",
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
    if (filterSupport.includeDeleted && draft.includeDeleted) {
        params.includeDeleted = true;
    }
    if (filterSupport.routeId && draft.routeId) {
        params.routeId = draft.routeId;
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
    if (draft.includeDeleted) {
        p.includeDeleted = "true";
    }
    if (draft.routeId) {
        p.routeId = draft.routeId;
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

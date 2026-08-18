"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import {
    getCoreReviewList,
    isAbortError,
    type CoreReviewEntitySlug,
} from "@/src/lib/api";

import type { CoreReviewFilterSupport } from "../config/entity-config-types";
import type { CoreReviewVerificationStatusFilter } from "../verification/coreReviewVerificationFilter";
import {
    buildListParamsFromDraft,
    type CoreReviewListDraft,
} from "./useCoreReviewListState";

export type CoreReviewVerificationTotals = {
    total: number;
    verified: number;
    unverified: number;
    isLoading: boolean;
    countUnavailable?: boolean;
};

export type CoreReviewListVerificationCounts = {
    total: number;
    verified: number;
    unverified: number;
};

export function parseListVerificationCounts(
    meta: Record<string, unknown> | undefined,
): CoreReviewListVerificationCounts | null {
    if (!meta || typeof meta.verificationCounts !== "object" || meta.verificationCounts === null) {
        return null;
    }
    const raw = meta.verificationCounts as Record<string, unknown>;
    const total = Number(raw.total);
    const verified = Number(raw.verified);
    const unverified = Number(raw.unverified);
    if (!Number.isFinite(total) || !Number.isFinite(verified) || !Number.isFinite(unverified)) {
        return null;
    }
    return { total, verified, unverified };
}

const CORE_REVIEW_VERIFICATION_TOTALS_STALE_MS = 10 * 60 * 1000;
const CORE_REVIEW_VERIFICATION_TOTALS_GC_MS = 60 * 60 * 1000;

function verificationTotalsQueryKey(input: {
    apiSlug: CoreReviewEntitySlug;
    // Stable primitives only
    search: string;
    status: string;
    adminAreaId: string;
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
}) {
    return [
        "core-review",
        "verification-totals",
        input.apiSlug,
        input.search,
        input.status,
        input.adminAreaId,
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
    ] as const;
}

export function useCoreReviewVerificationTotals(options: {
    apiSlug: CoreReviewEntitySlug;
    appliedDraft: CoreReviewListDraft;
    filterSupport: CoreReviewFilterSupport;
    enabled: boolean;
    /** When the list response already includes scope totals, skip extra count fetches. */
    listVerificationCounts?: CoreReviewListVerificationCounts | null;
}): CoreReviewVerificationTotals {
    const { apiSlug, appliedDraft, filterSupport, enabled, listVerificationCounts = null } = options;

    const queryEnabled =
        enabled && filterSupport.isVerified && apiSlug !== "streets" && listVerificationCounts === null;

    const queryKey = useMemo(() => {
        const p = {
            apiSlug,
            search: appliedDraft.searchDraft.trim(),
            status: appliedDraft.statusFilter,
            adminAreaId: appliedDraft.adminAreaId.trim(),
            categoryId: appliedDraft.categoryId.trim(),
            buildingTypeId: appliedDraft.buildingTypeId.trim(),
            roadClassId: appliedDraft.roadClassId.trim(),
            isPublic: appliedDraft.isPublic.trim(),
            routeId: appliedDraft.routeId.trim(),
            landAreaClassId: appliedDraft.landAreaClassId.trim(),
            detailLevel: appliedDraft.detailLevel.trim(),
            cropCode: appliedDraft.cropCode.trim(),
            boundaryStatus: appliedDraft.boundaryStatus.trim(),
            addressUsage: appliedDraft.addressUsage.trim(),
            isOfficialBoundary: appliedDraft.isOfficialBoundary.trim(),
        };
        return verificationTotalsQueryKey(p);
    }, [apiSlug, appliedDraft]);

    const query = useQuery({
        queryKey,
        queryFn: async ({ signal }) => {
            const countDraft: CoreReviewListDraft = {
                ...appliedDraft,
                verificationStatusFilter: "all",
                pageSize: 1,
            };
            const fetchCount = (verificationStatusFilter: CoreReviewVerificationStatusFilter) =>
                getCoreReviewList(
                    apiSlug,
                    {
                        ...buildListParamsFromDraft(countDraft, 1, filterSupport, verificationStatusFilter),
                        pageSize: 1,
                    },
                    { signal }
                ).then((res) => res.pagination.total);

            const [total, verified, unverified] = await Promise.all([
                fetchCount("all"),
                fetchCount("verified"),
                fetchCount("unverified"),
            ]);
            return { total, verified, unverified };
        },
        enabled: queryEnabled,
        staleTime: CORE_REVIEW_VERIFICATION_TOTALS_STALE_MS,
        gcTime: CORE_REVIEW_VERIFICATION_TOTALS_GC_MS,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        retry: (count, err) => {
            if (isAbortError(err)) return false;
            return count < 1;
        },
    });

    if (!queryEnabled) {
        if (listVerificationCounts) {
            return { ...listVerificationCounts, isLoading: false };
        }
        return { total: 0, verified: 0, unverified: 0, isLoading: false };
    }

    return {
        total: query.data?.total ?? 0,
        verified: query.data?.verified ?? 0,
        unverified: query.data?.unverified ?? 0,
        isLoading: query.isFetching && !query.data,
    };
}

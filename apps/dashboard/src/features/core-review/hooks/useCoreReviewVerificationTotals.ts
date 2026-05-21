"use client";

import { useEffect, useState } from "react";

import {
    getCoreReviewList,
    isAbortError,
    type CoreReviewEntitySlug,
} from "@/src/lib/api";

import type { CoreReviewFilterSupport } from "../config/entity-config-types";
import {
    buildListParamsFromDraft,
    type CoreReviewListDraft,
} from "./useCoreReviewListState";

export type CoreReviewVerificationTotals = {
    total: number;
    verified: number;
    unverified: number;
    isLoading: boolean;
};

export function useCoreReviewVerificationTotals(options: {
    apiSlug: CoreReviewEntitySlug;
    appliedDraft: CoreReviewListDraft;
    filterSupport: CoreReviewFilterSupport;
    enabled: boolean;
}): CoreReviewVerificationTotals {
    const { apiSlug, appliedDraft, filterSupport, enabled } = options;
    const [totals, setTotals] = useState<CoreReviewVerificationTotals>({
        total: 0,
        verified: 0,
        unverified: 0,
        isLoading: true,
    });

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        queueMicrotask(() => {
            if (!active) {
                return;
            }

            if (!enabled || !filterSupport.isVerified) {
                setTotals({ total: 0, verified: 0, unverified: 0, isLoading: false });
                return;
            }

            setTotals((prev) => ({ ...prev, isLoading: true }));

            const countDraft: CoreReviewListDraft = {
                ...appliedDraft,
                verifiedFilter: "all",
                pageSize: 1,
            };

            const fetchCount = (verifiedFilter: "all" | "verified" | "unverified") =>
                getCoreReviewList(
                    apiSlug,
                    {
                        ...buildListParamsFromDraft(countDraft, 1, filterSupport, verifiedFilter),
                        pageSize: 1,
                    },
                    { signal: controller.signal }
                ).then((res) => res.pagination.total);

            void Promise.all([
                fetchCount("all"),
                fetchCount("verified"),
                fetchCount("unverified"),
            ])
                .then(([total, verified, unverified]) => {
                    if (active && !controller.signal.aborted) {
                        setTotals({ total, verified, unverified, isLoading: false });
                    }
                })
                .catch((err) => {
                    if (active && !isAbortError(err) && !controller.signal.aborted) {
                        setTotals({ total: 0, verified: 0, unverified: 0, isLoading: false });
                    }
                });
        });

        return () => {
            active = false;
            controller.abort();
        };
    }, [apiSlug, appliedDraft, filterSupport, enabled]);

    return totals;
}

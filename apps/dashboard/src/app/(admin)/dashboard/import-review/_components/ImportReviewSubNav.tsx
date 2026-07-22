"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import FamilyTopNav from "@/src/components/dashboard/FamilyTopNav";
import {
    importReviewEntityHref,
    importReviewHistoryHref,
    importReviewOverviewHref,
    importReviewPromotionHref,
    IMPORT_REVIEW_NAV_ENTITIES,
} from "@/src/lib/importReviewEntityConfig";
import { reviewBatchIdFromImportReviewSearch } from "@/src/lib/importReviewSnapshot";
import { isImportReviewRequestDebugEnabled } from "@/src/features/import-review/utils/importReviewRequestDebug";

export default function ImportReviewSubNav() {
    const searchParams = useSearchParams();
    const searchKey = searchParams.toString();
    const reviewBatchId = useMemo(
        () => reviewBatchIdFromImportReviewSearch(searchParams),
        [searchKey]
    );

    const pathname = usePathname() ?? "";

    const tabs = useMemo(
        () => [
            {
                label: "Overview",
                href: importReviewOverviewHref(searchParams),
                match: "exact" as const,
            },
            ...IMPORT_REVIEW_NAV_ENTITIES.map((entity) => ({
                label: entity.pluralLabel,
                href: importReviewEntityHref(entity.slug, searchParams, reviewBatchId || null),
                match: "prefix" as const,
            })),
            {
                label: "Apply",
                href: importReviewPromotionHref(searchParams),
                match: "prefix" as const,
            },
            {
                label: "History",
                href: importReviewHistoryHref(),
                match: "prefix" as const,
            },
        ],
        [searchKey, reviewBatchId]
    );

    useEffect(() => {
        if (!isImportReviewRequestDebugEnabled()) {
            return;
        }
        console.debug("[import-review:requests]", "subnav_tabs", {
            pathname,
            review_batch_id: reviewBatchId || null,
            tab_count: tabs.length,
            tab_hrefs: tabs.map((t) => t.href.split("?")[0]),
        });
    }, [pathname, reviewBatchId, tabs]);

    return <FamilyTopNav ariaLabel="Import review sections" tabs={tabs} />;
}

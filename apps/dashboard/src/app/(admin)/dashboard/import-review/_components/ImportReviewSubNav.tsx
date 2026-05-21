"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";

import FamilyTopNav from "@/src/components/dashboard/FamilyTopNav";
import {
    importReviewEntityHref,
    importReviewHistoryHref,
    importReviewOverviewHref,
    importReviewPromotionHref,
    IMPORT_REVIEW_NAV_ENTITIES,
} from "@/src/lib/importReviewEntityConfig";
import { reviewBatchIdFromImportReviewSearch } from "@/src/lib/importReviewSnapshot";

export default function ImportReviewSubNav() {
    const searchParams = useSearchParams();
    const reviewBatchId = reviewBatchIdFromImportReviewSearch(searchParams);

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
                label: "Promotion",
                href: importReviewPromotionHref(searchParams),
                match: "prefix" as const,
            },
            {
                label: "History",
                href: importReviewHistoryHref(),
                match: "prefix" as const,
            },
        ],
        [searchParams, reviewBatchId]
    );

    return <FamilyTopNav ariaLabel="Import review sections" tabs={tabs} />;
}

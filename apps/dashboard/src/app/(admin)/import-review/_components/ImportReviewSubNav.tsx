"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
    importReviewEntityHref,
    importReviewHistoryHref,
    importReviewOverviewHref,
    importReviewPromotionHref,
    IMPORT_REVIEW_NAV_ENTITIES,
} from "@/src/lib/importReviewEntityConfig";
import { reviewBatchIdFromImportReviewSearch } from "@/src/lib/importReviewSnapshot";

function isNavActive(pathname: string, href: string): boolean {
    const path = href.split("?")[0] ?? href;
    if (path === "/import-review") {
        return pathname === "/import-review";
    }
    return pathname === path || pathname.startsWith(`${path}/`);
}

export default function ImportReviewSubNav() {
    const pathname = usePathname() ?? "";
    const searchParams = useSearchParams();
    const reviewBatchId = reviewBatchIdFromImportReviewSearch(searchParams);

    const linkCls = (href: string) => {
        const active = isNavActive(pathname, href);
        return `block rounded-md px-2.5 py-1.5 text-sm ${
            active ? "bg-gray-900 font-medium text-white" : "text-gray-700 hover:bg-gray-100"
        }`;
    };

    return (
        <nav
            aria-label="Import review sections"
            className="border-b border-gray-200 bg-white px-4 py-2 sm:px-6"
        >
            <div className="flex flex-wrap gap-1">
                <Link href={importReviewOverviewHref(searchParams)} className={linkCls("/import-review")}>
                    Overview
                </Link>
                {IMPORT_REVIEW_NAV_ENTITIES.map((entity) => (
                    <Link
                        key={entity.slug}
                        href={importReviewEntityHref(entity.slug, searchParams, reviewBatchId || null)}
                        className={linkCls(`/import-review/${entity.slug}`)}
                    >
                        {entity.pluralLabel}
                    </Link>
                ))}
                <Link href={importReviewPromotionHref(searchParams)} className={linkCls("/import-review/promotion")}>
                    Promotion
                </Link>
                <Link href={importReviewHistoryHref()} className={linkCls("/import-review/history")}>
                    History
                </Link>
            </div>
        </nav>
    );
}

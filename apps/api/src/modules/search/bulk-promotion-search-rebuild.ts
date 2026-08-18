import type { PrismaClient } from "@prisma/client";

import type { PromotionFamilyItemCounts } from "../import-review/import-review-promotion-promote-api.js";
import {
    rebuildSearchFamilies,
    type SearchFamilyRebuildLog,
    type SearchFamilyRebuildOutcome,
} from "./search-family-rebuild.js";

/** Import-review publish entity family → unified search source view keys. */
export const IMPORT_REVIEW_ENTITY_FAMILY_SEARCH_VIEWS: Readonly<Record<string, readonly string[]>> = {
    places: ["places"],
    roads: ["street_groups"],
    admin_areas: ["admin_areas"],
    buildings: ["buildings"],
    land_area: ["land_area"],
    water_lines: ["water_lines"],
    water_polygons: ["water_polygons"],
    // addresses use legacy search.refresh_address_index (handled separately).
    // routing_barriers are not indexed in unified search.
};

export const TRANSPORT_BULK_IMPORT_SEARCH_VIEWS = ["bus_stops", "bus_routes"] as const;

export function resolveSearchViewsForPromotedFamilies(args: {
    promotedFamilies: Iterable<string>;
    countsByFamily?: Readonly<Record<string, Pick<PromotionFamilyItemCounts, "success"> | undefined>>;
}): string[] {
    const views = new Set<string>();

    for (const family of args.promotedFamilies) {
        if (args.countsByFamily) {
            const promotedCount = args.countsByFamily[family]?.success ?? 0;
            if (promotedCount <= 0) {
                continue;
            }
        }

        const mapped = IMPORT_REVIEW_ENTITY_FAMILY_SEARCH_VIEWS[family];
        if (!mapped) {
            continue;
        }
        for (const view of mapped) {
            views.add(view);
        }
    }

    return [...views].sort();
}

/**
 * After a successful import-review bulk promotion, rebuild only the affected
 * unified search families in one SQL call.
 */
export async function rebuildSearchAfterImportReviewBulkPromotion(
    prisma: PrismaClient,
    args: {
        workflow: string;
        promotedCount: number;
        promotedFamilies: Iterable<string>;
        countsByFamily?: Readonly<Record<string, Pick<PromotionFamilyItemCounts, "success"> | undefined>>;
        batchId?: bigint;
    },
    log?: SearchFamilyRebuildLog,
): Promise<SearchFamilyRebuildOutcome | null> {
    if (args.promotedCount <= 0) {
        return null;
    }

    const views = resolveSearchViewsForPromotedFamilies({
        promotedFamilies: args.promotedFamilies,
        countsByFamily: args.countsByFamily,
    });
    if (views.length === 0) {
        return null;
    }

    log?.info?.(
        {
            workflow: args.workflow,
            batchId: args.batchId?.toString(),
            views,
            promoted_count: args.promotedCount,
        },
        "rebuilding unified search families after bulk promotion",
    );

    return rebuildSearchFamilies(prisma, views, log);
}

/** Rebuild a single known search family after a smaller split promotion batch. */
export async function rebuildSearchAfterSplitPromotion(
    prisma: PrismaClient,
    args: {
        workflow: string;
        promotedCount: number;
        views: readonly string[];
        batchId?: bigint;
    },
    log?: SearchFamilyRebuildLog,
): Promise<SearchFamilyRebuildOutcome | null> {
    if (args.promotedCount <= 0 || args.views.length === 0) {
        return null;
    }

    log?.info?.(
        {
            workflow: args.workflow,
            batchId: args.batchId?.toString(),
            views: args.views,
            promoted_count: args.promotedCount,
        },
        "rebuilding unified search families after split promotion",
    );

    return rebuildSearchFamilies(prisma, args.views, log);
}

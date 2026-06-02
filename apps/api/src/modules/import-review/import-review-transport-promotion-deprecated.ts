import type { PrismaClient } from "@prisma/client";

import {
    DISABLED_IMPORT_REVIEW_PROMOTION_FAMILIES,
    type DisabledImportReviewPromotionFamily,
} from "./import-review-promotion-config.js";
import {
    ImportReviewTransportPromotionDeprecatedError,
    TRANSPORT_PROMOTION_DEPRECATED_MESSAGE,
} from "./import-review-promotion.errors.js";

/** Legacy core.core_bus_* families — review-only; promotion frozen in favor of import_transport/core_transport. */
export const DEPRECATED_CORE_BUS_PUBLISH_FAMILIES = DISABLED_IMPORT_REVIEW_PROMOTION_FAMILIES;

export type DeprecatedCoreBusPublishFamily = DisabledImportReviewPromotionFamily;

export const DEPRECATED_CORE_BUS_PUBLISH_MESSAGE = TRANSPORT_PROMOTION_DEPRECATED_MESSAGE;

export function isDeprecatedCoreBusPublishFamily(family: string): family is DeprecatedCoreBusPublishFamily {
    return (DEPRECATED_CORE_BUS_PUBLISH_FAMILIES as readonly string[]).includes(family);
}

export function findDeprecatedCoreBusPublishFamilies(families: readonly string[]): DeprecatedCoreBusPublishFamily[] {
    return families.filter(isDeprecatedCoreBusPublishFamily);
}

export function assertDeprecatedCoreBusPublishFamiliesNotRequested(families: readonly string[]): void {
    const blocked = findDeprecatedCoreBusPublishFamilies(families);
    if (blocked.length > 0) {
        throw new ImportReviewTransportPromotionDeprecatedError(blocked);
    }
}

export async function countDeprecatedCoreBusPublishItems(
    prisma: PrismaClient,
    batchId: bigint
): Promise<number> {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count
        FROM system.system_publish_items
        WHERE publish_batch_id = ${batchId}
          AND entity_family IN (
            'bus_stops',
            'bus_routes',
            'bus_route_variants',
            'bus_route_stops'
          )
    `;
    return Number(rows[0]?.count ?? 0n);
}

export async function assertPublishBatchHasNoDeprecatedCoreBusItems(
    prisma: PrismaClient,
    batchId: bigint
): Promise<void> {
    const count = await countDeprecatedCoreBusPublishItems(prisma, batchId);
    if (count > 0) {
        throw new ImportReviewTransportPromotionDeprecatedError([...DEPRECATED_CORE_BUS_PUBLISH_FAMILIES]);
    }
}

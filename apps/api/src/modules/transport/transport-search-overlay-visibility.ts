import { Prisma } from "@prisma/client";

/**
 * Search overlay / geometry visibility.
 *
 * Wider than public-release tiles (`reviewed` + `verified` only).
 * Search may highlight unreviewed-but-active rows (including YBS).
 *
 * Hidden: inactive, deleted, rejected.
 */
export const SEARCH_OVERLAY_REJECTED_STATUS = "rejected";

export function isSearchOverlayReviewAllowed(status: string | null | undefined): boolean {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized !== SEARCH_OVERLAY_REJECTED_STATUS;
}

/** SQL predicate for search geometry / map-preview (alias must be a trusted identifier). */
export function sqlSearchOverlayVisible(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        ${a}.is_active = true
        AND ${a}.deleted_at IS NULL
        AND ${a}.review_status IS DISTINCT FROM ${SEARCH_OVERLAY_REJECTED_STATUS}
    `;
}

/** String form for static GEOMETRY_SOURCES templates (alias is a trusted identifier). */
export function searchOverlayActiveCondition(alias: string): string {
    return (
        `${alias}.is_active = true AND ${alias}.deleted_at IS NULL` +
        ` AND ${alias}.review_status IS DISTINCT FROM '${SEARCH_OVERLAY_REJECTED_STATUS}'`
    );
}

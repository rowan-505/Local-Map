/**
 * Phase 12 — public release visibility for transport entities.
 *
 * Public map/API/mobile only expose rows that pass all of:
 *   review_status IN ('reviewed', 'verified')
 *   is_active = true
 *   deleted_at IS NULL
 *
 * Dashboard admin endpoints may return every review_status.
 */

import { Prisma } from "@prisma/client";

import { derivePublicVisibility, type PublicVisibility } from "./transport-review.js";

export const PUBLIC_RELEASE_REVIEW_STATUSES = ["reviewed", "verified"] as const;

export type PublicReleaseReviewStatus = (typeof PUBLIC_RELEASE_REVIEW_STATUSES)[number];

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Loose UUID shape for stop lookup — matches the tile/route contract (any UUID version)
 * and the public route param schema. Kept separate from the strict {@link UUID_RE} used
 * for route-code disambiguation so a valid non-v4 `public_id` is never misclassified.
 */
const LOOKUP_UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NUMERIC_ID_RE = /^\d+$/;

/**
 * Single lookup contract for `GET /public/transport/stops/:id`:
 * - numeric string  → `transport.stops.id`
 * - uuid string     → `transport.stops.public_id`
 * - anything else   → invalid (caller returns 404, never guesses another id)
 */
export type TransportStopLookupClassification =
    | { kind: "numeric"; id: bigint }
    | { kind: "uuid"; publicId: string }
    | { kind: "invalid" };

export function classifyTransportStopLookupId(
    rawLookupId: string,
): TransportStopLookupClassification {
    const value = rawLookupId.trim();
    if (NUMERIC_ID_RE.test(value)) {
        return { kind: "numeric", id: BigInt(value) };
    }
    if (LOOKUP_UUID_RE.test(value)) {
        return { kind: "uuid", publicId: value };
    }
    return { kind: "invalid" };
}

export function isPublicReleaseReviewStatus(status: string): status is PublicReleaseReviewStatus {
    return (PUBLIC_RELEASE_REVIEW_STATUSES as readonly string[]).includes(status);
}

export function isTransportRouteCodeParam(value: string): boolean {
    return value.trim().length > 0 && !UUID_RE.test(value);
}

export function isTransportPublicIdParam(value: string): boolean {
    return UUID_RE.test(value);
}

/** SQL predicate for tables with soft-delete (routes, variants, paths, stops). */
export function sqlPublicReleaseVisible(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        ${a}.review_status IN ('reviewed', 'verified')
        AND ${a}.is_active = true
        AND ${a}.deleted_at IS NULL
    `;
}

/**
 * Public release visibility for tables that have review_status + is_active
 * but no deleted_at column (live transport.fares).
 */
export function sqlPublicReleaseVisibleWithoutDeletedAt(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        ${a}.review_status IN ('reviewed', 'verified')
        AND ${a}.is_active = true
    `;
}

/**
 * Canonical transport.stop row exists for public detail lookup.
 * Matches tile click contract: `public_id` from `tiles.transport_stops_v` maps to
 * `transport.stops.public_id` without review_status gating. Route lists still use
 * {@link sqlPublicReleaseVisible}.
 */
export function sqlCanonicalTransportStopExists(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        ${a}.is_active = true
        AND ${a}.deleted_at IS NULL
    `;
}

/**
 * Canonical transport.terminal row exists for public detail lookup.
 * Matches tile click contract without review_status gating on the row itself.
 */
export function sqlCanonicalTransportTerminalExists(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        ${a}.is_active = true
        AND ${a}.deleted_at IS NULL
    `;
}

/** Same lookup contract as stops: numeric id or uuid public_id. */
export const classifyTransportTerminalLookupId = classifyTransportStopLookupId;

export type PublicPreviewState =
    | "hidden_imported_unreviewed"
    | "hidden_needs_review"
    | "hidden_inactive"
    | "hidden_rejected"
    | "hidden_other"
    | "visible_reviewed"
    | "visible_verified";

export type PublicPreviewBadge = {
    visibility: PublicVisibility;
    state: PublicPreviewState;
    label: string;
    detail: string;
};

/** Dashboard route detail badge copy for public release preview. */
export function derivePublicPreviewBadge(input: {
    review_status: string;
    is_active: boolean;
    deleted_at?: string | Date | null;
}): PublicPreviewBadge {
    const visibility = derivePublicVisibility(input);

    if (input.deleted_at) {
        return {
            visibility: "hidden",
            state: "hidden_inactive",
            label: "Hidden: inactive",
            detail: "Route is deleted.",
        };
    }

    if (!input.is_active) {
        return {
            visibility: "hidden",
            state: "hidden_inactive",
            label: "Hidden: inactive",
            detail: "Route is inactive.",
        };
    }

    if (input.review_status === "imported_unreviewed") {
        return {
            visibility: "hidden",
            state: "hidden_imported_unreviewed",
            label: "Hidden: imported_unreviewed",
            detail: "Not shown on public map/API until metadata is reviewed.",
        };
    }

    if (input.review_status === "needs_review") {
        return {
            visibility: "hidden",
            state: "hidden_needs_review",
            label: "Hidden: needs_review",
            detail: "Not shown on public map/API until review issues are resolved.",
        };
    }

    if (input.review_status === "reviewed") {
        return {
            visibility: "visible",
            state: "visible_reviewed",
            label: "Visible: reviewed",
            detail: "Eligible for public map/API when active.",
        };
    }

    if (input.review_status === "verified") {
        return {
            visibility: "visible",
            state: "visible_verified",
            label: "Visible: verified",
            detail: "Eligible for public map/API when active.",
        };
    }

    if (input.review_status === "rejected") {
        return {
            visibility: "hidden",
            state: "hidden_rejected",
            label: "Hidden: rejected",
            detail: "Rejected routes are never public.",
        };
    }

    return {
        visibility,
        state: "hidden_other",
        label: "Hidden",
        detail: `review_status=${input.review_status}`,
    };
}

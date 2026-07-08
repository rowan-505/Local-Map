/**
 * YBS / transport review helpers: visibility, geometry labels, status transitions,
 * and verification guards before marking routes verified.
 */

export const TRANSPORT_REVIEW_STATUSES = [
    "imported_unreviewed",
    "needs_review",
    "reviewed",
    "verified",
    "rejected",
    "manual_protected",
] as const;

export type TransportReviewStatus = (typeof TRANSPORT_REVIEW_STATUSES)[number];

export type TransportReviewAction =
    | "mark_reviewed"
    | "mark_needs_review"
    | "mark_verified"
    | "reject";

export type RouteGeometryStatus = "no_path" | "estimate" | "manual" | "verified";
export type PublicVisibility = "hidden" | "visible";
export type StopGeometryStatus = "missing" | "estimate" | "manual" | "verified";
export type DuplicateStatus = "none" | "nearby" | "duplicate_name";

const DIRTY_STOP_PATTERN_MY = "မှတ်တိုင် အမှတ်";
const DIRTY_STOP_NAMES_EN = new Set(["Bus Details", "Bus Stops"]);

export function derivePublicVisibility(input: {
    review_status: string;
    is_active: boolean;
    deleted_at?: string | Date | null;
}): PublicVisibility {
    if (input.deleted_at) {
        return "hidden";
    }
    if (!input.is_active) {
        return "hidden";
    }
    if (input.review_status === "reviewed" || input.review_status === "verified") {
        return "visible";
    }
    return "hidden";
}

export function deriveRouteGeometryStatus(input: {
    path_count: number;
    has_estimate_path?: boolean;
    has_verified_path?: boolean;
}): RouteGeometryStatus {
    if (input.path_count <= 0) {
        return "no_path";
    }
    if (input.has_verified_path) {
        return "verified";
    }
    if (input.has_estimate_path) {
        return "estimate";
    }
    return "manual";
}

export function deriveStopGeometryStatus(input: {
    has_geom: boolean;
    review_status: string;
    normalized_data?: Record<string, unknown> | null;
}): StopGeometryStatus {
    if (!input.has_geom) {
        return "missing";
    }
    const normalized = input.normalized_data ?? {};
    const needsReview =
        normalized.needs_geometry_review === true ||
        normalized.geom_source === "generated_route_sequence_estimate";
    if (needsReview || input.review_status === "needs_review") {
        return "estimate";
    }
    if (input.review_status === "verified") {
        return "verified";
    }
    return "manual";
}

export function isPlaceholderStopName(name: string | null | undefined): boolean {
    if (!name?.trim()) {
        return true;
    }
    if (name.includes(DIRTY_STOP_PATTERN_MY)) {
        return true;
    }
    if (DIRTY_STOP_NAMES_EN.has(name.trim())) {
        return true;
    }
    if (/^Unnamed /i.test(name.trim())) {
        return true;
    }
    if (name.includes("osm:")) {
        return true;
    }
    return false;
}

export function reviewActionToStatus(action: TransportReviewAction): TransportReviewStatus {
    switch (action) {
        case "mark_reviewed":
            return "reviewed";
        case "mark_needs_review":
            return "needs_review";
        case "mark_verified":
            return "verified";
        case "reject":
            return "rejected";
    }
}

export function assertReviewTransitionAllowed(
    current: string,
    next: TransportReviewStatus,
): void {
    if (current === "manual_protected") {
        throw new Error("manual_protected rows cannot be changed by review actions.");
    }
    if (next === "rejected" && current !== "manual_protected") {
        return;
    }
    const allowed: Record<string, TransportReviewStatus[]> = {
        imported_unreviewed: ["needs_review", "reviewed", "rejected"],
        needs_review: ["reviewed", "rejected"],
        reviewed: ["verified", "needs_review", "rejected"],
        verified: ["needs_review", "rejected"],
        rejected: ["needs_review", "reviewed"],
    };
    const options = allowed[current] ?? [];
    if (!options.includes(next)) {
        throw new Error(`Cannot change review_status from ${current} to ${next}.`);
    }
}

export type RouteReviewReadiness = {
    can_verify: boolean;
    can_mark_reviewed: boolean;
    blockers: string[];
    mark_reviewed_blockers: string[];
    warnings: string[];
};

export function buildRouteMarkReviewedReadiness(input: {
    names_complete: boolean;
    has_variants: boolean;
    stop_sequence_complete: boolean;
    all_stops_have_geom: boolean;
    all_variants_have_path: boolean;
    all_paths_reviewed: boolean;
}): Pick<RouteReviewReadiness, "can_mark_reviewed" | "mark_reviewed_blockers"> {
    const mark_reviewed_blockers: string[] = [];

    if (!input.names_complete) {
        mark_reviewed_blockers.push("Route Myanmar and English names are required.");
    }
    if (!input.has_variants) {
        mark_reviewed_blockers.push("At least one route variant is required.");
    }
    if (!input.stop_sequence_complete) {
        mark_reviewed_blockers.push("Stop sequence is incomplete on one or more variants.");
    }
    if (!input.all_stops_have_geom) {
        mark_reviewed_blockers.push("One or more stops are missing geometry.");
    }
    if (!input.all_variants_have_path) {
        mark_reviewed_blockers.push("One or more variants are missing a route path.");
    }
    if (!input.all_paths_reviewed) {
        mark_reviewed_blockers.push("One or more route paths are not reviewed yet.");
    }

    return {
        can_mark_reviewed: mark_reviewed_blockers.length === 0,
        mark_reviewed_blockers,
    };
}

export function buildRouteReviewReadiness(input: {
    has_outbound_variant: boolean;
    has_inbound_variant: boolean;
    has_route_path: boolean;
    has_route_stops: boolean;
    has_route_source_link: boolean;
    has_placeholder_stop_name: boolean;
    has_unresolved_duplicate_warning: boolean;
    path_needs_geometry_review: boolean;
}): RouteReviewReadiness {
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!input.has_outbound_variant) blockers.push("Missing outbound variant.");
    if (!input.has_inbound_variant) blockers.push("Missing inbound variant.");
    if (!input.has_route_path) blockers.push("Missing route path.");
    if (!input.has_route_stops) blockers.push("Missing route_stops.");
    if (!input.has_route_source_link) blockers.push("Missing route source_link.");
    if (input.has_placeholder_stop_name) {
        blockers.push("A stop has a placeholder or metadata name.");
    }
    if (input.has_unresolved_duplicate_warning) {
        blockers.push("Unresolved duplicate stop warning exists.");
    }
    if (input.path_needs_geometry_review) {
        blockers.push("Route path still needs geometry review.");
    }

    return {
        can_verify: blockers.length === 0,
        can_mark_reviewed: false,
        blockers,
        mark_reviewed_blockers: [],
        warnings,
    };
}

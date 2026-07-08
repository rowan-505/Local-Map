/**
 * Supabase transport schema mapping for YBS dry-run import planning.
 *
 * Does not touch the database.
 */

import type { ReviewStatus, SourceLinkEntityType } from "./import-plan-types.js";

export const YBS_SOURCE_NAME = "external_ybs_app";
export const YBS_SOURCE_KIND = "visible_app_extraction";

export const TRANSPORT_MODE_BUS = "bus";
export const ROUTE_KIND_URBAN = "urban";
export const STOP_TYPE_STOP = "stop";
export const ROUTE_PATH_KIND_CORRIDOR_ESTIMATE = "corridor_estimate";
export const FARE_TYPE_FLAT = "flat";
export const CURRENCY_CODE_MMK = "MMK";

export const ALLOWED_LANGUAGE_CODES = ["my", "en", "und"] as const;
export const ALLOWED_REVIEW_STATUSES: ReviewStatus[] = [
    "imported_unreviewed",
    "needs_review",
    "reviewed",
    "verified",
    "rejected",
    "manual_protected",
];

export const PROTECTED_REVIEW_STATUSES = new Set<ReviewStatus>([
    "reviewed",
    "verified",
    "manual_protected",
]);

export const MERGEABLE_REVIEW_STATUSES = new Set<ReviewStatus>([
    "imported_unreviewed",
    "needs_review",
]);

export const DEFAULT_REVIEW_STATUS = {
    operator: "imported_unreviewed",
    route: "imported_unreviewed",
    route_variant: "imported_unreviewed",
    stop: "needs_review",
    route_path: "needs_review",
    fare: "imported_unreviewed",
} as const;

export const VALID_SOURCE_LINK_ENTITY_TYPES = new Set<SourceLinkEntityType>([
    "operator",
    "stop",
    "route",
    "route_variant",
    "route_path",
    "route_stop",
    "fare",
]);

export function operatorExternalId(operatorCode: string): string {
    return `operator:ybs_go:${operatorCode.trim().toUpperCase()}`;
}

export function routeExternalId(routeCode: string): string {
    return `route:ybs_go:${routeCode.trim()}`;
}

export function variantExternalId(routeCode: string, directionKey: string): string {
    return `variant:ybs_go:${routeCode.trim()}:${directionKey.trim().toLowerCase()}`;
}

export function stopExternalId(candidateKey: string): string {
    return `stop:ybs_go:${candidateKey}`;
}

export function directionAwareStopExternalId(
    routeCode: string,
    directionKey: string,
    sequence: number,
): string {
    return `stop:ybs_go:${routeCode.trim()}:${directionKey.trim().toLowerCase()}:seq:${sequence}`;
}

export function routeStopExternalId(
    routeCode: string,
    directionKey: string,
    sequence: number,
): string {
    return `route_stop:ybs_go:${routeCode.trim()}:${directionKey.trim().toLowerCase()}:${sequence}`;
}

export function routePathExternalId(routeCode: string, directionKey: string): string {
    return `route_path:ybs_go:${routeCode.trim()}:${directionKey.trim().toLowerCase()}`;
}

export function fareExternalId(routeCode: string): string {
    return `fare:ybs_go:${routeCode.trim()}`;
}

export function entityRefOperator(operatorCode: string): string {
    return `$operator:${operatorCode.trim().toUpperCase()}`;
}

export function entityRefRoute(routeCode: string): string {
    return `$route:${routeCode.trim()}`;
}

export function entityRefVariant(routeCode: string, directionKey: string): string {
    return `$variant:${routeCode.trim()}:${directionKey.trim().toLowerCase()}`;
}

export function entityRefStopCandidate(candidateId: string): string {
    return `$stop:${candidateId}`;
}

export function entityRefStopExisting(stopId: number): string {
    return `$stop:existing:${stopId}`;
}

export function entityRefStopUsage(
    candidateId: string,
    directionKey: string,
    sourceSequence: number,
): string {
    return `$stop:usage:${candidateId}:${directionKey.trim().toLowerCase()}:${sourceSequence}`;
}

export function stopUsageExternalId(
    candidateKey: string,
    directionKey: string,
    sourceSequence: number,
): string {
    return `stop:ybs_go:usage:${candidateKey}:${directionKey.trim().toLowerCase()}:${sourceSequence}`;
}

export function entityRefStopRoutePosition(
    routeCode: string,
    directionKey: string,
    sequence: number,
): string {
    return `$stop:route:${routeCode.trim()}:${directionKey.trim().toLowerCase()}:${sequence}`;
}

export function entityRefRouteStop(routeCode: string, directionKey: string, sequence: number): string {
    return `$route_stop:${routeCode.trim()}:${directionKey.trim().toLowerCase()}:${sequence}`;
}

export function entityRefRoutePath(routeCode: string, directionKey: string): string {
    return `$route_path:${routeCode.trim()}:${directionKey.trim().toLowerCase()}`;
}

export function entityRefFare(routeCode: string): string {
    return `$fare:${routeCode.trim()}`;
}

export function normalizeOperatorCode(operatorName: string | null | undefined): string {
    const value = (operatorName ?? "YBS").trim().toUpperCase();
    return value || "YBS";
}

export function primaryDisplayName(nameMy: string | null | undefined, nameEn: string | null | undefined): string {
    return (nameMy ?? nameEn ?? "Unknown").trim();
}

export type ExistingSourceLinkRow = {
    entity_type: string;
    entity_id: number;
    external_id: string;
    source_name: string;
    source_kind: string;
};

export type ExistingOperatorRow = {
    id: number;
    operator_code: string;
    name: string;
    review_status: string;
};

export type ExistingRouteRow = {
    id: number;
    route_code: string;
    operator_id: number;
    public_name: string;
    review_status: string;
};

export type ExistingStopRow = {
    id: number;
    review_status: string;
    name_mm: string | null;
    name_en: string | null;
};

export type SupabaseCatalog = {
    loaded_at: string;
    database_url_host: string | null;
    source_links_by_external_id: Map<string, ExistingSourceLinkRow>;
    operators_by_code: Map<string, ExistingOperatorRow>;
    routes_by_code: Map<string, ExistingRouteRow>;
    stops_by_id: Map<number, ExistingStopRow>;
};

export function findSourceLink(
    catalog: SupabaseCatalog,
    externalId: string,
): ExistingSourceLinkRow | undefined {
    return catalog.source_links_by_external_id.get(externalId);
}

export function isProtectedReviewStatus(status: string | null | undefined): boolean {
    return PROTECTED_REVIEW_STATUSES.has((status ?? "") as ReviewStatus);
}

export function isMergeableReviewStatus(status: string | null | undefined): boolean {
    return MERGEABLE_REVIEW_STATUSES.has((status ?? "") as ReviewStatus);
}

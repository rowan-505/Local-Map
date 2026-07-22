import { apiFetch } from "@/src/lib/api";
import type {
    TransportDataQualityQueues,
    TransportQualitySummary,
    TransportImportBatchListItem,
    TransportImportErrorListItem,
    TransportSourceLinkListItem,
    TransportOverview,
    TransportPaginated,
    TransportRouteDetail,
    TransportRouteDiagnostics,
    TransportRouteListItem,
    TransportRouteStopItem,
    TransportStopArchiveResult,
    TransportStopDeleteEligibility,
    TransportStopPermanentDeleteResult,
    TransportStopDetail,
    TransportStopListItem,
    TransportStopLocationUpdateResult,
    TransportStopRouteUsage,
    TransportStopRouteUsageDetailResponse,
    TransportStopMergePreviewResponse,
    TransportStopMergeGlobalResult,
    TransportStopSearchResponse,
    TransportNearbyStopCandidatesResponse,
    TransportNearbyStop,
    UpdateTransportStopLocationBody,
    CreateTransportRouteBody,
    CreateTransportVariantBody,
    TransportRouteCreateResult,
    InsertExistingRouteStopBody,
    CreateAndInsertRouteStopBody,
    TransportInfrastructureLineDetail,
    TransportInfrastructureLineListItem,
    TransportTerminalDetail,
    TransportTerminalListItem,
    TransportVariantsResponse,
    TransportVariantStopsResponse,
    TransportVariantStopQualityResponse,
    TransportVariantSummary,
    TransportSwapRouteDirectionResult,
    TransportVariantPathResult,
    PutTransportVariantPathBody,
    GeneratePathFromStopsResult,
    RouteStopMutationResult,
    TransportRouteStopMutationResult,
    UpdateRouteStopBody,
    PatchRouteStopTimingBody,
    PatchVariantDepartureTimeBody,
    UpdateTransportRouteBody,
    PatchTransportRouteMetadataBody,
    UpdateTransportInfrastructureLineBody,
    UpdateTransportStopBody,
    UpdateTransportTerminalBody,
    UpdateTransportVariantBody,
    RouteReviewReadiness,
    TransportReviewAction,
    TransportReviewStatusResult,
    TransportRoutePathReviewResult,
    ReplaceRouteStopResult,
    MergeTransportStopResult,
} from "./types";

export function getTransportOverview(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<TransportOverview>("/transport/overview", {
        method: "GET",
        ...fetchInit,
    });
}

export function getTransportDataQualityQueues(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<TransportDataQualityQueues>("/transport/data-quality/queues", {
        method: "GET",
        ...fetchInit,
    });
}

export function getTransportQualitySummary(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<TransportQualitySummary>("/transport/quality-summary", {
        method: "GET",
        ...fetchInit,
    });
}

export type TransportImportBatchesParams = {
    sourceName?: string;
    sourceKind?: string;
    status?: string;
    limit?: number;
    page?: number;
};

export function getTransportImportBatches(
    params: TransportImportBatchesParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.sourceName) search.set("sourceName", params.sourceName);
    if (params.sourceKind) search.set("sourceKind", params.sourceKind);
    if (params.status) search.set("status", params.status);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.page !== undefined) search.set("page", String(params.page));

    const qs = search.toString();
    return apiFetch<TransportPaginated<TransportImportBatchListItem>>(
        `/transport/import-batches${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export type TransportImportErrorsParams = {
    importBatchId?: number;
    entityType?: string;
    errorCode?: string;
    search?: string;
    limit?: number;
    page?: number;
};

export function getTransportImportErrors(
    params: TransportImportErrorsParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.importBatchId !== undefined)
        search.set("importBatchId", String(params.importBatchId));
    if (params.entityType) search.set("entityType", params.entityType);
    if (params.errorCode) search.set("errorCode", params.errorCode);
    if (params.search) search.set("search", params.search);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.page !== undefined) search.set("page", String(params.page));

    const qs = search.toString();
    return apiFetch<TransportPaginated<TransportImportErrorListItem>>(
        `/transport/import-errors${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export type TransportSourceLinksParams = {
    entityType?: string;
    entityId?: number;
    sourceName?: string;
    sourceKind?: string;
    externalId?: string;
    limit?: number;
    page?: number;
};

export function getTransportSourceLinks(
    params: TransportSourceLinksParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.entityType) search.set("entityType", params.entityType);
    if (params.entityId !== undefined) search.set("entityId", String(params.entityId));
    if (params.sourceName) search.set("sourceName", params.sourceName);
    if (params.sourceKind) search.set("sourceKind", params.sourceKind);
    if (params.externalId) search.set("externalId", params.externalId);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.page !== undefined) search.set("page", String(params.page));

    const qs = search.toString();
    return apiFetch<TransportPaginated<TransportSourceLinkListItem>>(
        `/transport/source-links${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export type TransportRoutesParams = {
    search?: string;
    mode?: string;
    reviewStatus?: string;
    hasStops?: boolean;
    hasPath?: boolean;
    hasSourceLink?: boolean;
    geometryStatus?: string;
    publicVisibility?: string;
    isActive?: boolean;
    limit?: number;
    page?: number;
};

/** Ensures list responses always have arrays and numeric totals (never undefined/204). */
export function normalizeTransportPaginated<T>(
    data: TransportPaginated<T> | null | undefined
): TransportPaginated<T> {
    const items = Array.isArray(data?.items) ? data.items : [];
    const total =
        typeof data?.total === "number" && Number.isFinite(data.total) ? data.total : 0;
    const limit = typeof data?.limit === "number" && data.limit > 0 ? data.limit : items.length || 50;
    const offset = typeof data?.offset === "number" && data.offset >= 0 ? data.offset : 0;
    const page =
        typeof data?.page === "number" && data.page >= 1
            ? data.page
            : Math.floor(offset / limit) + 1;
    const hasNextPage =
        typeof data?.hasNextPage === "boolean" ? data.hasNextPage : offset + items.length < total;

    return { items, total, limit, offset, page, hasNextPage };
}

export async function getTransportRoutes(
    params: TransportRoutesParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.search) search.set("search", params.search);
    if (params.mode) search.set("mode", params.mode);
    if (params.reviewStatus) search.set("reviewStatus", params.reviewStatus);
    if (params.hasStops !== undefined) search.set("hasStops", String(params.hasStops));
    if (params.hasPath !== undefined) search.set("hasPath", String(params.hasPath));
    if (params.hasSourceLink !== undefined) search.set("hasSourceLink", String(params.hasSourceLink));
    if (params.geometryStatus) search.set("geometryStatus", params.geometryStatus);
    if (params.publicVisibility) search.set("publicVisibility", params.publicVisibility);
    if (params.isActive !== undefined) search.set("isActive", String(params.isActive));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.page !== undefined) search.set("page", String(params.page));

    const qs = search.toString();
    const data = await apiFetch<TransportPaginated<TransportRouteListItem>>(
        `/transport/routes${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
    return normalizeTransportPaginated(data);
}

export type TransportStopsParams = {
    search?: string;
    mode?: string;
    stopType?: string;
    reviewStatus?: string;
    generatedName?: boolean;
    hasRoutes?: boolean;
    hasTerminal?: boolean;
    hasSourceLink?: boolean;
    geometryStatus?: string;
    duplicateStatus?: string;
    adminAreaId?: number;
    isActive?: boolean;
    limit?: number;
    page?: number;
};

export function getTransportStops(
    params: TransportStopsParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.search) search.set("search", params.search);
    if (params.mode) search.set("mode", params.mode);
    if (params.stopType) search.set("stopType", params.stopType);
    if (params.reviewStatus) search.set("reviewStatus", params.reviewStatus);
    if (params.generatedName !== undefined) search.set("generatedName", String(params.generatedName));
    if (params.hasRoutes !== undefined) search.set("hasRoutes", String(params.hasRoutes));
    if (params.hasTerminal !== undefined) search.set("hasTerminal", String(params.hasTerminal));
    if (params.hasSourceLink !== undefined) search.set("hasSourceLink", String(params.hasSourceLink));
    if (params.geometryStatus) search.set("geometryStatus", params.geometryStatus);
    if (params.duplicateStatus) search.set("duplicateStatus", params.duplicateStatus);
    if (params.adminAreaId !== undefined) search.set("adminAreaId", String(params.adminAreaId));
    if (params.isActive !== undefined) search.set("isActive", String(params.isActive));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.page !== undefined) search.set("page", String(params.page));

    const qs = search.toString();
    return apiFetch<TransportPaginated<TransportStopListItem>>(
        `/transport/stops${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export type TransportTerminalsParams = {
    search?: string;
    mode?: string;
    terminalRole?: string;
    reviewStatus?: string;
    generatedName?: boolean;
    linkedStop?: boolean;
    adminAreaId?: number;
    confidenceMin?: number;
    confidenceMax?: number;
    isActive?: boolean;
    limit?: number;
    page?: number;
};

export function getTransportTerminals(
    params: TransportTerminalsParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.search) search.set("search", params.search);
    if (params.mode) search.set("mode", params.mode);
    if (params.terminalRole) search.set("terminalRole", params.terminalRole);
    if (params.reviewStatus) search.set("reviewStatus", params.reviewStatus);
    if (params.generatedName !== undefined) search.set("generatedName", String(params.generatedName));
    if (params.linkedStop !== undefined) search.set("linkedStop", String(params.linkedStop));
    if (params.adminAreaId !== undefined) search.set("adminAreaId", String(params.adminAreaId));
    if (params.confidenceMin !== undefined) search.set("confidenceMin", String(params.confidenceMin));
    if (params.confidenceMax !== undefined) search.set("confidenceMax", String(params.confidenceMax));
    if (params.isActive !== undefined) search.set("isActive", String(params.isActive));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.page !== undefined) search.set("page", String(params.page));

    const qs = search.toString();
    return apiFetch<TransportPaginated<TransportTerminalListItem>>(
        `/transport/terminals${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export function getTransportTerminalDetail(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportTerminalDetail>(
        `/transport/terminals/${encodeURIComponent(publicId)}`,
        { method: "GET", ...fetchInit }
    );
}

export function updateTransportTerminal(
    publicId: string,
    body: UpdateTransportTerminalBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportTerminalDetail>(
        `/transport/terminals/${encodeURIComponent(publicId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export type TransportInfrastructureLinesParams = {
    search?: string;
    mode?: string;
    lineType?: string;
    reviewStatus?: string;
    generatedName?: boolean;
    adminAreaId?: number;
    isActive?: boolean;
    limit?: number;
    page?: number;
};

export function getTransportInfrastructureLines(
    params: TransportInfrastructureLinesParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.search) search.set("search", params.search);
    if (params.mode) search.set("mode", params.mode);
    if (params.lineType) search.set("lineType", params.lineType);
    if (params.reviewStatus) search.set("reviewStatus", params.reviewStatus);
    if (params.generatedName !== undefined)
        search.set("generatedName", String(params.generatedName));
    if (params.adminAreaId !== undefined) search.set("adminAreaId", String(params.adminAreaId));
    if (params.isActive !== undefined) search.set("isActive", String(params.isActive));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.page !== undefined) search.set("page", String(params.page));

    const qs = search.toString();
    return apiFetch<TransportPaginated<TransportInfrastructureLineListItem>>(
        `/transport/infrastructure-lines${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export function getTransportInfrastructureLineDetail(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportInfrastructureLineDetail>(
        `/transport/infrastructure-lines/${encodeURIComponent(publicId)}`,
        { method: "GET", ...fetchInit }
    );
}

export function updateTransportInfrastructureLine(
    publicId: string,
    body: UpdateTransportInfrastructureLineBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportInfrastructureLineDetail>(
        `/transport/infrastructure-lines/${encodeURIComponent(publicId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function getTransportStopDetail(publicId: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<TransportStopDetail>(`/transport/stops/${encodeURIComponent(publicId)}`, {
        method: "GET",
        ...fetchInit,
    });
}

export type TransportStopRoutesParams = {
    limit?: number;
    offset?: number;
};

export function getTransportStopRoutes(
    publicId: string,
    params: TransportStopRoutesParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined) search.set("offset", String(params.offset));
    const qs = search.toString();
    return apiFetch<TransportPaginated<TransportStopRouteUsage>>(
        `/transport/stops/${encodeURIComponent(publicId)}/routes${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export function getTransportStopRouteUsageDetail(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportStopRouteUsageDetailResponse>(
        `/transport/stops/${encodeURIComponent(publicId)}/route-usage-detail`,
        { method: "GET", ...fetchInit },
    );
}

export type TransportStopMergePreviewBody = {
    currentStopId: string;
    candidateStopId: string;
};

export function previewTransportStopMerge(
    body: TransportStopMergePreviewBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportStopMergePreviewResponse>("/transport/stops/merge-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...fetchInit,
    });
}

export type TransportStopMergeFieldSource = "current" | "candidate";

export type TransportStopMergeFieldSources = Partial<
    Record<
        | "name"
        | "name_mm"
        | "name_en"
        | "stop_type"
        | "geom"
        | "admin_area_id"
        | "confidence_score"
        | "review_status"
        | "is_active",
        TransportStopMergeFieldSource
    >
>;

export type TransportStopMergeGlobalBody = {
    canonicalStopId: string;
    duplicateStopId: string;
    currentStopId: string;
    candidateStopId: string;
    fieldSources?: TransportStopMergeFieldSources;
    acknowledgeSameVariantOccurrences?: boolean;
    reason?: string;
};

export function mergeTransportStopsGlobal(
    body: TransportStopMergeGlobalBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const payload: TransportStopMergeGlobalBody = {
        canonicalStopId: body.canonicalStopId,
        duplicateStopId: body.duplicateStopId,
        currentStopId: body.currentStopId,
        candidateStopId: body.candidateStopId,
    };
    if (body.fieldSources && Object.keys(body.fieldSources).length > 0) {
        payload.fieldSources = body.fieldSources;
    }
    const trimmed = body.reason?.trim();
    if (trimmed) {
        payload.reason = trimmed;
    }
    return apiFetch<TransportStopMergeGlobalResult>("/transport/stops/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        ...fetchInit,
    });
}

export function mapStopRouteUsageDetailItemToRouteUsage(
    item: TransportStopRouteUsageDetailResponse["items"][number],
    mode = "",
): TransportStopRouteUsage {
    return {
        route_stop_id: item.routeStopId,
        route_public_id: item.routeId,
        route_code: item.routeCode,
        route_name: item.routeName,
        mode,
        variant_public_id: item.variantId,
        variant_code: item.variantCode,
        direction_name: item.directionName,
        headsign: null,
        stop_sequence: item.stopSequence,
    };
}

export type TransportStopSearchParams = {
    search?: string;
    mode?: string;
    nearLng?: number;
    nearLat?: number;
    radiusMeters?: number;
    limit?: number;
    excludeRouteVariantPublicId?: string;
};

export function searchTransportStops(
    params: TransportStopSearchParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.search) search.set("search", params.search);
    if (params.mode) search.set("mode", params.mode);
    if (params.nearLng !== undefined) search.set("nearLng", String(params.nearLng));
    if (params.nearLat !== undefined) search.set("nearLat", String(params.nearLat));
    if (params.radiusMeters !== undefined) search.set("radiusMeters", String(params.radiusMeters));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.excludeRouteVariantPublicId)
        search.set("excludeRouteVariantPublicId", params.excludeRouteVariantPublicId);

    const qs = search.toString();
    return apiFetch<TransportStopSearchResponse>(
        `/transport/stops/search${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export function insertExistingRouteStop(
    variantPublicId: string,
    body: InsertExistingRouteStopBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteStopMutationResult>(
        `/transport/route-variants/${encodeURIComponent(variantPublicId)}/stops/insert-existing`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function createAndInsertRouteStop(
    variantPublicId: string,
    body: CreateAndInsertRouteStopBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteStopMutationResult>(
        `/transport/route-variants/${encodeURIComponent(variantPublicId)}/stops/create-and-insert`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function updateTransportStop(
    publicId: string,
    body: UpdateTransportStopBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportStopDetail>(`/transport/stops/${encodeURIComponent(publicId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...fetchInit,
    });
}

/** Focused stop location edit; returns refreshed detail + nearby stops after save. */
export function updateTransportStopLocation(
    stopPublicId: string,
    body: UpdateTransportStopLocationBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportStopLocationUpdateResult>(
        `/transport/stops/${encodeURIComponent(stopPublicId)}/location`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

/** Preview nearby stops around a point (duplicate check before a location save). */
export function getTransportStopNearby(
    stopPublicId: string,
    params: { lng: number; lat: number; radius_m?: number },
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    search.set("lng", String(params.lng));
    search.set("lat", String(params.lat));
    if (params.radius_m !== undefined) search.set("radius_m", String(params.radius_m));
    return apiFetch<TransportNearbyStop[]>(
        `/transport/stops/${encodeURIComponent(stopPublicId)}/nearby?${search.toString()}`,
        { method: "GET", ...fetchInit }
    );
}

export type NearbyTransportStopCandidatesParams = {
    lat: number;
    lng: number;
    radiusMeters?: 50 | 100 | 200 | 500;
    mode: string;
    selectedStopId: string;
    selectedName?: string;
    limit?: number;
};

export function getNearbyTransportStopCandidates(
    params: NearbyTransportStopCandidatesParams,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    search.set("lat", String(params.lat));
    search.set("lng", String(params.lng));
    search.set("mode", params.mode);
    search.set("selectedStopId", params.selectedStopId);
    if (params.radiusMeters !== undefined) {
        search.set("radiusMeters", String(params.radiusMeters));
    }
    if (params.selectedName?.trim()) {
        search.set("selectedName", params.selectedName.trim());
    }
    if (params.limit !== undefined) {
        search.set("limit", String(params.limit));
    }

    return apiFetch<TransportNearbyStopCandidatesResponse>(
        `/transport/stops/nearby-candidates?${search.toString()}`,
        { method: "GET", ...fetchInit }
    );
}

/**
 * Archive (soft-delete) a stop. The backend rejects with 409 when the stop is
 * still used by routes; on success the stop (and any linked terminal) is
 * soft-deleted. Never hard-deletes and never removes route_stops / source links.
 */
export function archiveTransportStop(
    publicId: string,
    reason?: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const trimmedReason = reason?.trim();
    // Always send a valid JSON body. The request sets Content-Type:
    // application/json, and Fastify rejects an empty body for that content type
    // ("Body cannot be empty..."). When there is no reason we send `{}` (the
    // backend schema treats reason as optional); a reason is sent as `{ reason }`.
    const body = trimmedReason ? { reason: trimmedReason } : {};
    return apiFetch<TransportStopArchiveResult>(
        `/transport/stops/${encodeURIComponent(publicId)}`,
        {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

/** Read-only check for permanent stop deletion eligibility. */
export function getTransportStopDeleteEligibility(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportStopDeleteEligibility>(
        `/transport/stops/${encodeURIComponent(publicId)}/delete-eligibility`,
        { method: "GET", ...fetchInit }
    );
}

/** Permanently delete a stop when the backend reports no blocking references. */
export function permanentDeleteTransportStop(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportStopPermanentDeleteResult>(
        `/transport/stops/${encodeURIComponent(publicId)}/permanent`,
        {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            ...fetchInit,
        }
    );
}

export function getTransportRouteDetail(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteDetail>(
        `/transport/routes/${encodeURIComponent(publicId)}`,
        { method: "GET", ...fetchInit }
    );
}

export function getTransportRouteDiagnostics(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteDiagnostics>(
        `/transport/routes/${encodeURIComponent(publicId)}/diagnostics`,
        { method: "GET", ...fetchInit }
    );
}

export function getTransportRouteVariants(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportVariantsResponse>(
        `/transport/routes/${encodeURIComponent(publicId)}/variants`,
        { method: "GET", ...fetchInit }
    );
}

export type TransportVariantStopsParams = {
    includePath?: boolean;
    limit?: number;
    offset?: number;
};

/**
 * Lightweight ordered stops for the Route Detail panel + map markers. No path
 * geometry (fetch that separately only when needed), no heavy stop fields.
 */
export function getTransportVariantOrderedStops(
    variantPublicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteStopMutationResult>(
        `/transport/route-variants/${encodeURIComponent(variantPublicId)}/ordered-stops`,
        { method: "GET", ...fetchInit }
    );
}

export function getTransportVariantStops(
    variantPublicId: string,
    params: TransportVariantStopsParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.includePath !== undefined) search.set("includePath", String(params.includePath));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.offset !== undefined) search.set("offset", String(params.offset));

    const qs = search.toString();
    return apiFetch<TransportVariantStopsResponse>(
        `/transport/route-variants/${encodeURIComponent(variantPublicId)}/stops${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

/** Read-only stop-quality diagnostics (gaps, path deviation, duplicates) for a variant. */
export function getTransportVariantStopQuality(
    variantPublicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportVariantStopQualityResponse>(
        `/transport/variants/${encodeURIComponent(variantPublicId)}/stop-quality`,
        { method: "GET", ...fetchInit }
    );
}

/**
 * Create a route plus its auto-generated variants. Returns the created route
 * detail including variants (201). Rejects with 409 on a duplicate route_code.
 */
export function createTransportRoute(
    body: CreateTransportRouteBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteCreateResult>("/transport/routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...fetchInit,
    });
}

export function updateTransportRoute(
    publicId: string,
    body: UpdateTransportRouteBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteDetail>(`/transport/routes/${encodeURIComponent(publicId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...fetchInit,
    });
}

export function patchTransportRouteMetadata(
    publicId: string,
    body: PatchTransportRouteMetadataBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteDetail>(
        `/transport/routes/${encodeURIComponent(publicId)}/metadata`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        },
    );
}

/** Create a variant under a route. Returns the created variant summary. */
export function createTransportRouteVariant(
    routePublicId: string,
    body: CreateTransportVariantBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportVariantSummary>(
        `/transport/routes/${encodeURIComponent(routePublicId)}/variants`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function updateTransportRouteVariant(
    publicId: string,
    body: UpdateTransportVariantBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportVariantSummary>(
        `/transport/variants/${encodeURIComponent(publicId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function swapTransportRouteDirection(
    routePublicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportSwapRouteDirectionResult>(
        `/transport/routes/${encodeURIComponent(routePublicId)}/swap-direction`,
        { method: "POST", ...fetchInit },
    );
}

/**
 * Soft-delete a variant (deleted_at = now(), is_active = false). Never hard-deletes
 * and never removes route_stops / route_paths. Returns the parent route detail.
 */
export function deleteTransportRouteVariant(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteDetail>(
        `/transport/variants/${encodeURIComponent(publicId)}`,
        { method: "DELETE", ...fetchInit }
    );
}

/** Create or replace a variant's single active manual route path. */
export function putTransportVariantPath(
    variantPublicId: string,
    body: PutTransportVariantPathBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportVariantPathResult>(
        `/transport/variants/${encodeURIComponent(variantPublicId)}/path`,
        {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

/** Soft-delete a variant's active route path. */
export function deleteTransportVariantPath(
    variantPublicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportVariantPathResult>(
        `/transport/variants/${encodeURIComponent(variantPublicId)}/path`,
        { method: "DELETE", ...fetchInit }
    );
}

/**
 * Generate a road-following route path from the variant's ordered stop locations.
 * Backend replaces the active path for this variant. Returns 501 until implemented.
 */
export function generateTransportVariantPathFromStops(
    variantPublicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<GeneratePathFromStopsResult>(
        `/transport/route-variants/${encodeURIComponent(variantPublicId)}/generate-path-from-stops`,
        { method: "POST", ...fetchInit }
    );
}

export function updateTransportRouteStop(
    id: string,
    body: UpdateRouteStopBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteStopItem>(
        `/transport/route-stops/${encodeURIComponent(id)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function patchTransportRouteStopTiming(
    id: string,
    body: PatchRouteStopTimingBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteStopMutationResult>(
        `/transport/route-stops/${encodeURIComponent(id)}/timing`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function patchTransportVariantDepartureTime(
    variantPublicId: string,
    body: PatchVariantDepartureTimeBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteStopMutationResult>(
        `/transport/route-variants/${encodeURIComponent(variantPublicId)}/departure-time`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function moveTransportRouteStop(
    id: string,
    direction: "up" | "down",
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<RouteStopMutationResult>(
        `/transport/route-stops/${encodeURIComponent(id)}/move`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ direction }),
            ...fetchInit,
        }
    );
}

export function removeTransportRouteStop(
    id: string,
    reason?: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const trimmedReason = reason?.trim();
    // Always send a valid JSON body. The request sets Content-Type:
    // application/json, and Fastify rejects an empty body for that content type
    // ("Body cannot be empty..."). When there is no reason we send `{}` (the
    // backend schema treats reason as optional); a reason is sent as `{ reason }`.
    const body = trimmedReason ? { reason: trimmedReason } : {};
    return apiFetch<TransportRouteStopMutationResult>(
        `/transport/route-stops/${encodeURIComponent(id)}`,
        {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function getTransportRouteReviewReadiness(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<RouteReviewReadiness>(
        `/transport/routes/${encodeURIComponent(publicId)}/review-readiness`,
        { method: "GET", ...fetchInit }
    );
}

export function applyTransportRouteReviewAction(
    publicId: string,
    action: TransportReviewAction,
    reason?: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const body: { action: TransportReviewAction; reason?: string } = { action };
    const trimmed = reason?.trim();
    if (trimmed) body.reason = trimmed;
    return apiFetch<TransportReviewStatusResult>(
        `/transport/routes/${encodeURIComponent(publicId)}/review-action`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function applyTransportStopReviewAction(
    stopPublicId: string,
    action: TransportReviewAction,
    reason?: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const body: { action: TransportReviewAction; reason?: string } = { action };
    const trimmed = reason?.trim();
    if (trimmed) body.reason = trimmed;
    return apiFetch<TransportReviewStatusResult>(
        `/transport/stops/${encodeURIComponent(stopPublicId)}/review-action`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function applyTransportRoutePathReviewAction(
    pathId: string,
    action: TransportReviewAction,
    reason?: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const body: { action: TransportReviewAction; reason?: string } = { action };
    const trimmed = reason?.trim();
    if (trimmed) body.reason = trimmed;
    return apiFetch<TransportRoutePathReviewResult>(
        `/transport/route-paths/${encodeURIComponent(pathId)}/review-action`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function replaceTransportRouteStop(
    routeStopId: string,
    stopPublicId: string,
    reason?: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const body: { stop_public_id: string; reason?: string } = {
        stop_public_id: stopPublicId,
    };
    const trimmed = reason?.trim();
    if (trimmed) body.reason = trimmed;
    return apiFetch<ReplaceRouteStopResult>(
        `/transport/route-stops/${encodeURIComponent(routeStopId)}/replace-stop`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

export function mergeTransportStops(
    sourceStopPublicId: string,
    targetStopPublicId: string,
    reason?: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const body: { target_stop_public_id: string; reason?: string } = {
        target_stop_public_id: targetStopPublicId,
    };
    const trimmed = reason?.trim();
    if (trimmed) body.reason = trimmed;
    return apiFetch<MergeTransportStopResult>(
        `/transport/stops/${encodeURIComponent(sourceStopPublicId)}/merge`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
    );
}

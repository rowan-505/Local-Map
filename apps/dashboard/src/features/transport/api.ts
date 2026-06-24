import { apiFetch } from "@/src/lib/api";
import type {
    TransportDataQualityQueues,
    TransportImportBatchListItem,
    TransportImportErrorListItem,
    TransportSourceLinkListItem,
    TransportOverview,
    TransportPaginated,
    TransportRouteDetail,
    TransportRouteListItem,
    TransportRouteStopItem,
    TransportStopDetail,
    TransportStopListItem,
    TransportStopRouteUsage,
    TransportInfrastructureLineDetail,
    TransportInfrastructureLineListItem,
    TransportTerminalDetail,
    TransportTerminalListItem,
    TransportVariantsResponse,
    TransportVariantStopsResponse,
    TransportVariantSummary,
    RouteStopMutationResult,
    UpdateRouteStopBody,
    UpdateTransportRouteBody,
    UpdateTransportInfrastructureLineBody,
    UpdateTransportStopBody,
    UpdateTransportTerminalBody,
    UpdateTransportVariantBody,
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
    isActive?: boolean;
    limit?: number;
    page?: number;
};

export function getTransportRoutes(
    params: TransportRoutesParams = {},
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params.search) search.set("search", params.search);
    if (params.mode) search.set("mode", params.mode);
    if (params.reviewStatus) search.set("reviewStatus", params.reviewStatus);
    if (params.hasStops !== undefined) search.set("hasStops", String(params.hasStops));
    if (params.hasPath !== undefined) search.set("hasPath", String(params.hasPath));
    if (params.isActive !== undefined) search.set("isActive", String(params.isActive));
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    if (params.page !== undefined) search.set("page", String(params.page));

    const qs = search.toString();
    return apiFetch<TransportPaginated<TransportRouteListItem>>(
        `/transport/routes${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export type TransportStopsParams = {
    search?: string;
    mode?: string;
    stopType?: string;
    reviewStatus?: string;
    generatedName?: boolean;
    hasRoutes?: boolean;
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

export function getTransportRouteDetail(
    publicId: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportRouteDetail>(
        `/transport/routes/${encodeURIComponent(publicId)}`,
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

export function updateTransportRouteVariant(
    publicId: string,
    body: UpdateTransportVariantBody,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<TransportVariantSummary>(
        `/transport/route-variants/${encodeURIComponent(publicId)}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...fetchInit,
        }
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
    return apiFetch<RouteStopMutationResult>(
        `/transport/route-stops/${encodeURIComponent(id)}`,
        {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            ...(trimmedReason ? { body: JSON.stringify({ reason: trimmedReason }) } : {}),
            ...fetchInit,
        }
    );
}

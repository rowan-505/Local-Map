import { apiFetch } from "@/src/lib/api";
import type {
    AdminReport,
    AdminReportDetail,
    AdminReportList,
    MediaAccess,
    ReportAnalyticsSummary,
    ReportAnonymousCount,
    ReportCodeCount,
    ReportRegionCount,
    ReportsListFilters,
    ReportStatusCode,
    RewardReasonCode,
    RewardResult,
} from "./types";

type Signal = Pick<RequestInit, "signal">;

export function listReports(filters: ReportsListFilters = {}, init?: Signal) {
    const sp = new URLSearchParams();
    if (filters.status) sp.set("status", filters.status);
    if (filters.type) sp.set("type", filters.type);
    if (filters.adminAreaId !== undefined) sp.set("adminAreaId", String(filters.adminAreaId));
    if (filters.targetEntityType) sp.set("targetEntityType", filters.targetEntityType);
    if (filters.source) sp.set("source", filters.source);
    if (filters.routeCode) sp.set("routeCode", filters.routeCode);
    if (filters.variantCode) sp.set("variantCode", filters.variantCode);
    if (filters.anonymous !== undefined) sp.set("anonymous", String(filters.anonymous));
    if (filters.createdFrom) sp.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) sp.set("createdTo", filters.createdTo);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));

    const qs = sp.toString();
    return apiFetch<AdminReportList>(`/admin/reports${qs ? `?${qs}` : ""}`, {
        method: "GET",
        ...init,
    });
}

export function getReport(id: string, init?: Signal) {
    return apiFetch<AdminReportDetail>(`/admin/reports/${encodeURIComponent(id)}`, {
        method: "GET",
        ...init,
    });
}

export function getPrivateMediaAccess(assetPublicId: string, init?: Signal) {
    return apiFetch<MediaAccess>(`/admin/media/${encodeURIComponent(assetPublicId)}/access`, {
        method: "GET",
        ...init,
    });
}

export type PublishStopPhotoBody = {
    rotateDegrees?: 0 | 90 | 180 | 270;
    crop?: { x: number; y: number; width: number; height: number } | null;
    blurRects?: { x: number; y: number; width: number; height: number }[];
    note?: string | null;
    isPrimary?: boolean;
};

export function publishStopPhoto(assetPublicId: string, body: PublishStopPhotoBody) {
    return apiFetch(`/admin/media/${encodeURIComponent(assetPublicId)}/publish-stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function changeReportStatus(id: string, statusCode: ReportStatusCode, note?: string) {
    return apiFetch<AdminReport>(`/admin/reports/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusCode, ...(note ? { note } : {}) }),
    });
}

export function requestReportInfo(id: string, message: string) {
    return apiFetch<AdminReportDetail>(`/admin/reports/${encodeURIComponent(id)}/request-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
    });
}

export function updateReportAdminNote(id: string, adminNote: string | null) {
    return apiFetch<AdminReport>(`/admin/reports/${encodeURIComponent(id)}/admin-note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNote }),
    });
}

export function rewardReportPoints(
    id: string,
    body: { pointsDelta: number; reasonCode: RewardReasonCode; note?: string }
) {
    return apiFetch<RewardResult>(`/admin/reports/${encodeURIComponent(id)}/reward-points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function getReportAnalyticsSummary(init?: Signal) {
    return apiFetch<ReportAnalyticsSummary>("/admin/reports/analytics/summary", {
        method: "GET",
        ...init,
    });
}

export function getReportAnalyticsByType(init?: Signal) {
    return apiFetch<ReportCodeCount[]>("/admin/reports/analytics/by-type", {
        method: "GET",
        ...init,
    });
}

export function getReportAnalyticsByStatus(init?: Signal) {
    return apiFetch<ReportCodeCount[]>("/admin/reports/analytics/by-status", {
        method: "GET",
        ...init,
    });
}

export function getReportAnalyticsByRegion(init?: Signal) {
    return apiFetch<ReportRegionCount[]>("/admin/reports/analytics/by-region", {
        method: "GET",
        ...init,
    });
}

export function getReportAnalyticsAnonymous(init?: Signal) {
    return apiFetch<ReportAnonymousCount>("/admin/reports/analytics/anonymous-vs-logged-in", {
        method: "GET",
        ...init,
    });
}

import { apiFetch } from "@/src/lib/api";
import type {
    RoutingAdminBuildDetail,
    RoutingAdminBuildSummary,
    RoutingAdminFeedbackRow,
    RoutingAdminHealthResponse,
    RoutingAdminPaginated,
    RoutingAdminValidationReportRow,
    RoutingFeedbackStatus,
} from "./types";

export function getAdminRoutingHealth(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RoutingAdminHealthResponse>("/admin/routing/health", {
        method: "GET",
        ...fetchInit,
    });
}

export function getAdminRoutingBuilds(
    params?: {
        limit?: number;
        offset?: number;
        engine_code?: string;
        status?: string;
        is_active?: boolean;
    },
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) search.set("limit", String(params.limit));
    if (params?.offset !== undefined) search.set("offset", String(params.offset));
    if (params?.engine_code) search.set("engine_code", params.engine_code);
    if (params?.status) search.set("status", params.status);
    if (params?.is_active !== undefined) search.set("is_active", String(params.is_active));

    const qs = search.toString();
    return apiFetch<RoutingAdminPaginated<RoutingAdminBuildSummary>>(
        `/admin/routing/builds${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export function getAdminRoutingBuild(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RoutingAdminBuildDetail>(`/admin/routing/builds/${encodeURIComponent(id)}`, {
        method: "GET",
        ...fetchInit,
    });
}

export function getAdminRoutingFeedback(
    params?: {
        limit?: number;
        offset?: number;
        status?: RoutingFeedbackStatus;
        problem_type?: string;
    },
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) search.set("limit", String(params.limit));
    if (params?.offset !== undefined) search.set("offset", String(params.offset));
    if (params?.status) search.set("status", params.status);
    if (params?.problem_type) search.set("problem_type", params.problem_type);

    const qs = search.toString();
    return apiFetch<RoutingAdminPaginated<RoutingAdminFeedbackRow>>(
        `/admin/routing/feedback${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

export function patchAdminRoutingFeedbackStatus(
    id: string,
    status: RoutingFeedbackStatus,
    fetchInit?: Pick<RequestInit, "signal">
) {
    return apiFetch<RoutingAdminFeedbackRow>(
        `/admin/routing/feedback/${encodeURIComponent(id)}/status`,
        {
            method: "PATCH",
            body: JSON.stringify({ status }),
            ...fetchInit,
        }
    );
}

export function getAdminRoutingValidationReports(
    params?: {
        limit?: number;
        offset?: number;
        routing_build_id?: string;
        severity?: "info" | "warning" | "error";
        report_scope?: string;
    },
    fetchInit?: Pick<RequestInit, "signal">
) {
    const search = new URLSearchParams();
    if (params?.limit !== undefined) search.set("limit", String(params.limit));
    if (params?.offset !== undefined) search.set("offset", String(params.offset));
    if (params?.routing_build_id) search.set("routing_build_id", params.routing_build_id);
    if (params?.severity) search.set("severity", params.severity);
    if (params?.report_scope) search.set("report_scope", params.report_scope);

    const qs = search.toString();
    return apiFetch<RoutingAdminPaginated<RoutingAdminValidationReportRow>>(
        `/admin/routing/validation-reports${qs ? `?${qs}` : ""}`,
        { method: "GET", ...fetchInit }
    );
}

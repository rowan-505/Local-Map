import { apiFetch } from "@/src/lib/api";
import type {
    AdminLedgerList,
    AdminPointChangeBody,
    AdminUserDetail,
    AdminUserList,
    AnalyticsBucket,
    AnalyticsSummary,
    GrowthBucket,
    PointLedgerItem,
    PointReasonCode,
    PointsAnalytics,
    PointsByReason,
    PointSummary,
    RegionCount,
    RoleCount,
    SavedPlacesAnalytics,
    TopPointUser,
    UserAuditEntry,
    UserPointsResponse,
    UsersListFilters,
} from "./types";

type Signal = Pick<RequestInit, "signal">;

// --- Users ---

export function listUsers(filters: UsersListFilters = {}, init?: Signal) {
    const sp = new URLSearchParams();
    if (filters.search) sp.set("search", filters.search);
    if (filters.role) sp.set("role", filters.role);
    if (filters.emailVerified !== undefined) sp.set("emailVerified", String(filters.emailVerified));
    if (filters.accountStatus) sp.set("accountStatus", filters.accountStatus);
    if (filters.primaryRegionId !== undefined)
        sp.set("primaryRegionId", String(filters.primaryRegionId));
    if (filters.createdFrom) sp.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) sp.set("createdTo", filters.createdTo);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));

    const qs = sp.toString();
    return apiFetch<AdminUserList>(`/admin/users${qs ? `?${qs}` : ""}`, { method: "GET", ...init });
}

export function getUser(id: string, init?: Signal) {
    return apiFetch<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`, {
        method: "GET",
        ...init,
    });
}

export function getUserAudit(id: string, limit = 50, init?: Signal) {
    return apiFetch<UserAuditEntry[]>(
        `/admin/users/${encodeURIComponent(id)}/audit?limit=${limit}`,
        { method: "GET", ...init }
    );
}

export function setUserStatus(
    id: string,
    accountStatus: AdminUserDetail["account_status"],
    init?: Signal
) {
    return apiFetch<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountStatus }),
        ...init,
    });
}

export function setUserAdminNote(id: string, adminNote: string | null, init?: Signal) {
    return apiFetch<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}/admin-note`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminNote }),
        ...init,
    });
}

export function assignUserRole(id: string, roleCode: string, init?: Signal) {
    return apiFetch<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleCode }),
        ...init,
    });
}

export function removeUserRole(id: string, roleCode: string, init?: Signal) {
    return apiFetch<AdminUserDetail>(
        `/admin/users/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleCode)}`,
        { method: "DELETE", ...init }
    );
}

// --- Points ---

export function getUserPoints(id: string, limit = 50, init?: Signal) {
    return apiFetch<UserPointsResponse>(
        `/admin/users/${encodeURIComponent(id)}/points?limit=${limit}`,
        { method: "GET", ...init }
    );
}

export function adjustUserPoints(id: string, body: AdminPointChangeBody, init?: Signal) {
    return apiFetch<{ ledger: PointLedgerItem; summary: PointSummary }>(
        `/admin/users/${encodeURIComponent(id)}/points`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            ...init,
        }
    );
}

export function listPointLedger(
    params: { userId?: string; reasonCode?: PointReasonCode; page?: number; pageSize?: number } = {},
    init?: Signal
) {
    const sp = new URLSearchParams();
    if (params.userId) sp.set("userId", params.userId);
    if (params.reasonCode) sp.set("reasonCode", params.reasonCode);
    if (params.page !== undefined) sp.set("page", String(params.page));
    if (params.pageSize !== undefined) sp.set("pageSize", String(params.pageSize));
    const qs = sp.toString();
    return apiFetch<AdminLedgerList>(`/admin/points/ledger${qs ? `?${qs}` : ""}`, {
        method: "GET",
        ...init,
    });
}

export function listTopPointUsers(limit = 20, init?: Signal) {
    return apiFetch<TopPointUser[]>(`/admin/points/top-users?limit=${limit}`, {
        method: "GET",
        ...init,
    });
}

// --- Analytics ---

export function getAnalyticsSummary(init?: Signal) {
    return apiFetch<AnalyticsSummary>("/admin/users/analytics/summary", { method: "GET", ...init });
}

export function getAnalyticsGrowth(bucket: AnalyticsBucket, days: number, init?: Signal) {
    return apiFetch<GrowthBucket[]>(
        `/admin/users/analytics/growth?bucket=${bucket}&days=${days}`,
        { method: "GET", ...init }
    );
}

export function getAnalyticsByRole(init?: Signal) {
    return apiFetch<RoleCount[]>("/admin/users/analytics/by-role", { method: "GET", ...init });
}

export function getAnalyticsByRegion(init?: Signal) {
    return apiFetch<RegionCount[]>("/admin/users/analytics/by-region", { method: "GET", ...init });
}

export function getAnalyticsPoints(init?: Signal) {
    return apiFetch<PointsAnalytics>("/admin/users/analytics/points", { method: "GET", ...init });
}

export function getAnalyticsSavedPlaces(init?: Signal) {
    return apiFetch<SavedPlacesAnalytics>("/admin/users/analytics/saved-places", {
        method: "GET",
        ...init,
    });
}

export function getAnalyticsPointsByReason(init?: Signal) {
    return apiFetch<PointsByReason[]>("/admin/users/analytics/points-by-reason", {
        method: "GET",
        ...init,
    });
}

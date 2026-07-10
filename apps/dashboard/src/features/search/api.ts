import { apiFetch } from "@/src/lib/api";

import type {
    CreateSearchAliasBody,
    FailedSearchItem,
    FailedSearchList,
    FailedSearchesListFilters,
    SearchAliasItem,
    SearchAliasList,
    SearchAliasesListFilters,
    SearchDocumentList,
    SearchDocumentsListFilters,
    SearchAnalyticsDashboard,
    SearchAnalyticsFilters,
    SearchIndexHealthReport,
    SearchIndexMaintenanceOperation,
    ReindexSearchEntityBody,
    ReindexSearchFamilyBody,
    UpdateFailedSearchBody,
    UpdateSearchAliasBody,
} from "./types";

type Signal = Pick<RequestInit, "signal">;

export function listSearchAliases(filters: SearchAliasesListFilters = {}, init?: Signal) {
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.entity_type) sp.set("entity_type", filters.entity_type);
    if (filters.language_code) sp.set("language_code", filters.language_code);
    if (filters.alias_type) sp.set("alias_type", filters.alias_type);
    if (filters.is_active !== undefined) sp.set("is_active", String(filters.is_active));
    if (filters.entity_id) sp.set("entity_id", filters.entity_id);
    if (filters.has_indexed_entity !== undefined) {
        sp.set("has_indexed_entity", String(filters.has_indexed_entity));
    }
    if (filters.sort) sp.set("sort", filters.sort);
    if (filters.order) sp.set("order", filters.order);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));

    const qs = sp.toString();
    return apiFetch<SearchAliasList>(`/admin/search/aliases${qs ? `?${qs}` : ""}`, {
        method: "GET",
        ...init,
    });
}

export function createSearchAlias(body: CreateSearchAliasBody, init?: Signal) {
    return apiFetch<SearchAliasItem>("/admin/search/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...init,
    });
}

export function updateSearchAlias(id: string, body: UpdateSearchAliasBody, init?: Signal) {
    return apiFetch<SearchAliasItem>(`/admin/search/aliases/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...init,
    });
}

export function disableSearchAlias(id: string, init?: Signal) {
    return apiFetch<SearchAliasItem>(`/admin/search/aliases/${encodeURIComponent(id)}`, {
        method: "DELETE",
        ...init,
    });
}

export function listSearchDocuments(filters: SearchDocumentsListFilters = {}, init?: Signal) {
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.entity_type) sp.set("entity_type", filters.entity_type);
    if (filters.entity_id) sp.set("entity_id", filters.entity_id);
    if (filters.transport_mode) sp.set("transport_mode", filters.transport_mode);
    if (filters.review_status) sp.set("review_status", filters.review_status);
    if (filters.is_verified !== undefined) sp.set("is_verified", String(filters.is_verified));
    if (filters.is_public !== undefined) sp.set("is_public", String(filters.is_public));
    if (filters.is_active !== undefined) sp.set("is_active", String(filters.is_active));
    if (filters.has_alias !== undefined) sp.set("has_alias", String(filters.has_alias));
    if (filters.sync_state) sp.set("sync_state", filters.sync_state);
    if (filters.language) sp.set("language", filters.language);
    if (filters.sort) sp.set("sort", filters.sort);
    if (filters.order) sp.set("order", filters.order);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));

    const qs = sp.toString();
    return apiFetch<SearchDocumentList>(`/admin/search/documents${qs ? `?${qs}` : ""}`, {
        method: "GET",
        ...init,
    });
}

export function listFailedSearches(filters: FailedSearchesListFilters = {}, init?: Signal) {
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.lang) sp.set("lang", filters.lang);
    if (filters.resolved !== undefined) sp.set("resolved", String(filters.resolved));
    if (filters.last_seen_from) sp.set("last_seen_from", filters.last_seen_from);
    if (filters.last_seen_to) sp.set("last_seen_to", filters.last_seen_to);
    if (filters.min_occurrence !== undefined) {
        sp.set("min_occurrence", String(filters.min_occurrence));
    }
    if (filters.sort) sp.set("sort", filters.sort);
    if (filters.order) sp.set("order", filters.order);
    if (filters.page !== undefined) sp.set("page", String(filters.page));
    if (filters.pageSize !== undefined) sp.set("pageSize", String(filters.pageSize));

    const qs = sp.toString();
    return apiFetch<FailedSearchList>(`/admin/search/failed-searches${qs ? `?${qs}` : ""}`, {
        method: "GET",
        ...init,
    });
}

export function getFailedSearch(id: string, init?: Signal) {
    return apiFetch<FailedSearchItem>(`/admin/search/failed-searches/${encodeURIComponent(id)}`, {
        method: "GET",
        ...init,
    });
}

export function updateFailedSearch(id: string, body: UpdateFailedSearchBody, init?: Signal) {
    return apiFetch<FailedSearchItem>(`/admin/search/failed-searches/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...init,
    });
}

export function getSearchAnalyticsDashboard(filters: SearchAnalyticsFilters = {}, init?: Signal) {
    const sp = new URLSearchParams();
    if (filters.period) sp.set("period", filters.period);
    if (filters.from) sp.set("from", filters.from);
    if (filters.to) sp.set("to", filters.to);

    const qs = sp.toString();
    return apiFetch<SearchAnalyticsDashboard>(`/admin/search/analytics${qs ? `?${qs}` : ""}`, {
        method: "GET",
        ...init,
    });
}

export function getSearchIndexHealth(init?: Signal) {
    return apiFetch<SearchIndexHealthReport>("/admin/search/index-health", {
        method: "GET",
        ...init,
    });
}

export function runSearchIndexHealthCheck(init?: Signal) {
    return apiFetch<SearchIndexMaintenanceOperation>("/admin/search/index-health/check", {
        method: "POST",
        ...init,
    });
}

export function repairSearchIndexHealth(init?: Signal) {
    return apiFetch<SearchIndexMaintenanceOperation>("/admin/search/index-health/repair", {
        method: "POST",
        ...init,
    });
}

export function reindexSearchFamily(body: ReindexSearchFamilyBody, init?: Signal) {
    return apiFetch<SearchIndexMaintenanceOperation>("/admin/search/index-health/reindex-family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...init,
    });
}

export function reindexSearchEntity(body: ReindexSearchEntityBody, init?: Signal) {
    return apiFetch<SearchIndexMaintenanceOperation>("/admin/search/index-health/reindex-entity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        ...init,
    });
}

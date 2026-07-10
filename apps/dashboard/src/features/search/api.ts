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
    SearchOverviewSummary,
    SearchAnalyticsDashboard,
    SearchAnalyticsFilters,
    SearchIndexHealthReport,
    SearchIndexMaintenanceOperation,
    ReindexSearchEntityBody,
    ReindexSearchFamilyBody,
    UpdateFailedSearchBody,
    UpdateSearchAliasBody,
} from "./types";
import { buildFailedSearchesRequest } from "./failedSearchesApi";
import { buildSearchAliasesRequest } from "./searchAliasesApi";
import { buildSearchAnalyticsRequest } from "./searchAnalyticsApi";
import { buildSearchDocumentsRequest } from "./searchDocumentsApi";
import { buildSearchOverviewRequest } from "./searchOverviewApi";

type Signal = Pick<RequestInit, "signal">;

export function getSearchOverview(init?: Signal) {
    const [path, requestInit] = buildSearchOverviewRequest(init);
    return apiFetch<SearchOverviewSummary>(path, requestInit);
}

export function listSearchAliases(filters: SearchAliasesListFilters = {}, init?: Signal) {
    const [path, requestInit] = buildSearchAliasesRequest(filters, init);
    return apiFetch<SearchAliasList>(path, requestInit);
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
    const [path, requestInit] = buildSearchDocumentsRequest(filters, init);
    return apiFetch<SearchDocumentList>(path, requestInit);
}

export function listFailedSearches(filters: FailedSearchesListFilters = {}, init?: Signal) {
    const [path, requestInit] = buildFailedSearchesRequest(filters, init);
    return apiFetch<FailedSearchList>(path, requestInit);
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
    const [path, requestInit] = buildSearchAnalyticsRequest(filters, init);
    return apiFetch<SearchAnalyticsDashboard>(path, requestInit);
}

export function getSearchIndexHealth(init?: Signal & { refresh?: boolean }) {
    const query = init?.refresh ? "?refresh=true" : "";
    return apiFetch<SearchIndexHealthReport>(`/admin/search/index-health${query}`, {
        method: "GET",
        signal: init?.signal,
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

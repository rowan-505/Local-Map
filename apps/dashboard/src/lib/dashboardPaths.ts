export const DASHBOARD_PATH = "/dashboard";

export const CORE_REVIEW_PATH = `${DASHBOARD_PATH}/core-review`;
export const IMPORT_REVIEW_PATH = `${DASHBOARD_PATH}/import-review`;
export const REFERENCES_PATH = `${DASHBOARD_PATH}/references`;
export const STATS_PATH = `${DASHBOARD_PATH}/stats`;
export const ROUTING_ADMIN_PATH = `${DASHBOARD_PATH}/routing`;
export const TRANSPORT_PATH = `${DASHBOARD_PATH}/transport`;
export const USERS_PATH = `${DASHBOARD_PATH}/users`;
export const USER_ANALYTICS_PATH = `${DASHBOARD_PATH}/user-analytics`;
export const POINT_MANAGEMENT_PATH = `${DASHBOARD_PATH}/point-management`;
export const REPORTS_PATH = `${DASHBOARD_PATH}/reports`;
export const SEARCH_PATH = `${DASHBOARD_PATH}/search`;

function joinPath(base: string, segment?: string): string {
    const seg = segment?.replace(/^\/+|\/+$/g, "") ?? "";
    return seg ? `${base}/${seg}` : base;
}

export function coreReviewPath(segment?: string): string {
    return joinPath(CORE_REVIEW_PATH, segment);
}

export function importReviewPath(segment?: string): string {
    return joinPath(IMPORT_REVIEW_PATH, segment);
}

export function referencesPath(segment?: string): string {
    return joinPath(REFERENCES_PATH, segment);
}

export function statsPath(segment?: string): string {
    return joinPath(STATS_PATH, segment);
}

export function routingAdminPath(segment?: string): string {
    return joinPath(ROUTING_ADMIN_PATH, segment);
}

export function transportPath(segment?: string): string {
    return joinPath(TRANSPORT_PATH, segment);
}

export function usersPath(segment?: string): string {
    return joinPath(USERS_PATH, segment);
}

export function userAnalyticsPath(segment?: string): string {
    return joinPath(USER_ANALYTICS_PATH, segment);
}

export function pointManagementPath(segment?: string): string {
    return joinPath(POINT_MANAGEMENT_PATH, segment);
}

export function reportsPath(segment?: string): string {
    return joinPath(REPORTS_PATH, segment);
}

export function searchPath(segment?: string): string {
    return joinPath(SEARCH_PATH, segment);
}

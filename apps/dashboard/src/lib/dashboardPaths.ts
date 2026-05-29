export const DASHBOARD_PATH = "/dashboard";

export const CORE_REVIEW_PATH = `${DASHBOARD_PATH}/core-review`;
export const IMPORT_REVIEW_PATH = `${DASHBOARD_PATH}/import-review`;
export const IMPORT_TRANSPORT_PATH = `${DASHBOARD_PATH}/import-transport`;
export const REFERENCES_PATH = `${DASHBOARD_PATH}/references`;
export const STATS_PATH = `${DASHBOARD_PATH}/stats`;
export const ROUTING_ADMIN_PATH = `${DASHBOARD_PATH}/routing`;

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

export function importTransportPath(segment?: string): string {
    return joinPath(IMPORT_TRANSPORT_PATH, segment);
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

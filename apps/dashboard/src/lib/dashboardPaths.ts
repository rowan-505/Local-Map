export const DASHBOARD_PATH = "/dashboard";

export const CORE_REVIEW_PATH = `${DASHBOARD_PATH}/core-review`;
export const IMPORT_REVIEW_PATH = `${DASHBOARD_PATH}/import-review`;
export const REFERENCES_PATH = `${DASHBOARD_PATH}/references`;
export const STATS_PATH = `${DASHBOARD_PATH}/stats`;

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

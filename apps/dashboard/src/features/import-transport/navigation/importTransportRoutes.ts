import { IMPORT_TRANSPORT_PATH, importTransportPath } from "@/src/lib/dashboardPaths";

import { isKnownImportTransportEntitySlug } from "../config/importTransportEntityConfigs";

const IMPORT_TRANSPORT_PREFIX = `${IMPORT_TRANSPORT_PATH}/`;

const RESERVED_SEGMENTS = new Set(["promotion", "history", "gtfs"]);

export function importTransportGtfsHref(): string {
    return importTransportPath("gtfs");
}

export function importTransportHistoryHref(): string {
    return importTransportPath("history");
}

export function importTransportHistoryImportBatchHref(id: string): string {
    return importTransportPath(`history/import-batches/${encodeURIComponent(id)}`);
}

export function importTransportHistoryPromotionBatchHref(id: string): string {
    return importTransportPath(`history/promotion-batches/${encodeURIComponent(id)}`);
}

export function importTransportPromotionBatchHref(id: string): string {
    return importTransportPath(`promotion/${encodeURIComponent(id)}`);
}

export function getImportTransportEntitySlugFromPathname(pathname: string): string | null {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    if (normalized === IMPORT_TRANSPORT_PATH) {
        return null;
    }
    if (!normalized.startsWith(IMPORT_TRANSPORT_PREFIX)) {
        return null;
    }
    const segment = normalized.slice(IMPORT_TRANSPORT_PREFIX.length).split("/")[0]?.trim().toLowerCase() ?? "";
    if (!segment || RESERVED_SEGMENTS.has(segment)) {
        return null;
    }
    return isKnownImportTransportEntitySlug(segment) ? segment : null;
}

export function isImportTransportOverviewPathname(pathname: string): boolean {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    return normalized === IMPORT_TRANSPORT_PATH;
}

export function isImportTransportEntityPathname(pathname: string): boolean {
    return getImportTransportEntitySlugFromPathname(pathname) !== null;
}

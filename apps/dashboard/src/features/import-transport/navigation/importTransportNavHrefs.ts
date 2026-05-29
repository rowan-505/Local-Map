import type { ReadonlyURLSearchParams } from "next/navigation";

import { IMPORT_TRANSPORT_PATH, importTransportPath } from "@/src/lib/dashboardPaths";

import { listImportTransportEntityConfigs } from "../config/importTransportEntityConfigs";
import {
    importBatchIdFromTransportSearch,
    preserveImportTransportScopeInParams,
} from "../utils/importTransportScope";

import { buildImportTransportEntityUrl } from "./buildImportTransportEntityUrl";

type TransportSearchParams = URLSearchParams | ReadonlyURLSearchParams;

export function importTransportOverviewHref(searchParams: TransportSearchParams): string {
    const scope = preserveImportTransportScopeInParams(searchParams);
    const qs = scope.toString();
    return qs ? `${IMPORT_TRANSPORT_PATH}?${qs}` : IMPORT_TRANSPORT_PATH;
}

export function importTransportEntityHref(
    slug: string,
    searchParams: TransportSearchParams,
    importBatchId?: string | null
): string {
    const batch = importBatchId?.trim() || importBatchIdFromTransportSearch(searchParams);
    if (batch) {
        return buildImportTransportEntityUrl(slug, { import_batch_id: batch });
    }
    const scope = preserveImportTransportScopeInParams(searchParams);
    const qs = scope.toString();
    const base = importTransportPath(slug);
    return qs ? `${base}?${qs}` : base;
}

export function importTransportPromotionHref(searchParams: TransportSearchParams): string {
    const scope = preserveImportTransportScopeInParams(searchParams);
    const qs = scope.toString();
    const base = importTransportPath("promotion");
    return qs ? `${base}?${qs}` : base;
}

export const IMPORT_TRANSPORT_NAV_ENTITIES = listImportTransportEntityConfigs();

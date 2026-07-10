import type { PrismaClient } from "@prisma/client";

import {
    mapTransportStopNameFields,
    type TransportStopNameRow,
} from "../../lib/entity-names/transport-stop-detail-select-sql.js";
import type { TransportStopDisplayLang } from "../../lib/entity-names/resolve-transport-stop-display-name.js";
import {
    getTransportTypeFallbackLabel,
    isGeneratedOsmTransportName,
    normalizeTransportNameInput,
} from "./transport-naming.js";
import {
    TransportPublicRepository,
    type PublicStopDetailRow,
    type PublicStopNextPreviewRow,
    type PublicStopRouteServingRow,
    type PublicTerminalDetailRow,
} from "./transport-public.repo.js";
import type { ListPublicTransportRoutesQuery, SearchRoutesBetweenStopsQuery, StopRoutesQuery } from "./transport.schema.js";
import type {
    PublicTransportRouteDetail,
    PublicTransportRouteListItem,
    PublicTransportRouteStopsResponse,
    PublicTransportRouteSearchResponse,
    PublicTransportStopDetail,
    PublicTransportStopKind,
    PublicTransportStopNextPreviewGroup,
    PublicTransportStopNextPreviewItem,
    PublicTransportStopRouteServing,
    PublicTransportStopRouteUsage,
    PublicTransportTerminalDetail,
    PublicTransportVariant,
} from "./transport-public.types.js";
import type { TransportPaginated } from "./transport.types.js";
import { buildRouteSearchCandidates } from "./transport-route-search.js";

const STATION_STOP_TYPES = new Set([
    "bus_station",
    "rail_station",
    "airport",
    "station",
]);

const TERMINAL_STOP_TYPES = new Set(["terminal", "ferry_terminal"]);

function publicSafeTransportName(value: string | null | undefined): string | null {
    const normalized = normalizeTransportNameInput(value);
    if (normalized === null) {
        return null;
    }
    if (isGeneratedOsmTransportName(normalized)) {
        return null;
    }
    return normalized;
}

function mapPublicStopNames(
    row: TransportStopNameRow,
    stopType: string,
    lang?: TransportStopDisplayLang | null,
) {
    return mapTransportStopNameFields(row, {
        lang,
        typeFallback: getTransportTypeFallbackLabel(stopType),
        sanitize: publicSafeTransportName,
    });
}

export function normalizePublicStopKind(rawStopType: string | null | undefined): PublicTransportStopKind {
    const stopType = normalizeTransportNameInput(rawStopType) ?? "bus_stop";
    if (TERMINAL_STOP_TYPES.has(stopType)) {
        return "terminal";
    }
    if (STATION_STOP_TYPES.has(stopType)) {
        return "station";
    }
    return "bus_stop";
}

export function publicTransportReviewStatusLabel(reviewStatus: string): string {
    switch (reviewStatus) {
        case "verified":
            return "Verified";
        case "reviewed":
            return "Reviewed";
        default:
            return "Unverified";
    }
}

function mapRouteServingRow(row: PublicStopRouteServingRow): PublicTransportStopRouteServing {
    return {
        route_id: row.route_id.toString(),
        route_public_id: row.route_public_id,
        route_code: row.route_code,
        public_name: normalizeTransportNameInput(row.public_name),
        variant_id: row.variant_id.toString(),
        variant_public_id: row.variant_public_id,
        variant_code: row.variant_code,
        direction_name: normalizeTransportNameInput(row.direction_name),
        origin_name: normalizeTransportNameInput(row.origin_name),
        destination_name: normalizeTransportNameInput(row.destination_name),
        stop_sequence: row.stop_sequence,
    };
}

/**
 * One row per route variant — keeps the lowest stop_sequence when duplicates slip through.
 * Sort: route_code → variant_code → stop_sequence (stable public API ordering).
 */
export function dedupePublicStopRouteServingRows(
    rows: readonly PublicStopRouteServingRow[],
): PublicStopRouteServingRow[] {
    const byVariant = new Map<string, PublicStopRouteServingRow>();

    for (const row of rows) {
        const key = row.variant_public_id;
        const existing = byVariant.get(key);
        if (!existing || row.stop_sequence < existing.stop_sequence) {
            byVariant.set(key, row);
        }
    }

    return [...byVariant.values()].sort(comparePublicStopRouteServingRows);
}

function comparePublicStopRouteServingRows(
    a: PublicStopRouteServingRow,
    b: PublicStopRouteServingRow,
): number {
    const routeCmp = a.route_code.localeCompare(b.route_code);
    if (routeCmp !== 0) return routeCmp;
    const variantCmp = a.variant_code.localeCompare(b.variant_code);
    if (variantCmp !== 0) return variantCmp;
    return a.stop_sequence - b.stop_sequence;
}

function mapNextPreviewStopRow(
    row: PublicStopNextPreviewRow,
    lang?: TransportStopDisplayLang | null,
): PublicTransportStopNextPreviewItem {
    const names = mapPublicStopNames(
        {
            name_mm: row.name_mm,
            name_en: row.name_en,
            name_und: null,
            canonical_name: null,
        },
        "bus_stop",
        lang,
    );
    const displayName = names.display_name ?? names.name;

    return {
        stop_sequence: row.stop_sequence,
        id: row.stop_id.toString(),
        public_id: row.stop_public_id,
        display_name: displayName,
        name: displayName,
        name_mm: names.name_mm,
        name_my: names.name_my,
        name_en: names.name_en,
        lat: row.latitude,
        lng: row.longitude,
    };
}

function createEmptyNextPreviewGroup(
    route: PublicStopRouteServingRow,
): PublicTransportStopNextPreviewGroup {
    const nextStops: PublicTransportStopNextPreviewItem[] = [];
    return {
        route_id: route.route_id.toString(),
        route_public_id: route.route_public_id,
        route_code: route.route_code,
        public_name: normalizeTransportNameInput(route.public_name),
        variant_id: route.variant_id.toString(),
        variant_public_id: route.variant_public_id,
        variant_code: route.variant_code,
        direction_name: normalizeTransportNameInput(route.direction_name),
        destination_name: normalizeTransportNameInput(route.destination_name),
        current_stop_sequence: route.stop_sequence,
        stop_sequence: route.stop_sequence,
        next_stops: nextStops,
        stops: nextStops,
    };
}

function compareNextPreviewGroups(
    a: PublicTransportStopNextPreviewGroup,
    b: PublicTransportStopNextPreviewGroup,
): number {
    const routeCmp = a.route_code.localeCompare(b.route_code);
    if (routeCmp !== 0) return routeCmp;
    return a.variant_code.localeCompare(b.variant_code);
}

/**
 * Builds next-stop preview groups for every serving route variant.
 * Variants at the route end get `next_stops: []`.
 */
export function buildNextStopsPreview(
    routeRows: readonly PublicStopRouteServingRow[],
    previewRows: readonly PublicStopNextPreviewRow[],
    lang?: TransportStopDisplayLang | null,
): PublicTransportStopNextPreviewGroup[] {
    const servingRoutes = dedupePublicStopRouteServingRows(routeRows);
    const groups = new Map<string, PublicTransportStopNextPreviewGroup>();

    for (const route of servingRoutes) {
        groups.set(route.variant_public_id, createEmptyNextPreviewGroup(route));
    }

    for (const row of previewRows) {
        const key = row.variant_public_id;
        let group = groups.get(key);
        if (!group) {
            group = {
                route_id: row.route_id.toString(),
                route_public_id: row.route_public_id,
                route_code: row.route_code,
                public_name: normalizeTransportNameInput(row.public_name),
                variant_id: row.variant_id.toString(),
                variant_public_id: row.variant_public_id,
                variant_code: row.variant_code,
                direction_name: normalizeTransportNameInput(row.direction_name),
                destination_name: normalizeTransportNameInput(row.destination_name),
                current_stop_sequence: row.anchor_stop_sequence,
                stop_sequence: row.anchor_stop_sequence,
                next_stops: [],
                stops: [],
            };
            groups.set(key, group);
        }
        const stop = mapNextPreviewStopRow(row, lang);
        group.next_stops.push(stop);
    }

    for (const group of groups.values()) {
        group.next_stops.sort((a, b) => a.stop_sequence - b.stop_sequence);
        group.stops = group.next_stops;
    }

    return [...groups.values()].sort(compareNextPreviewGroups);
}

function mapPublicTerminalNames(
    row: PublicTerminalDetailRow,
    lang?: TransportStopDisplayLang | null,
) {
    return mapTransportStopNameFields(
        {
            name_mm: row.name_mm,
            name_en: row.name_en,
            name_und: row.name,
            canonical_name: row.name,
        },
        {
            lang,
            typeFallback: getTransportTypeFallbackLabel(row.terminal_role),
            sanitize: publicSafeTransportName,
        },
    );
}

export function serializePublicTransportTerminalDetail(
    row: PublicTerminalDetailRow,
    routeRows: readonly PublicStopRouteServingRow[],
    options?: { lang?: TransportStopDisplayLang | null },
): PublicTransportTerminalDetail {
    const names = mapPublicTerminalNames(row, options?.lang);

    return {
        id: row.id.toString(),
        publicId: row.public_id,
        public_id: row.public_id,
        entity_type: "terminal",
        name: names.name,
        myanmar_name: names.myanmar_name,
        english_name: names.english_name,
        name_mm: names.name_mm,
        name_my: names.name_my,
        name_en: names.name_en,
        name_und: names.name_und,
        display_name: names.display_name,
        primary_name: names.primary_name,
        canonical_name: names.canonical_name,
        terminal_code: normalizeTransportNameInput(row.terminal_code),
        terminal_role: row.terminal_role,
        mode: row.mode,
        admin_area_name: normalizeTransportNameInput(row.admin_area_name),
        lat: row.latitude,
        lng: row.longitude,
        coordinates: [row.longitude, row.latitude],
        isVerified: row.review_status === "verified",
        verification_status: row.review_status,
        status_label: publicTransportReviewStatusLabel(row.review_status),
        confidenceScore: row.confidence_score,
        route_count: Number(row.route_count),
        routes_serving_this_stop: dedupePublicStopRouteServingRows(routeRows).map(mapRouteServingRow),
    };
}

export function serializePublicTransportStopDetail(
    row: PublicStopDetailRow,
    routeRows: readonly PublicStopRouteServingRow[],
    nextPreviewRows: readonly PublicStopNextPreviewRow[],
    options?: { lang?: TransportStopDisplayLang | null },
): PublicTransportStopDetail {
    const stopKind = normalizePublicStopKind(row.stop_type);
    const names = mapPublicStopNames(row, row.stop_type, options?.lang);

    return {
        id: row.id.toString(),
        publicId: row.public_id,
        public_id: row.public_id,
        name: names.name,
        myanmar_name: names.myanmar_name,
        english_name: names.english_name,
        name_mm: names.name_mm,
        name_my: names.name_my,
        name_en: names.name_en,
        name_und: names.name_und,
        display_name: names.display_name,
        primary_name: names.primary_name,
        canonical_name: names.canonical_name,
        stop_code: normalizeTransportNameInput(row.stop_code),
        stop_type: stopKind,
        mode: row.mode,
        admin_area_name: normalizeTransportNameInput(row.admin_area_name),
        lat: row.latitude,
        lng: row.longitude,
        coordinates: [row.longitude, row.latitude],
        isVerified: row.review_status === "verified",
        verification_status: row.review_status,
        status_label: publicTransportReviewStatusLabel(row.review_status),
        confidenceScore: row.confidence_score,
        route_count: Number(row.route_count),
        routes_serving_this_stop: dedupePublicStopRouteServingRows(routeRows).map(mapRouteServingRow),
        next_stops_preview: buildNextStopsPreview(routeRows, nextPreviewRows, options?.lang),
    };
}

export class TransportPublicService {
    private readonly repo: TransportPublicRepository;

    constructor(prisma: PrismaClient) {
        this.repo = new TransportPublicRepository(prisma);
    }

    listRoutes(
        query: ListPublicTransportRoutesQuery,
    ): Promise<TransportPaginated<PublicTransportRouteListItem>> {
        return this.repo.listRoutes(query);
    }

    getRouteByCode(routeCode: string): Promise<PublicTransportRouteDetail> {
        return this.repo.getRouteByCode(routeCode);
    }

    listVariantsForRouteCode(routeCode: string): Promise<PublicTransportVariant[]> {
        return this.repo.listVariantsForRouteCode(routeCode);
    }

    listStopsForRouteCode(routeCode: string): Promise<PublicTransportRouteStopsResponse> {
        return this.repo.listStopsForRouteCode(routeCode);
    }

    listRoutesForStop(
        stopPublicId: string,
        query: StopRoutesQuery,
    ): Promise<TransportPaginated<PublicTransportStopRouteUsage>> {
        return this.repo.listRoutesForStop(stopPublicId, query);
    }

    /** Public web map stop detail core payload (no reverse-address enrichment). */
    async getPublicStopDetail(
        lookupId: string,
        options?: { lang?: TransportStopDisplayLang | null },
    ): Promise<PublicTransportStopDetail | null> {
        const row = await this.repo.getPublicStopByLookupId(lookupId);
        if (!row) {
            return null;
        }

        const [routeRows, nextPreviewRows] = await Promise.all([
            this.repo.listRoutesServingPublicStop(row.id),
            this.repo.listNextStopsPreviewForPublicStop(row.id),
        ]);

        return serializePublicTransportStopDetail(row, routeRows, nextPreviewRows, options);
    }

    /** Public web map terminal detail core payload (no reverse-address enrichment). */
    async getPublicTerminalDetail(
        lookupId: string,
        options?: { lang?: TransportStopDisplayLang | null },
    ): Promise<PublicTransportTerminalDetail | null> {
        const row = await this.repo.getPublicTerminalByLookupId(lookupId);
        if (!row) {
            return null;
        }

        const routeRows =
            row.linked_stop_id !== null
                ? await this.repo.listRoutesServingPublicStop(row.linked_stop_id)
                : [];

        return serializePublicTransportTerminalDetail(row, routeRows, options);
    }

    /**
     * Direct route candidates between two physical stops on the same variant.
     * Uses forward occurrence pairing (no wrap-around, single traversal).
     */
    async searchRoutesBetweenStops(
        query: SearchRoutesBetweenStopsQuery,
    ): Promise<PublicTransportRouteSearchResponse | null> {
        const originRow = await this.repo.getPublicStopByLookupId(query.origin_stop_public_id);
        const destinationRow = await this.repo.getPublicStopByLookupId(
            query.destination_stop_public_id,
        );
        if (!originRow || !destinationRow) {
            return null;
        }

        const variants = await this.repo.listCandidateVariantsBetweenStops(
            originRow.id,
            destinationRow.id,
        );
        const variantIds = variants.map((variant) => variant.variant_id);
        const stopRows = await this.repo.listVariantStopsForRouteSearch(variantIds);

        return {
            origin_stop_public_id: originRow.public_id,
            destination_stop_public_id: destinationRow.public_id,
            candidates: buildRouteSearchCandidates(
                variants,
                stopRows,
                originRow.id,
                destinationRow.id,
            ),
        };
    }
}

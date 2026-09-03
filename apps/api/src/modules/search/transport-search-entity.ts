/**
 * Mode-agnostic unified search entity types for transport.
 *
 * Canonical index/API types:
 *   transport_stop, transport_terminal, transport_route, transport_route_variant
 *
 * Legacy aliases (bus_*) remain accepted in filters, geometry, and incremental sync
 * during migration. The index stores canonical types after migration 129 + rebuild.
 */

export const CANONICAL_TRANSPORT_SEARCH_ENTITY_TYPES = [
    "transport_stop",
    "transport_terminal",
    "transport_route",
    "transport_route_variant",
] as const;

export type CanonicalTransportSearchEntityType =
    (typeof CANONICAL_TRANSPORT_SEARCH_ENTITY_TYPES)[number];

/** Legacy unified-search entity types kept for backward compatibility. */
export const LEGACY_TRANSPORT_SEARCH_ENTITY_TYPES = [
    "bus_stop",
    "bus_route",
    "bus_route_variant",
] as const;

export type LegacyTransportSearchEntityType = (typeof LEGACY_TRANSPORT_SEARCH_ENTITY_TYPES)[number];

const LEGACY_TO_CANONICAL: Record<LegacyTransportSearchEntityType, CanonicalTransportSearchEntityType> =
    {
        bus_stop: "transport_stop",
        bus_route: "transport_route",
        bus_route_variant: "transport_route_variant",
    };

const CANONICAL_TO_LEGACY: Record<CanonicalTransportSearchEntityType, LegacyTransportSearchEntityType> =
    {
        transport_stop: "bus_stop",
        transport_terminal: "bus_stop", // closest legacy bucket for terminals
        transport_route: "bus_route",
        transport_route_variant: "bus_route_variant",
    };

export const TRANSPORT_SEARCH_MODES = [
    "bus",
    "train",
    "ferry",
    "express",
    "flight",
    "other",
] as const;

export type TransportSearchMode = (typeof TRANSPORT_SEARCH_MODES)[number];

export const TRANSPORT_SEARCH_STOP_TYPES = [
    "stop",
    "station",
    "terminal",
    "airport",
    "ferry_landing",
    "bus_stop",
] as const;

export type TransportSearchStopType = (typeof TRANSPORT_SEARCH_STOP_TYPES)[number];

export type TransportSearchDocumentMetadata = {
    mode?: string | null;
    stop_type?: string | null;
    terminal_role?: string | null;
    review_status?: string | null;
    verification_status?: string | null;
    route_code?: string | null;
    parent_route_public_id?: string | null;
    variant_code?: string | null;
    headsign?: string | null;
    direction_name?: string | null;
    origin_name?: string | null;
    destination_name?: string | null;
};

export function isLegacyTransportSearchEntityType(
    value: string,
): value is LegacyTransportSearchEntityType {
    return (LEGACY_TRANSPORT_SEARCH_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isCanonicalTransportSearchEntityType(
    value: string,
): value is CanonicalTransportSearchEntityType {
    return (CANONICAL_TRANSPORT_SEARCH_ENTITY_TYPES as readonly string[]).includes(value);
}

/** Map legacy bus_* search types to canonical transport_* types. */
export function normalizeTransportSearchEntityType(
    value: string,
): CanonicalTransportSearchEntityType | LegacyTransportSearchEntityType | string {
    const normalized = value.trim().toLowerCase();
    if (isLegacyTransportSearchEntityType(normalized)) {
        return LEGACY_TO_CANONICAL[normalized];
    }
    return normalized;
}

/** Expand a requested filter type to include legacy + canonical index values. */
export function expandTransportSearchEntityTypeFilter(value: string): string[] {
    const normalized = value.trim().toLowerCase();
    if (isLegacyTransportSearchEntityType(normalized)) {
        const canonical = LEGACY_TO_CANONICAL[normalized];
        return [normalized, canonical];
    }
    if (isCanonicalTransportSearchEntityType(normalized)) {
        const legacy = CANONICAL_TO_LEGACY[normalized];
        return legacy ? [normalized, legacy] : [normalized];
    }
    return [normalized];
}

export function expandSearchEntityTypeFilters(types: readonly string[]): string[] {
    const expanded = new Set<string>();
    for (const type of types) {
        const normalized = type.trim().toLowerCase();
        if (normalized === "land_area" || normalized === "landuse") {
            expanded.add("land_area");
            expanded.add("landuse");
            continue;
        }
        for (const value of expandTransportSearchEntityTypeFilter(type)) {
            expanded.add(value);
        }
        expanded.add(normalized);
    }
    return [...expanded];
}

export function readTransportSearchDocumentMetadata(
    addressParts: unknown,
): TransportSearchDocumentMetadata {
    if (!addressParts || typeof addressParts !== "object") {
        return {};
    }
    const row = addressParts as Record<string, unknown>;
    const readString = (key: string): string | null =>
        typeof row[key] === "string" ? row[key] : null;

    return {
        mode: readString("mode"),
        stop_type: readString("stop_type"),
        terminal_role: readString("terminal_role"),
        review_status: readString("review_status"),
        verification_status: readString("verification_status"),
        route_code: readString("route_code"),
        parent_route_public_id: readString("parent_route_public_id"),
        variant_code: readString("variant_code"),
        headsign: readString("headsign"),
        direction_name: readString("direction_name"),
        origin_name: readString("origin_name"),
        destination_name: readString("destination_name"),
    };
}

export function serializePublicTransportSearchFields(
    entityType: string,
    addressParts: unknown,
    categoryCode: string | null,
): {
    entityType: string;
    mode: string | null;
    stopType: string | null;
    reviewStatus: string | null;
    verificationStatus: string | null;
    routeCode: string | null;
    parentRoutePublicId: string | null;
    variantCode: string | null;
    headsign: string | null;
    directionName: string | null;
    originName: string | null;
    destinationName: string | null;
} {
    const canonicalType = normalizeTransportSearchEntityType(entityType);
    const metadata = readTransportSearchDocumentMetadata(addressParts);

    if (!isCanonicalTransportSearchEntityType(canonicalType)) {
        return {
            entityType,
            mode: metadata.mode ?? null,
            stopType: metadata.stop_type ?? categoryCode,
            reviewStatus: metadata.review_status ?? null,
            verificationStatus: metadata.verification_status ?? null,
            routeCode: metadata.route_code ?? null,
            parentRoutePublicId: metadata.parent_route_public_id ?? null,
            variantCode: metadata.variant_code ?? null,
            headsign: metadata.headsign ?? null,
            directionName: metadata.direction_name ?? null,
            originName: metadata.origin_name ?? null,
            destinationName: metadata.destination_name ?? null,
        };
    }

    const mode =
        metadata.mode ??
        (canonicalType === "transport_route" || canonicalType === "transport_route_variant"
            ? categoryCode
            : null);

    const stopType =
        metadata.stop_type ??
        (canonicalType === "transport_stop" ? categoryCode : null);

    return {
        entityType: canonicalType,
        mode,
        stopType,
        reviewStatus: metadata.review_status ?? null,
        verificationStatus: metadata.verification_status ?? null,
        routeCode: metadata.route_code ?? null,
        parentRoutePublicId: metadata.parent_route_public_id ?? null,
        variantCode: metadata.variant_code ?? null,
        headsign: metadata.headsign ?? null,
        directionName: metadata.direction_name ?? null,
        originName: metadata.origin_name ?? null,
        destinationName: metadata.destination_name ?? null,
    };
}

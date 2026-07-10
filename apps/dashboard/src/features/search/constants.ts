export const SEARCH_ALIAS_TYPES = [
    "common_name",
    "abbreviation",
    "alternative_spelling",
    "old_name",
    "transliteration",
    "local_name",
    "search_correction",
] as const;

export const SEARCH_ALIAS_ENTITY_TYPES = [
    "place",
    "admin_area",
    "street_group",
    "address",
    "transport_stop",
    "transport_terminal",
    "transport_route",
    "transport_route_variant",
    "building",
    "landuse",
    "water_line",
    "water_polygon",
] as const;

const ALIAS_TYPE_LABELS: Record<string, string> = {
    common_name: "Common name",
    abbreviation: "Abbreviation",
    alternative_spelling: "Alternative spelling",
    old_name: "Old name",
    transliteration: "Transliteration",
    local_name: "Local name",
    search_correction: "Search correction",
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
    place: "Place",
    admin_area: "Admin area",
    street_group: "Street group",
    address: "Address",
    transport_stop: "Transport stop",
    transport_terminal: "Transport terminal",
    transport_route: "Transport route",
    transport_route_variant: "Route variant",
    building: "Building",
    landuse: "Landuse",
    water_line: "Water line",
    water_polygon: "Water polygon",
};

export function aliasTypeLabel(value: string): string {
    return ALIAS_TYPE_LABELS[value] ?? value;
}

export function entityTypeLabel(value: string): string {
    return ENTITY_TYPE_LABELS[value] ?? value;
}

export const SEARCH_DOCUMENT_SYNC_STATES = [
    "current",
    "stale",
    "missing",
    "ghost",
] as const;

const SYNC_STATE_LABELS: Record<string, string> = {
    current: "Current",
    stale: "Stale",
    missing: "Missing",
    ghost: "Ghost",
};

export function syncStateLabel(value: string): string {
    return SYNC_STATE_LABELS[value] ?? value;
}

export const SEARCH_DOCUMENT_SORT_OPTIONS = [
    { value: "indexed_at", label: "Indexed at" },
    { value: "source_updated_at", label: "Source updated" },
    { value: "name", label: "Name" },
    { value: "entity_type", label: "Entity type" },
    { value: "importance", label: "Importance" },
    { value: "confidence", label: "Confidence" },
] as const;

export const TRANSPORT_MODE_OPTIONS = [
    "bus",
    "train",
    "ferry",
    "express",
    "flight",
    "other",
] as const;

export const SEARCH_ALIAS_SORT_OPTIONS = [
    { value: "updated_at", label: "Updated" },
    { value: "created_at", label: "Created" },
    { value: "alias_text", label: "Alias text" },
] as const;

export const SEARCH_ALIAS_LANGUAGE_OPTIONS = [
    { value: "", label: "Any / undetermined" },
    { value: "my", label: "Myanmar (my)" },
    { value: "en", label: "English (en)" },
    { value: "und", label: "Undetermined (und)" },
] as const;

export const FAILED_SEARCH_SORT_OPTIONS = [
    { value: "occurrence_count", label: "Most frequent" },
    { value: "last_seen_at", label: "Latest seen" },
    { value: "first_seen_at", label: "Oldest first seen" },
    { value: "query", label: "Query (A–Z)" },
] as const;

export const FAILED_SEARCH_RESOLUTION_TYPES = [
    "alias",
    "data_fix",
    "duplicate",
    "ignored",
    "other",
] as const;

const RESOLUTION_TYPE_LABELS: Record<string, string> = {
    alias: "Resolved by alias",
    data_fix: "Data fix",
    duplicate: "Duplicate query",
    ignored: "Ignored / not actionable",
    other: "Other",
};

const PUBLIC_SEARCH_CATEGORY_LABELS: Record<string, string> = {
    all: "All categories",
    places: "Places",
    areas: "Areas",
    roads: "Roads",
    transport: "Transport",
    addresses: "Addresses",
};

export function searchCategoryLabel(value: string): string {
    return PUBLIC_SEARCH_CATEGORY_LABELS[value] ?? value;
}

export function searchLanguageLabel(value: string): string {
    if (value === "my") return "Myanmar";
    if (value === "en") return "English";
    if (value === "und") return "Undetermined";
    if (value === "unknown") return "Unknown";
    return value;
}

export function formatPercent(value: number): string {
    if (!Number.isFinite(value)) {
        return "—";
    }
    return `${value.toFixed(1)}%`;
}

export function formatBucketLabel(iso: string, bucket: "hour" | "day"): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    if (bucket === "hour") {
        return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
    }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const INDEX_FAMILY_LABELS: Record<string, string> = {
    places: "Places",
    admin_areas: "Admin areas",
    street_groups: "Street groups",
    addresses: "Addresses",
    transport_stops: "Transport stops",
    transport_terminals: "Transport terminals",
    transport_routes: "Transport routes",
    transport_route_variants: "Route variants",
    buildings: "Buildings",
    landuse: "Landuse",
    water_lines: "Water lines",
    water_polygons: "Water polygons",
};

export function indexFamilyLabel(value: string): string {
    return INDEX_FAMILY_LABELS[value] ?? value;
}

export function indexHealthStatusLabel(status: string): string {
    return status === "healthy" ? "Healthy" : "Issues";
}

export function indexHealthSeverityLabel(severity: string): string {
    switch (severity) {
        case "healthy":
            return "Healthy";
        case "warning":
            return "Warning";
        case "critical":
            return "Critical";
        default:
            return severity;
    }
}

export function indexHealthSeverityBadgeState(
    severity: string,
): "current" | "stale" | "missing" | "ghost" {
    switch (severity) {
        case "healthy":
            return "current";
        case "warning":
            return "stale";
        case "critical":
            return "missing";
        default:
            return "stale";
    }
}

export function maintenanceOperationStatusLabel(status: string): string {
    switch (status) {
        case "success":
            return "Success";
        case "partial":
            return "Partial";
        case "failed":
            return "Failed";
        case "skipped":
            return "Skipped";
        case "conflict":
            return "Conflict";
        default:
            return status;
    }
}

const PUBLIC_SEARCH_TRANSPORT_TYPE_LABELS: Record<string, string> = {
    all: "All transport types",
    stops: "Stops",
    stations: "Stations",
    terminals: "Terminals",
    routes: "Routes",
};

const PUBLIC_SEARCH_TRANSPORT_MODE_LABELS: Record<string, string> = {
    all: "All modes",
    bus: "Bus",
    train: "Train",
    express: "Express",
    ferry: "Ferry",
    flight: "Flight",
    other: "Other",
};

export function resolutionTypeLabel(value: string): string {
    return RESOLUTION_TYPE_LABELS[value] ?? value;
}

export function failedSearchFilterSummary(item: {
    category: string | null;
    transport_type: string | null;
    transport_mode: string | null;
    entity_types_key: string | null;
    types: string[] | null;
    area_context_key: string | null;
}): string {
    const parts: string[] = [];
    if (item.category && item.category !== "all") {
        parts.push(PUBLIC_SEARCH_CATEGORY_LABELS[item.category] ?? item.category);
    }
    if (item.transport_type && item.transport_type !== "all") {
        parts.push(
            PUBLIC_SEARCH_TRANSPORT_TYPE_LABELS[item.transport_type] ?? item.transport_type,
        );
    }
    if (item.transport_mode && item.transport_mode !== "all") {
        parts.push(
            PUBLIC_SEARCH_TRANSPORT_MODE_LABELS[item.transport_mode] ?? item.transport_mode,
        );
    }
    if (item.entity_types_key && item.entity_types_key !== "all") {
        parts.push(`Types: ${item.entity_types_key}`);
    } else if (item.types && item.types.length > 0) {
        parts.push(`Types: ${item.types.join(", ")}`);
    }
    if (item.area_context_key) {
        parts.push(`Area ~${item.area_context_key}`);
    }
    return parts.length > 0 ? parts.join(" · ") : "No category filter";
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

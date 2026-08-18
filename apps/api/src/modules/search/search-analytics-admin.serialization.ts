const ENTITY_TYPE_LABELS: Readonly<Record<string, string>> = {
    place: "Place",
    admin_area: "Admin area",
    street_group: "Street group",
    address: "Address",
    transport_stop: "Transport stop",
    transport_terminal: "Transport terminal",
    transport_route: "Transport route",
    transport_route_variant: "Route variant",
    building: "Building",
    land_area: "Land area",
    water_line: "Water line",
    water_polygon: "Water polygon",
    bus_stop: "Transport stop",
    bus_route: "Transport route",
};

export function entityTypeLabelForAnalytics(entityType: string): string {
    return ENTITY_TYPE_LABELS[entityType] ?? entityType.replace(/_/g, " ");
}

export function toAnalyticsEntityIdString(value: bigint | number | null | undefined): string {
    if (value === null || value === undefined) {
        return "";
    }
    return typeof value === "bigint" ? value.toString() : String(value);
}

export function formatClickedEntityLabel(
    entityType: string,
    entityId: string,
    displayName: string | null | undefined,
): string {
    const trimmedName = displayName?.trim();
    if (trimmedName) {
        return trimmedName;
    }

    const typeLabel = entityTypeLabelForAnalytics(entityType);
    const id = entityId.trim();
    if (!id) {
        return typeLabel;
    }
    return `${typeLabel} #${id}`;
}

export function roundAnalyticsRate(numerator: number, denominator: number): number {
    if (denominator <= 0) {
        return 0;
    }
    return Math.round((numerator / denominator) * 1000) / 10;
}

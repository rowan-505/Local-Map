import { entityTypeLabel } from "./constants";

export const SEARCH_ANALYTICS_EMPTY_LABEL = "No data for this period yet.";

export function formatClickedEntityLabel(
    entityType: string,
    entityId: string | null | undefined,
    displayName: string | null | undefined,
): string {
    const trimmedName = displayName?.trim();
    if (trimmedName) {
        return trimmedName;
    }

    const id = entityId?.trim() ?? "";
    const typeLabel = entityTypeLabel(entityType);
    if (!id) {
        return typeLabel;
    }
    return `${typeLabel} #${id}`;
}

export function formatNullableLatencyMs(value: number | null | undefined): string {
    if (value === null || value === undefined) {
        return "—";
    }
    return `${value} ms`;
}

export function hasAnalyticsLatencyPoints(
    timeseries: Array<{ latency_p50_ms: number | null; latency_p95_ms: number | null }>,
): boolean {
    return timeseries.some(
        (row) => row.latency_p50_ms !== null || row.latency_p95_ms !== null,
    );
}

export function clickedEntityRowLabel(row: {
    label?: string;
    entity_type: string;
    entity_id: string;
    display_name: string | null;
}): string {
    const apiLabel = row.label?.trim();
    if (apiLabel) {
        return apiLabel;
    }
    return formatClickedEntityLabel(row.entity_type, row.entity_id, row.display_name);
}

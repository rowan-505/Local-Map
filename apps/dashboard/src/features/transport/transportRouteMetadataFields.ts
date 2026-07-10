import type { ReactNode } from "react";

import { transportModeLabel } from "./constants";
import type { TransportRouteDetail } from "./types";

export type RouteMetadataField = {
    readonly key: string;
    readonly label: string;
    readonly value: ReactNode;
};

/** Field keys rendered in Route Summary — excluded from More Metadata. */
export const ROUTE_SUMMARY_FIELD_KEYS = new Set([
    "route_code",
    "name_my",
    "name_en",
    "mode",
    "route_kind",
    "origin_name",
    "destination_name",
    "variant_count",
    "stop_count",
    "path_count",
    "review_status",
    "public_visibility",
    "source_status",
    "train_type",
    "train_model",
    "estimated_duration",
    "operation_days",
]);

export function humanizeMetadataToken(value: string): string {
    return value
        .trim()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatMetadataOperationDays(days: readonly string[]): string | null {
    const cleaned = days.map((day) => day.trim()).filter((day) => day !== "");
    if (cleaned.length === 0) {
        return null;
    }
    return cleaned.map((day) => humanizeMetadataToken(day)).join(", ");
}

export function formatMetadataDuration(minutes: number): string {
    if (minutes < 60) {
        return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (remainder === 0) {
        return `${hours} hr`;
    }
    return `${hours} hr ${remainder} min`;
}

export function routeMetadataDisplayValue(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
        return "—";
    }
    if (typeof value === "string" && value.trim() === "") {
        return "—";
    }
    return String(value);
}

export function isEmptyRouteMetadataValue(value: ReactNode): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "string") {
        return value.trim() === "" || value.trim() === "—";
    }
    if (typeof value === "number") {
        return !Number.isFinite(value);
    }
    return false;
}

export function visibleRouteMetadataFields(fields: readonly RouteMetadataField[]): RouteMetadataField[] {
    return fields.filter((field) => !isEmptyRouteMetadataValue(field.value));
}

export function routeModeKindLabel(route: TransportRouteDetail): string {
    const metadata = route.routeMetadata;
    const mode = transportModeLabel(metadata?.summary.mode ?? route.mode);
    const kind = humanizeMetadataToken(metadata?.summary.routeKind ?? route.route_kind);
    return `${mode} · ${kind}`;
}

export function routePublicVisibilityLabel(route: TransportRouteDetail): string {
    if (route.deleted_at || !route.is_active) {
        return "Hidden (inactive)";
    }
    if (route.review_status === "imported_unreviewed") {
        return "Hidden (imported, unreviewed)";
    }
    if (route.review_status === "needs_review") {
        return "Hidden (needs review)";
    }
    if (route.review_status === "rejected") {
        return "Hidden (rejected)";
    }
    if (route.review_status === "reviewed" || route.review_status === "verified") {
        return "Visible";
    }
    return "Hidden";
}

/** Additional common fields for More Metadata (not shown in Route Summary). */
export function buildRouteMoreMetadataCommonFields(route: TransportRouteDetail): RouteMetadataField[] {
    const metadata = route.routeMetadata;

    return [
        { key: "operator", label: "Operator", value: route.operator?.name ?? null },
        {
            key: "confidence_score",
            label: "Confidence score",
            value: route.confidence_score,
        },
        {
            key: "generation",
            label: "Generation",
            value: metadata?.summary.generation ?? null,
        },
        {
            key: "source_links_count",
            label: "Source links count",
            value: metadata?.counts.sourceLinksCount ?? route.sources.length,
        },
    ];
}

/** Train-only fields for More Metadata (not shown in Route Summary). */
export function buildRouteMoreMetadataTrainFields(route: TransportRouteDetail): RouteMetadataField[] {
    const metadata = route.routeMetadata;
    const train = metadata?.train;

    return [
        { key: "train_number", label: "Train number", value: train?.trainNumber ?? null },
        { key: "display_group", label: "Display group", value: train?.displayGroup ?? null },
        {
            key: "display_headsign",
            label: "Display headsign",
            value: metadata?.names.displayHeadsign ?? null,
        },
        {
            key: "is_yangon_urban_service",
            label: "Yangon urban service",
            value: train?.isYangonUrbanService ? "Yes" : "No",
        },
        {
            key: "is_source_full_loop",
            label: "Source full loop",
            value: train?.isSourceFullLoop ? "Yes" : "No",
        },
        {
            key: "total_source_stations",
            label: "Total source stations",
            value: train?.totalStations ?? null,
        },
        {
            key: "imported_route_stops",
            label: "Imported route stops",
            value: train?.importedRouteStops ?? null,
        },
    ];
}

export function buildRouteMoreMetadataFields(route: TransportRouteDetail): {
    commonFields: RouteMetadataField[];
    modeFields: RouteMetadataField[];
    modeLabel: string | null;
} {
    const mode = route.routeMetadata?.summary.mode ?? route.mode;
    const commonFields = visibleRouteMetadataFields(buildRouteMoreMetadataCommonFields(route));

    if (mode === "train") {
        return {
            commonFields,
            modeFields: visibleRouteMetadataFields(buildRouteMoreMetadataTrainFields(route)),
            modeLabel: "Train metadata",
        };
    }

    return {
        commonFields,
        modeFields: [],
        modeLabel: null,
    };
}

export function assertNoSummaryFieldOverlap(fields: readonly RouteMetadataField[]): void {
    for (const field of fields) {
        if (ROUTE_SUMMARY_FIELD_KEYS.has(field.key)) {
            throw new Error(`More metadata must not repeat summary field: ${field.key}`);
        }
    }
}

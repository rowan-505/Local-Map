import { isPlaceholderStopName } from "./transport-review.js";

export type TransportRouteMetadataSummary = {
    mode: string;
    routeKind: string;
    routeType: string | null;
    trainType: string | null;
    trainModel: string | null;
    operationDays: string[];
    sourceStatus: "none" | "linked" | "imported";
    reviewStatus: string;
    isActive: boolean;
    confidenceScore: number | null;
    generation: string | null;
};

export type TransportRouteMetadataNames = {
    routeCode: string;
    nameMy: string | null;
    nameEn: string | null;
    originName: string | null;
    destinationName: string | null;
    displayHeadsign: string | null;
};

export type TransportRouteMetadataCounts = {
    variantCount: number;
    stopCount: number;
    pathCount: number;
    sourceLinksCount: number;
};

export type TransportRouteMetadataTrain = {
    trainNumber: string | null;
    trainType: string | null;
    trainModel: string | null;
    operationDays: string[];
    totalStations: number | null;
    estimatedDurationMin: number | null;
    displayGroup: string | null;
    isYangonUrbanService: boolean;
    isSourceFullLoop: boolean;
    closingDuplicateStopSkipped: boolean;
    importedRouteStops: number | null;
};

export type TransportRouteMetadataDiagnostics = {
    hasSourceLinks: boolean;
    hasPath: boolean;
    hasCompleteStopSequence: boolean;
    hasStopLocationWarnings: boolean;
};

export type TransportRouteMetadata = {
    summary: TransportRouteMetadataSummary;
    names: TransportRouteMetadataNames;
    counts: TransportRouteMetadataCounts;
    train: TransportRouteMetadataTrain;
    diagnostics: TransportRouteMetadataDiagnostics;
};

export type RouteMetadataVariantRow = {
    headsign: string | null;
    destination_name: string | null;
    estimated_duration_min: number | null;
    stop_count: number;
    normalized_data: Record<string, unknown> | null;
};

export type RouteMetadataDiagnosticsInput = {
    stops_missing_geom: boolean;
    has_placeholder_stop_name: boolean;
    has_stop_geometry_review_flag: boolean;
    sequence_incomplete: boolean;
};

export type BuildTransportRouteMetadataInput = {
    route_code: string;
    mode: string;
    route_kind: string;
    origin_name: string | null;
    destination_name: string | null;
    review_status: string;
    is_active: boolean;
    confidence_score: number | null;
    normalized_data: Record<string, unknown> | null;
    name_mm: string | null;
    name_en: string | null;
    variant_count: number;
    stop_count: number;
    path_count: number;
    source_links_count: number;
    variants: readonly RouteMetadataVariantRow[];
    diagnostics: RouteMetadataDiagnosticsInput;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}

function readFiniteNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function readBoolean(value: unknown): boolean | null {
    if (typeof value === "boolean") {
        return value;
    }
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    return null;
}

function readStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => readString(item))
        .filter((item): item is string => item !== null);
}

function readNestedString(
    normalized: Record<string, unknown> | null,
    parentKey: string,
    childKey: string,
): string | null {
    const parent = asRecord(normalized?.[parentKey]);
    return parent ? readString(parent[childKey]) : null;
}

export function readOperationDays(normalized: Record<string, unknown> | null): string[] {
    const fromArray = readStringArray(normalized?.operation_days);
    if (fromArray.length > 0) {
        return fromArray;
    }

    const singleDay =
        readString(normalized?.operation_day) ??
        readString(normalized?.operation_text_en) ??
        readString(normalized?.operation_text_my);
    return singleDay ? [singleDay] : [];
}

export function readTrainNumber(
    routeCode: string,
    normalized: Record<string, unknown> | null,
): string | null {
    const fromNormalized = readString(normalized?.train_number);
    if (fromNormalized) {
        return fromNormalized;
    }

    const match = /^TRAIN-(.+)$/i.exec(routeCode.trim());
    return match?.[1] ?? null;
}

export function readRouteType(
    mode: string,
    routeKind: string,
    normalized: Record<string, unknown> | null,
): string | null {
    if (mode === "train") {
        return (
            readString(normalized?.train_type) ??
            readString(normalized?.train_type_raw) ??
            readString(normalized?.route_type) ??
            routeKind
        );
    }

    return readString(normalized?.route_type) ?? routeKind;
}

export function readDisplayGroup(
    mode: string,
    routeCode: string,
    normalized: Record<string, unknown> | null,
    trainNumber: string | null,
): string | null {
    const explicit =
        readString(normalized?.display_group) ??
        readString(normalized?.route_group_key) ??
        readNestedString(normalized, "ybs_go", "route_number") ??
        readNestedString(normalized, "ybs_go", "route_display_code");
    if (explicit) {
        return explicit;
    }

    if (mode === "train") {
        return trainNumber;
    }

    return routeCode;
}

function readVariantBoolean(
    variants: readonly RouteMetadataVariantRow[],
    key: string,
): boolean {
    return variants.some((variant) => readBoolean(variant.normalized_data?.[key]) === true);
}

function readDisplayHeadsign(
    routeDestinationName: string | null,
    variants: readonly RouteMetadataVariantRow[],
): string | null {
    for (const variant of variants) {
        const headsign = readString(variant.headsign);
        if (headsign) {
            return headsign;
        }
    }

    for (const variant of variants) {
        const destination = readString(variant.destination_name);
        if (destination) {
            return destination;
        }
    }

    return readString(routeDestinationName);
}

function readTotalStations(
    variants: readonly RouteMetadataVariantRow[],
    routeStopCount: number,
): number | null {
    let maxStations: number | null = null;

    for (const variant of variants) {
        const fromNormalized =
            readFiniteNumber(variant.normalized_data?.total_stations) ??
            readFiniteNumber(variant.normalized_data?.source_total_stations);
        if (fromNormalized !== null) {
            maxStations = maxStations === null ? fromNormalized : Math.max(maxStations, fromNormalized);
        }

        if (variant.stop_count > 0) {
            maxStations =
                maxStations === null ? variant.stop_count : Math.max(maxStations, variant.stop_count);
        }
    }

    if (maxStations !== null) {
        return maxStations;
    }

    return routeStopCount > 0 ? routeStopCount : null;
}

function readEstimatedDurationMin(
    variants: readonly RouteMetadataVariantRow[],
): number | null {
    let maxDuration: number | null = null;

    for (const variant of variants) {
        const fromColumn = readFiniteNumber(variant.estimated_duration_min);
        if (fromColumn !== null) {
            maxDuration = maxDuration === null ? fromColumn : Math.max(maxDuration, fromColumn);
        }

        const travelSeconds = readFiniteNumber(variant.normalized_data?.travel_duration_seconds);
        if (travelSeconds !== null) {
            const minutes = Math.round(travelSeconds / 60);
            maxDuration = maxDuration === null ? minutes : Math.max(maxDuration, minutes);
        }
    }

    return maxDuration;
}

function readImportedRouteStops(variants: readonly RouteMetadataVariantRow[]): number | null {
    let maxImported: number | null = null;

    for (const variant of variants) {
        const imported = readFiniteNumber(variant.normalized_data?.imported_route_stops);
        if (imported !== null) {
            maxImported = maxImported === null ? imported : Math.max(maxImported, imported);
        }
    }

    return maxImported;
}

function deriveSourceStatus(
    sourceLinksCount: number,
    reviewStatus: string,
): TransportRouteMetadataSummary["sourceStatus"] {
    if (sourceLinksCount <= 0) {
        return "none";
    }
    if (reviewStatus === "imported_unreviewed") {
        return "imported";
    }
    return "linked";
}

function mentionsYangon(value: string | null): boolean {
    return value !== null && /yangon|ရန်ကုန်/i.test(value);
}

function deriveIsYangonUrbanService(input: {
    mode: string;
    origin_name: string | null;
    destination_name: string | null;
    normalized_data: Record<string, unknown> | null;
    variants: readonly RouteMetadataVariantRow[];
}): boolean {
    const explicit = readBoolean(input.normalized_data?.is_yangon_urban_service);
    if (explicit !== null) {
        return explicit;
    }

    if (input.mode !== "train") {
        return false;
    }

    const isCircular = readVariantBoolean(input.variants, "is_circular_route");
    if (!isCircular) {
        return false;
    }

    return (
        mentionsYangon(input.origin_name) &&
        (mentionsYangon(input.destination_name) || input.destination_name === input.origin_name)
    );
}

export function buildTransportRouteMetadata(
    input: BuildTransportRouteMetadataInput,
): TransportRouteMetadata {
    const normalized = asRecord(input.normalized_data);
    const operationDays = readOperationDays(normalized);
    const trainNumber = readTrainNumber(input.route_code, normalized);
    const trainType = input.mode === "train" ? readString(normalized?.train_type) : null;
    const trainModel = input.mode === "train" ? readString(normalized?.train_model) : null;
    const routeType = readRouteType(input.mode, input.route_kind, normalized);
    const displayGroup = readDisplayGroup(input.mode, input.route_code, normalized, trainNumber);
    const isSourceFullLoop = readVariantBoolean(input.variants, "is_circular_route");
    const hasCompleteStopSequence =
        input.variant_count > 0 && !input.diagnostics.sequence_incomplete;
    const hasStopLocationWarnings =
        input.diagnostics.stops_missing_geom ||
        input.diagnostics.has_placeholder_stop_name ||
        input.diagnostics.has_stop_geometry_review_flag;

    return {
        summary: {
            mode: input.mode,
            routeKind: input.route_kind,
            routeType,
            trainType,
            trainModel,
            operationDays,
            sourceStatus: deriveSourceStatus(input.source_links_count, input.review_status),
            reviewStatus: input.review_status,
            isActive: input.is_active,
            confidenceScore: input.confidence_score,
            generation: readString(normalized?.generation),
        },
        names: {
            routeCode: input.route_code,
            nameMy: input.name_mm,
            nameEn: input.name_en,
            originName: input.origin_name,
            destinationName: input.destination_name,
            displayHeadsign: readDisplayHeadsign(input.destination_name, input.variants),
        },
        counts: {
            variantCount: input.variant_count,
            stopCount: input.stop_count,
            pathCount: input.path_count,
            sourceLinksCount: input.source_links_count,
        },
        train: {
            trainNumber: input.mode === "train" ? trainNumber : null,
            trainType,
            trainModel,
            operationDays: input.mode === "train" ? operationDays : [],
            totalStations: input.mode === "train" ? readTotalStations(input.variants, input.stop_count) : null,
            estimatedDurationMin:
                input.mode === "train" ? readEstimatedDurationMin(input.variants) : null,
            displayGroup: input.mode === "train" ? displayGroup : null,
            isYangonUrbanService: deriveIsYangonUrbanService({
                mode: input.mode,
                origin_name: input.origin_name,
                destination_name: input.destination_name,
                normalized_data: normalized,
                variants: input.variants,
            }),
            isSourceFullLoop: input.mode === "train" ? isSourceFullLoop : false,
            closingDuplicateStopSkipped:
                input.mode === "train"
                    ? readVariantBoolean(input.variants, "closing_duplicate_stop_skipped")
                    : false,
            importedRouteStops:
                input.mode === "train" ? readImportedRouteStops(input.variants) : null,
        },
        diagnostics: {
            hasSourceLinks: input.source_links_count > 0,
            hasPath: input.path_count > 0,
            hasCompleteStopSequence,
            hasStopLocationWarnings,
        },
    };
}

export function hasPlaceholderStopNames(
    rows: readonly { name_mm: string | null; name_en: string | null; name: string }[],
): boolean {
    return rows.some(
        (row) =>
            isPlaceholderStopName(row.name_mm) ||
            isPlaceholderStopName(row.name_en) ||
            isPlaceholderStopName(row.name),
    );
}

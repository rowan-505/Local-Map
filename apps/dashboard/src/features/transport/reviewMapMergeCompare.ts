import type {
    TransportStopMergeFieldComparison,
    TransportStopMergeFieldSource,
    TransportStopMergeFieldSources,
    TransportStopRouteUsageSummary,
} from "./types";

export type MergeCompareFieldKey = keyof TransportStopMergeFieldComparison;

export const MERGE_COMPARE_FIELD_KEYS: readonly MergeCompareFieldKey[] = [
    "name",
    "name_mm",
    "name_en",
    "stop_type",
    "geom",
    "admin_area_id",
    "confidence_score",
    "review_status",
    "is_active",
];

export const MERGE_COMPARE_FIELD_LABELS: Record<MergeCompareFieldKey, string> = {
    name: "Display name",
    name_mm: "Myanmar name",
    name_en: "English name",
    stop_type: "Stop type",
    geom: "Location",
    admin_area_id: "Admin area",
    confidence_score: "Confidence",
    review_status: "Review status",
    is_active: "Active",
};

export function listDifferingMergeFields(
    comparison: TransportStopMergeFieldComparison,
): MergeCompareFieldKey[] {
    return MERGE_COMPARE_FIELD_KEYS.filter((field) => !comparison[field].same);
}

/** Whether the merge dialog may submit keep-canonical merge. */
export function canSubmitTransportStopMerge(options: {
    readonly previewLoaded: boolean;
    readonly previewError: boolean;
    readonly mergeAllowed: boolean;
    readonly terminalConflictExists: boolean;
    readonly sameVariantConflictCount: number;
    readonly acknowledgedSameVariantOccurrences: boolean;
}): boolean {
    if (!options.previewLoaded || options.previewError) {
        return false;
    }
    if (!options.mergeAllowed || options.terminalConflictExists) {
        return false;
    }
    if (
        options.sameVariantConflictCount > 0 &&
        !options.acknowledgedSameVariantOccurrences
    ) {
        return false;
    }
    return true;
}

export function defaultFieldSourcesForCanonical(
    differingFields: readonly MergeCompareFieldKey[],
    canonicalSide: "current" | "candidate",
): TransportStopMergeFieldSources {
    const source: TransportStopMergeFieldSource = canonicalSide;
    const result: TransportStopMergeFieldSources = {};
    for (const field of differingFields) {
        result[field] = source;
    }
    return result;
}

export function formatMergeCompareFieldValue(
    field: MergeCompareFieldKey,
    value: unknown,
    adminAreaName?: string | null,
): string {
    if (field === "geom") {
        const geom = value as { lat: number; lng: number } | null;
        if (!geom) {
            return "—";
        }
        return `${geom.lat.toFixed(5)}, ${geom.lng.toFixed(5)}`;
    }
    if (field === "admin_area_id") {
        if (value === null || value === undefined) {
            return "—";
        }
        return adminAreaName?.trim() || String(value);
    }
    if (field === "confidence_score") {
        if (value === null || value === undefined) {
            return "—";
        }
        return String(Math.round(Number(value)));
    }
    if (field === "is_active") {
        return value ? "Yes" : "No";
    }
    if (value === null || value === undefined || value === "") {
        return "—";
    }
    return String(value);
}

export function hasStopMergeDirectionUsageMismatch(
    current: Pick<
        TransportStopRouteUsageSummary,
        "inboundCount" | "outboundCount" | "clockwiseCount" | "anticlockwiseCount"
    >,
    candidate: Pick<
        TransportStopRouteUsageSummary,
        "inboundCount" | "outboundCount" | "clockwiseCount" | "anticlockwiseCount"
    >,
): boolean {
    const currentDirection1Only =
        current.inboundCount > 0 && current.outboundCount === 0;
    const candidateDirection0Only =
        candidate.outboundCount > 0 && candidate.inboundCount === 0;
    const currentDirection0Only =
        current.outboundCount > 0 && current.inboundCount === 0;
    const candidateDirection1Only =
        candidate.inboundCount > 0 && candidate.outboundCount === 0;

    if (
        (currentDirection1Only && candidateDirection0Only) ||
        (currentDirection0Only && candidateDirection1Only)
    ) {
        return true;
    }

    const currentClockwiseOnly =
        current.clockwiseCount > 0 && current.anticlockwiseCount === 0;
    const candidateAnticlockwiseOnly =
        candidate.anticlockwiseCount > 0 && candidate.clockwiseCount === 0;
    const currentAnticlockwiseOnly =
        current.anticlockwiseCount > 0 && current.clockwiseCount === 0;
    const candidateClockwiseOnly =
        candidate.clockwiseCount > 0 && candidate.anticlockwiseCount === 0;

    return (
        (currentClockwiseOnly && candidateAnticlockwiseOnly) ||
        (currentAnticlockwiseOnly && candidateClockwiseOnly)
    );
}

export function formatDirectionUsageSummary(
    summary: TransportStopRouteUsageSummary,
): string {
    return [
        `Direction ID 1 ${summary.inboundCount}`,
        `Direction ID 0 ${summary.outboundCount}`,
        `Clockwise ${summary.clockwiseCount}`,
        `Anticlockwise ${summary.anticlockwiseCount}`,
    ].join(" · ");
}

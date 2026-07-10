/** Default placeholder when a timing value is missing (legacy helpers). */
export const ROUTE_STOP_EMPTY_DISPLAY = "—";

/** Review-map travel placeholder when travel_time_from_previous_seconds is null. */
export const ROUTE_STOP_TRAVEL_PLACEHOLDER = "+00 min";

/** Visual minute-input placeholder for nullable timing fields. */
export const ROUTE_STOP_MINUTES_PLACEHOLDER_DISPLAY = "0";

const TIMING_TYPE_BADGE_LABELS: Readonly<Record<string, string>> = {
    arrival: "arrival",
    departure: "departure",
    arrival_departure: "arr · dep",
};

/** Timing fields used by display helpers (train, bus, or future modes). */
export type RouteStopTimingFields = {
    readonly source_time_text?: string | null;
    readonly source_time_type?: string | null;
    readonly travel_time_from_previous_seconds?: number | null;
    readonly waiting_time_seconds?: number | null;
    readonly arrival_offset_seconds?: number | null;
    readonly departure_offset_seconds?: number | null;
};

/** Read-only imported source provenance for diagnostics and advanced metadata. */
export type RouteStopSourceProvenance = {
    readonly importedSourceTime: string;
    readonly sourceTimeType: string;
    readonly travelFromPrevious: string;
    readonly arrivalOffset: string;
    readonly departureOffset: string;
};

/**
 * @deprecated Use RouteStopSourceProvenance. Operational clocks come from the variant timetable schedule.
 */
export type RouteStopDisplayTime = {
    readonly clockTime: string;
    readonly intervalFromPrevious: string;
    readonly timeType: string;
    readonly arrivalOffset: string;
    readonly departureOffset: string;
};

/**
 * Raw imported source clock text (e.g. "04:45 PM") as stored at import time.
 * This is provenance only — not the operational timetable clock.
 */
export function formatSourceTimeProvenance(sourceTimeText: string | null | undefined): string {
    const trimmed = sourceTimeText?.trim();
    return trimmed ? trimmed : ROUTE_STOP_EMPTY_DISPLAY;
}

/** @deprecated Use formatSourceTimeProvenance. */
export function formatClockTime(sourceTimeText: string | null | undefined): string {
    return formatSourceTimeProvenance(sourceTimeText);
}

/**
 * Positive duration from the previous stop (e.g. "+26 min", "+1 hr 10 min").
 * Never shows raw seconds.
 */
export function formatInterval(seconds: number | null | undefined): string {
    return formatSignedDuration(seconds);
}

/** True when a timing seconds column is unset in the database. */
export function isTimingSecondsMissing(seconds: number | null | undefined): boolean {
    return seconds === null || seconds === undefined || !Number.isFinite(seconds);
}

/** True when a timing seconds column has an explicit stored value, including zero. */
export function hasStoredTimingSeconds(seconds: number | null | undefined): boolean {
    return seconds !== null && seconds !== undefined && Number.isFinite(seconds) && seconds >= 0;
}

/**
 * Travel label for review-map stop rows.
 * Null database values use the +00 min placeholder; stored zero uses +0 min.
 */
export function formatTravelFromPrevious(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
        return ROUTE_STOP_TRAVEL_PLACEHOLDER;
    }
    return formatSignedDuration(seconds);
}

/** Human-readable duration hint for minute inputs (e.g. "+1 hr 10 min"). */
export function durationMinutesHint(
    minutesValue: string,
    options?: { readonly isMissing?: boolean },
): string | null {
    if (options?.isMissing) {
        return null;
    }
    const trimmed = minutesValue.trim();
    if (!trimmed) {
        return null;
    }
    const minutes = Number(trimmed);
    if (!Number.isFinite(minutes) || minutes < 0) {
        return null;
    }
    const label = formatInterval(Math.round(minutes * 60));
    return label === ROUTE_STOP_EMPTY_DISPLAY ? null : label;
}

/**
 * Offset from route origin in seconds (e.g. "+1 hr 10 min").
 * Never shows raw seconds.
 */
export function formatOffset(seconds: number | null | undefined): string {
    return formatSignedDuration(seconds);
}

/** Diagnostics view of imported source provenance and stored routing offsets. */
export function getRouteStopSourceProvenance(
    routeStop: RouteStopTimingFields,
): RouteStopSourceProvenance {
    const timeType = routeStop.source_time_type?.trim();
    return {
        importedSourceTime: formatSourceTimeProvenance(routeStop.source_time_text),
        sourceTimeType: timeType ? timeType : ROUTE_STOP_EMPTY_DISPLAY,
        travelFromPrevious: formatInterval(routeStop.travel_time_from_previous_seconds),
        arrivalOffset: formatOffset(routeStop.arrival_offset_seconds),
        departureOffset: formatOffset(routeStop.departure_offset_seconds),
    };
}

/**
 * @deprecated Use getRouteStopSourceProvenance for diagnostics.
 * Operational clocks must come from buildVariantTimetableSchedule, not source_time_text.
 */
export function getRouteStopDisplayTime(routeStop: RouteStopTimingFields): RouteStopDisplayTime {
    const provenance = getRouteStopSourceProvenance(routeStop);
    return {
        clockTime: provenance.importedSourceTime,
        intervalFromPrevious: provenance.travelFromPrevious,
        timeType: provenance.sourceTimeType,
        arrivalOffset: provenance.arrivalOffset,
        departureOffset: provenance.departureOffset,
    };
}

/**
 * Short badge label for arrival / departure types only.
 * Returns null for unknown, empty, or unrecognized values.
 */
export function getRouteStopTimingTypeBadge(
    sourceTimeType: string | null | undefined,
): string | null {
    const type = sourceTimeType?.trim();
    if (!type || type === "unknown") {
        return null;
    }
    return TIMING_TYPE_BADGE_LABELS[type] ?? null;
}

/**
 * Diagnostics segments for imported source provenance (not operational clocks).
 */
export function getRouteStopSourceProvenanceSegments(
    routeStop: RouteStopTimingFields,
): Array<{ text: string; muted?: boolean }> {
    const provenance = getRouteStopSourceProvenance(routeStop);
    const segments: Array<{ text: string; muted?: boolean }> = [];

    if (provenance.importedSourceTime !== ROUTE_STOP_EMPTY_DISPLAY) {
        segments.push({ text: `Import ${provenance.importedSourceTime}`, muted: true });
    }
    if (provenance.travelFromPrevious !== ROUTE_STOP_EMPTY_DISPLAY) {
        segments.push({ text: provenance.travelFromPrevious, muted: true });
    }

    return segments;
}

/** @deprecated Use getRouteStopSourceProvenanceSegments. */
export function getRouteStopTimingLineSegments(
    routeStop: RouteStopTimingFields,
): Array<{ text: string; muted?: boolean }> {
    return getRouteStopSourceProvenanceSegments(routeStop);
}

export function routeStopHasSourceProvenanceData(routeStop: RouteStopTimingFields): boolean {
    return (
        getRouteStopSourceProvenanceSegments(routeStop).length > 0 ||
        getRouteStopTimingTypeBadge(routeStop.source_time_type) !== null
    );
}

/** @deprecated Use routeStopHasSourceProvenanceData. */
export function routeStopHasTimingDisplayData(routeStop: RouteStopTimingFields): boolean {
    return routeStopHasSourceProvenanceData(routeStop);
}

function formatSignedDuration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
        return ROUTE_STOP_EMPTY_DISPLAY;
    }

    const totalMinutes = Math.round(seconds / 60);
    if (totalMinutes <= 0) {
        return "+0 min";
    }
    if (totalMinutes < 60) {
        return `+${totalMinutes} min`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes === 0) {
        return `+${hours} hr`;
    }
    return `+${hours} hr ${minutes} min`;
}

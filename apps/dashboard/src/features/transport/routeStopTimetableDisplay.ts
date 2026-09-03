import {
    calculateVariantTimetableSchedule,
    type TimetableStopInput,
    type VariantTimetableStopSchedule,
} from "@local-map/transport-timetable";
import {
    TRANSPORT_TIME_EMPTY_DISPLAY,
    formatCanonicalTimeForDisplay,
    hasExplicitVariantDepartureTime,
    resolveVariantDepartureAnchor,
    validateCanonicalTime,
} from "@local-map/transport-timetable/transport-time";
import {
    ROUTE_STOP_TRAVEL_PLACEHOLDER,
    formatTravelFromPrevious,
    hasStoredTimingSeconds,
    isTimingSecondsMissing,
    type RouteStopTimingFields,
} from "./routeStopTimingDisplay";

export type TimetableRowSegment = {
    readonly text: string;
    readonly muted?: boolean;
};

export type RouteStopRowTimingDisplay = {
    readonly clockTime: string;
    readonly arrivalClockTime: string;
    readonly departureClockTime: string;
    readonly travelLabel: string;
    readonly hasClockData: boolean;
    readonly hasArrivalClockData: boolean;
    readonly hasDepartureClockData: boolean;
    readonly hasTravelData: boolean;
    readonly isTravelMissing: boolean;
};

export type { VariantTimetableStopSchedule, TimetableStopInput };

export {
    calculateVariantTimetableSchedule,
    variantTimetableScheduleToOffsets,
} from "@local-map/transport-timetable";
export {
    TRANSPORT_TIME_EMPTY_DISPLAY,
    addSecondsToCanonicalTime,
    formatCanonicalTimeForDisplay,
    hasExplicitVariantDepartureTime,
    isValidTransportTimeInput,
    parseSourceTimeToCanonical,
    parseTimeInputToCanonical,
    resolveVariantDepartureAnchor,
    validateCanonicalTime,
    type CanonicalTimeCalculation,
} from "@local-map/transport-timetable/transport-time";

function clockTimeOrPlaceholder(clockTime: string | null): string {
    return clockTime ?? TRANSPORT_TIME_EMPTY_DISPLAY;
}

/** HH:mm value for compact departure-time inputs. */
export function formatVariantDepartureTimeForInput(
    departureTimeText: string | null | undefined,
): string {
    return resolveVariantDepartureAnchor(departureTimeText) ?? "";
}

export function toTimetableStopInputs(
    stops: readonly Pick<
        RouteStopTimingFields,
        "travel_time_from_previous_seconds" | "waiting_time_seconds"
    >[],
): TimetableStopInput[] {
    return stops.map((stop) => ({
        travel_time_from_previous_seconds: stop.travel_time_from_previous_seconds ?? null,
        waiting_time_seconds: stop.waiting_time_seconds ?? null,
    }));
}

/**
 * Builds the full variant timetable schedule from the canonical departure anchor
 * and editable per-stop travel/waiting inputs.
 */
export function buildVariantTimetableSchedule(
    departureTimeText: string | null | undefined,
    stops: readonly Pick<
        RouteStopTimingFields,
        "travel_time_from_previous_seconds" | "waiting_time_seconds"
    >[],
): VariantTimetableStopSchedule[] {
    return calculateVariantTimetableSchedule({
        departureTimeText,
        stops: toTimetableStopInputs(stops),
    });
}

/** Maps one unified schedule row to review-map display labels. */
export function getRouteStopRowTimingDisplayFromSchedule(
    routeStop: RouteStopTimingFields,
    schedule: VariantTimetableStopSchedule,
): RouteStopRowTimingDisplay {
    const travelSeconds = routeStop.travel_time_from_previous_seconds;
    const isTravelMissing = isTimingSecondsMissing(travelSeconds);

    return {
        clockTime: clockTimeOrPlaceholder(schedule.primaryClockTime),
        arrivalClockTime: clockTimeOrPlaceholder(schedule.calculatedArrivalTime),
        departureClockTime: clockTimeOrPlaceholder(schedule.calculatedDepartureTime),
        travelLabel: formatTravelFromPrevious(travelSeconds),
        hasClockData: schedule.hasPrimaryClockData,
        hasArrivalClockData: schedule.hasArrivalClockData,
        hasDepartureClockData: schedule.hasDepartureClockData,
        hasTravelData: hasStoredTimingSeconds(travelSeconds),
        isTravelMissing,
    };
}

/**
 * Unified review-map timing labels for every transport mode.
 * Prefer buildVariantTimetableSchedule + getRouteStopRowTimingDisplayFromSchedule
 * when rendering a full ordered variant list.
 */
export function getRouteStopRowTimingDisplay(
    routeStop: RouteStopTimingFields,
    schedule: VariantTimetableStopSchedule,
): RouteStopRowTimingDisplay {
    return getRouteStopRowTimingDisplayFromSchedule(routeStop, schedule);
}

export function formatVariantDepartureTimeDisplay(
    departureTimeText: string | null | undefined,
): string {
    const canonical = resolveVariantDepartureAnchor(departureTimeText);
    return formatCanonicalTimeForDisplay(canonical);
}

/**
 * Read-only calculated timetable line segments for detail views.
 * First: Departure · Middle: Arr · Dep · travel · Final: Arrival
 */
export function getCalculatedTimetableRowSegments(
    routeStop: RouteStopTimingFields,
    schedule: VariantTimetableStopSchedule,
): TimetableRowSegment[] {
    const { isFirst, isLast } = schedule;
    const isOnlyStop = isFirst && isLast;

    if (isOnlyStop || isFirst) {
        const departure = clockTimeOrPlaceholder(schedule.calculatedDepartureTime);
        return [{ text: `Departure ${departure}` }];
    }

    if (isLast) {
        const arrival = clockTimeOrPlaceholder(schedule.calculatedArrivalTime);
        return [{ text: `Arrival ${arrival}` }];
    }

    const segments: TimetableRowSegment[] = [];
    const arrival = schedule.calculatedArrivalTime;
    const departure = schedule.calculatedDepartureTime;
    const travel = formatTravelFromPrevious(routeStop.travel_time_from_previous_seconds);

    if (arrival) {
        segments.push({ text: `Arr ${arrival}` });
    }
    if (departure) {
        segments.push({ text: `Dep ${departure}` });
    }
    if (travel !== ROUTE_STOP_TRAVEL_PLACEHOLDER) {
        segments.push({ text: `${travel} travel`, muted: true });
    }

    return segments;
}

export function calculatedTimetableRowHasDisplayData(
    routeStop: RouteStopTimingFields,
    schedule: VariantTimetableStopSchedule,
): boolean {
    return getCalculatedTimetableRowSegments(routeStop, schedule).length > 0;
}

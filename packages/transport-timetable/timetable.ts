/** Editable per-stop timetable inputs used to derive offset columns. */
export type TimetableStopInput = {
    readonly travel_time_from_previous_seconds: number | null;
    readonly waiting_time_seconds: number | null;
};

/** Calculated offset outputs stored on route_stops. */
export type TimetableStopCalculated = {
    readonly arrival_offset_seconds: number | null;
    readonly departure_offset_seconds: number | null;
};

/** Per-stop timetable schedule used by UI and routing preparation. */
export type VariantTimetableStopSchedule = {
    readonly isFirst: boolean;
    readonly isLast: boolean;
    readonly arrivalOffsetSeconds: number | null;
    readonly departureOffsetSeconds: number | null;
    readonly calculatedArrivalTime: string | null;
    readonly calculatedDepartureTime: string | null;
    readonly arrivalDayOffset: number | null;
    readonly departureDayOffset: number | null;
    readonly primaryClockTime: string | null;
    readonly hasArrivalClockData: boolean;
    readonly hasDepartureClockData: boolean;
    readonly hasPrimaryClockData: boolean;
};

export type CalculateVariantTimetableScheduleInput = {
    readonly departureTimeText: string | null | undefined;
    readonly stops: readonly TimetableStopInput[];
};

export type TimetableRowContext = {
    readonly departureTimeText: string | null | undefined;
    readonly isFirst: boolean;
    readonly isLast: boolean;
};

export type RouteStopTimetableFields = TimetableStopInput & {
    readonly arrival_offset_seconds?: number | null;
    readonly departure_offset_seconds?: number | null;
};

export type RouteStopClockTimes = {
    readonly arrivalClockTime: string | null;
    readonly departureClockTime: string | null;
    readonly primaryClockTime: string | null;
    readonly hasArrivalClockData: boolean;
    readonly hasDepartureClockData: boolean;
    readonly hasPrimaryClockData: boolean;
};

import {
    addSecondsToCanonicalTime,
    formatCanonicalTimeForDisplay,
    isValidTransportTimeInput,
    parseTimeInputToCanonical,
    resolveTimeAnchorToCanonical,
    resolveVariantDepartureAnchor,
} from "./transport-time.js";

const SCHEDULED_TRANSPORT_MODES = new Set([
    "bus",
    "express_bus",
    "train",
    "ferry",
    "air",
    "other",
]);

function finiteNonNegativeSeconds(value: number | null | undefined): number | null {
    if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return Math.trunc(value);
}

function coalesceWaitingSeconds(value: number | null | undefined): number {
    const waiting = finiteNonNegativeSeconds(value);
    return waiting ?? 0;
}

/** True for transport modes that share the variant timetable editor flow. */
export function supportsVariantTimetable(mode: string | null | undefined): boolean {
    if (!mode) {
        return false;
    }
    return SCHEDULED_TRANSPORT_MODES.has(mode);
}

/** @deprecated Use resolveTimeAnchorToCanonical and minute math from transport-time instead. */
export function parseClockTimeToMinutes(text: string): number | null {
    const canonical = resolveTimeAnchorToCanonical(text);
    if (!canonical) {
        return null;
    }
    const [hours, minutes] = canonical.split(":").map(Number);
    return hours! * 60 + minutes!;
}

/** @deprecated Use parseTimeInputToCanonical instead. */
export function normalizeClockTimeText(text: string): string | null {
    return parseTimeInputToCanonical(text);
}

/** @deprecated Use formatCanonicalTimeForDisplay instead. */
export function formatMinutesToClockTime(totalMinutes: number): string {
    const wrapped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const hours24 = Math.floor(wrapped / 60);
    const minutes = wrapped % 60;
    const canonical = `${String(hours24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    return formatCanonicalTimeForDisplay(canonical);
}

/**
 * Adds a timetable offset (seconds from first departure) to the variant departure
 * anchor and returns a clock-time label, or null when the anchor/offset is missing.
 */
export function offsetSecondsToClockTime(
    departureTimeText: string | null | undefined,
    offsetSeconds: number | null | undefined,
): string | null {
    const anchor = departureTimeText?.trim();
    if (!anchor || offsetSeconds === null || offsetSeconds === undefined) {
        return null;
    }

    const canonical = resolveVariantDepartureAnchor(departureTimeText);
    if (!canonical || !Number.isFinite(offsetSeconds)) {
        return null;
    }

    return addSecondsToCanonicalTime(canonical, offsetSeconds)?.displayTime ?? null;
}

type CalculatedClock = {
    readonly displayTime: string | null;
    readonly dayOffset: number | null;
};

function offsetSecondsToCalculatedClock(
    anchor: string | null,
    offsetSeconds: number | null | undefined,
): CalculatedClock {
    if (!anchor || offsetSeconds === null || offsetSeconds === undefined) {
        return { displayTime: null, dayOffset: null };
    }

    const result = addSecondsToCanonicalTime(anchor, offsetSeconds);
    if (!result) {
        return { displayTime: null, dayOffset: null };
    }

    return {
        displayTime: result.displayTime,
        dayOffset: result.dayOffset,
    };
}

function buildRouteStopScheduleFromOffsets(
    anchor: string | null,
    offsets: TimetableStopCalculated,
    position: { readonly isFirst: boolean; readonly isLast: boolean },
): VariantTimetableStopSchedule {
    const { isFirst, isLast } = position;
    const isOnlyStop = isFirst && isLast;

    const arrival = offsetSecondsToCalculatedClock(anchor, offsets.arrival_offset_seconds);
    const departure =
        isLast && !isOnlyStop
            ? { displayTime: null, dayOffset: null }
            : offsetSecondsToCalculatedClock(anchor, offsets.departure_offset_seconds);

    let primaryClockTime: string | null;
    let hasPrimaryClockData: boolean;

    if (isOnlyStop || isFirst) {
        primaryClockTime = departure.displayTime;
        hasPrimaryClockData = departure.displayTime !== null;
    } else if (isLast) {
        primaryClockTime = arrival.displayTime;
        hasPrimaryClockData = arrival.displayTime !== null;
    } else {
        primaryClockTime = arrival.displayTime;
        hasPrimaryClockData = arrival.displayTime !== null;
    }

    return {
        isFirst,
        isLast,
        arrivalOffsetSeconds: offsets.arrival_offset_seconds,
        departureOffsetSeconds: offsets.departure_offset_seconds,
        calculatedArrivalTime: arrival.displayTime,
        calculatedDepartureTime: departure.displayTime,
        arrivalDayOffset: arrival.dayOffset,
        departureDayOffset: departure.dayOffset,
        primaryClockTime,
        hasArrivalClockData: arrival.displayTime !== null,
        hasDepartureClockData: departure.displayTime !== null,
        hasPrimaryClockData,
    };
}

/**
 * Unified variant timetable calculation for all scheduled transport modes.
 *
 * Derives offsets from editable travel/waiting inputs, then resolves display
 * clock times from the canonical departure anchor. Null anchor yields null clocks.
 */
export function calculateVariantTimetableSchedule(
    input: CalculateVariantTimetableScheduleInput,
): VariantTimetableStopSchedule[] {
    const anchor = resolveVariantDepartureAnchor(input.departureTimeText);
    const offsets = calculateVariantTimetableOffsets(input.stops);

    return offsets.map((offsetRow, index) =>
        buildRouteStopScheduleFromOffsets(anchor, offsetRow, {
            isFirst: index === 0,
            isLast: index === input.stops.length - 1,
        }),
    );
}

/** Extracts offset rows for database persistence from a full schedule. */
export function variantTimetableScheduleToOffsets(
    schedule: readonly VariantTimetableStopSchedule[],
): TimetableStopCalculated[] {
    return schedule.map((row) => ({
        arrival_offset_seconds: row.arrivalOffsetSeconds,
        departure_offset_seconds: row.departureOffsetSeconds,
    }));
}

/**
 * Derives arrival/departure offsets for an ordered variant stop list.
 *
 * - First stop: arrival null, departure 0
 * - Middle stops: arrival = prev departure + travel; departure = arrival + coalesce(waiting, 0)
 * - Final stop: arrival as above, departure null
 * - Single stop: first-stop rules apply
 *
 * Null travel keeps arrival/departure offsets null. Null waiting is treated as 0
 * only for departure_offset calculation; waiting_time_seconds itself is not changed.
 */
export function calculateVariantTimetableOffsets(
    stops: readonly TimetableStopInput[],
): TimetableStopCalculated[] {
    if (stops.length === 0) {
        return [];
    }

    const result: TimetableStopCalculated[] = [];

    for (let index = 0; index < stops.length; index += 1) {
        const isFirst = index === 0;
        const isLast = index === stops.length - 1;
        const stop = stops[index]!;

        if (isFirst) {
            result.push({
                arrival_offset_seconds: null,
                departure_offset_seconds: 0,
            });
            continue;
        }

        const previous = result[index - 1]!;
        const previousDeparture = previous.departure_offset_seconds;
        const travel = finiteNonNegativeSeconds(stop.travel_time_from_previous_seconds);
        const arrival =
            previousDeparture === null || travel === null ? null : previousDeparture + travel;

        if (isLast) {
            result.push({
                arrival_offset_seconds: arrival,
                departure_offset_seconds: null,
            });
            continue;
        }

        const departure =
            arrival === null ? null : arrival + coalesceWaitingSeconds(stop.waiting_time_seconds);

        result.push({
            arrival_offset_seconds: arrival,
            departure_offset_seconds: departure,
        });
    }

    return result;
}

/**
 * Resolves arrival, departure, and primary display clock labels for one stop row
 * using stored offsets and the canonical variant departure anchor.
 */
export function resolveRouteStopClockTimes(
    routeStop: RouteStopTimetableFields,
    context: TimetableRowContext,
): RouteStopClockTimes {
    const anchor = resolveVariantDepartureAnchor(context.departureTimeText);
    const schedule = buildRouteStopScheduleFromOffsets(
        anchor,
        {
            arrival_offset_seconds: routeStop.arrival_offset_seconds ?? null,
            departure_offset_seconds: routeStop.departure_offset_seconds ?? null,
        },
        {
            isFirst: context.isFirst,
            isLast: context.isLast,
        },
    );

    return {
        arrivalClockTime: schedule.calculatedArrivalTime,
        departureClockTime: schedule.calculatedDepartureTime,
        primaryClockTime: schedule.primaryClockTime,
        hasArrivalClockData: schedule.hasArrivalClockData,
        hasDepartureClockData: schedule.hasDepartureClockData,
        hasPrimaryClockData: schedule.hasPrimaryClockData,
    };
}

/** @deprecated Use isValidTransportTimeInput instead. */
export function isValidClockTimeText(text: string): boolean {
    return isValidTransportTimeInput(text);
}

export {
    TRANSPORT_TIME_EMPTY_DISPLAY,
    addSecondsToCanonicalTime,
    formatCanonicalTimeForDisplay,
    isValidTransportTimeInput,
    parseSourceTimeToCanonical,
    parseTimeInputToCanonical,
    resolveTimeAnchorToCanonical,
    resolveVariantDepartureAnchor,
    hasExplicitVariantDepartureTime,
    validateCanonicalTime,
    type CanonicalTimeCalculation,
} from "./transport-time.js";

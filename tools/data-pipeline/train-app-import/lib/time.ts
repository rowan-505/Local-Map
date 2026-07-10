/**
 * Clock-time parsing and offset calculation for train schedules.
 *
 * Offsets are relative to the first station departure (skill rule).
 */

import {
    parseSourceTimeToCanonical,
    resolveTimeAnchorToCanonical,
    validateCanonicalTime,
} from "../../../../packages/transport-timetable/transport-time.ts";

import type { SourceTimeType } from "./types.js";

const MINUTES_PER_DAY = 24 * 60;
const SECONDS_PER_MINUTE = 60;

/** Input row for calculateTrainOffsets (one station). */
export type TrainOffsetStationInput = {
    sequence: number;
    source_time_text?: string | null;
};

/** Output row from calculateTrainOffsets. */
export type TrainOffsetStationResult = {
    sequence: number;
    source_time_text: string | null;
    source_time_type: SourceTimeType;
    travel_time_from_previous_seconds: number | null;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
};

/**
 * Parse a 12-hour clock string like "05:00 AM" or canonical "05:00".
 * Returns minutes from midnight, or null when not parseable.
 */
export function parseClockTimeToMinutes(timeText: string): number | null {
    const canonical = resolveTimeAnchorToCanonical(timeText);
    if (!canonical) {
        return null;
    }
    const [hours, minutes] = canonical.split(":").map(Number);
    return hours! * 60 + minutes!;
}

export { parseSourceTimeToCanonical, validateCanonicalTime };

/**
 * Parse route duration text like "13 hr 30 min".
 * Returns total minutes, or null when not parseable.
 */
export function parseDurationToMinutes(text: string): number | null {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }

    const match = trimmed.match(/^(\d+)\s*hr\s*(\d+)\s*min$/i);
    if (!match) {
        return null;
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) {
        return null;
    }

    return hours * 60 + minutes;
}

function parseClockTimesFromText(text: string): number[] {
    const matches = text.match(/\d{1,2}:\d{2}\s*(?:AM|PM)/gi) ?? [];
    const times: number[] = [];

    for (const match of matches) {
        const minutes = parseClockTimeToMinutes(match);
        if (minutes !== null) {
            times.push(minutes);
        }
    }

    if (times.length > 0) {
        return times;
    }

    const twentyFourHourMatches = text.match(/\b\d{1,2}:\d{2}\b/g) ?? [];
    for (const match of twentyFourHourMatches) {
        const minutes = parseClockTimeToMinutes(match);
        if (minutes !== null) {
            times.push(minutes);
        }
    }

    return times;
}

/** Extend minute value across midnight when it is earlier than the previous event. */
export function extendMinutesAcrossMidnight(
    minutes: number,
    previousExtendedMinutes: number | null,
): number {
    if (previousExtendedMinutes === null) {
        return minutes;
    }

    let extended = minutes;
    while (extended < previousExtendedMinutes) {
        extended += MINUTES_PER_DAY;
    }
    return extended;
}

function minutesToSeconds(minutes: number): number {
    return minutes * SECONDS_PER_MINUTE;
}

function resolveSourceTimeType(
    index: number,
    lastIndex: number,
    sourceTimeText: string | null | undefined,
): SourceTimeType {
    if (index === 0) {
        return "departure";
    }
    if (index === lastIndex) {
        return "arrival";
    }

    const times = parseClockTimesFromText(sourceTimeText ?? "");
    if (times.length >= 2) {
        return "arrival_departure";
    }

    // YRS web shows one clock time per intermediate stop (arrival only).
    return "arrival";
}

function resolveArrivalDepartureMinutes(
    sourceTimeText: string | null | undefined,
    sourceTimeType: SourceTimeType,
): { arrival: number | null; departure: number | null } {
    if (!sourceTimeText?.trim()) {
        return { arrival: null, departure: null };
    }

    const times = parseClockTimesFromText(sourceTimeText);
    if (times.length === 0) {
        return { arrival: null, departure: null };
    }

    if (sourceTimeType === "departure") {
        return { arrival: null, departure: times[0] ?? null };
    }

    if (sourceTimeType === "arrival") {
        return { arrival: times[0] ?? null, departure: null };
    }

    if (sourceTimeType === "arrival_departure" && times.length >= 2) {
        return {
            arrival: times[0] ?? null,
            departure: times[times.length - 1] ?? null,
        };
    }

    if (times.length >= 2) {
        return {
            arrival: times[0] ?? null,
            departure: times[times.length - 1] ?? null,
        };
    }

    const only = times[0] ?? null;
    return { arrival: only, departure: only };
}

/**
 * Calculate timing offsets for ordered station rows.
 *
 * Uses source_time_text only. First station is departure, last is arrival,
 * middle stations are unknown. Midnight crossing adds 24 hours when needed.
 */
export function calculateTrainOffsets(
    stations: TrainOffsetStationInput[],
): TrainOffsetStationResult[] {
    if (stations.length === 0) {
        return [];
    }

    const ordered = [...stations].sort((a, b) => a.sequence - b.sequence);
    const lastIndex = ordered.length - 1;

    const parsed = ordered.map((station, index) => {
        const sourceTimeType = resolveSourceTimeType(index, lastIndex, station.source_time_text);
        const sourceTimeText = station.source_time_text?.trim() || null;
        const { arrival, departure } = resolveArrivalDepartureMinutes(
            sourceTimeText,
            sourceTimeType,
        );

        return {
            sequence: station.sequence,
            source_time_text: sourceTimeText,
            source_time_type: sourceTimeType,
            arrival,
            departure,
        };
    });

    let lastExtendedEvent: number | null = null;
    const extended = parsed.map((row) => {
        let extendedArrival: number | null = null;
        let extendedDeparture: number | null = null;

        if (row.arrival !== null) {
            extendedArrival = extendMinutesAcrossMidnight(row.arrival, lastExtendedEvent);
            lastExtendedEvent = extendedArrival;
        }

        if (row.departure !== null) {
            extendedDeparture = extendMinutesAcrossMidnight(
                row.departure,
                lastExtendedEvent,
            );
            lastExtendedEvent = extendedDeparture;
        }

        return {
            ...row,
            extendedArrival,
            extendedDeparture,
        };
    });

    const originDeparture = extended[0]?.extendedDeparture ?? null;

    const previousEventMinutes = (
        previous: (typeof extended)[number] | null,
    ): number | null => previous?.extendedDeparture ?? previous?.extendedArrival ?? null;

    return extended.map((row, index) => {
        const previous = index > 0 ? extended[index - 1] : null;
        const previousEvent = previousEventMinutes(previous);

        const travel_time_from_previous_seconds =
            index === 0 || row.extendedArrival === null || previousEvent === null
                ? null
                : minutesToSeconds(row.extendedArrival - previousEvent);

        const arrival_offset_seconds =
            row.extendedArrival === null || originDeparture === null
                ? null
                : minutesToSeconds(row.extendedArrival - originDeparture);

        const departure_offset_seconds =
            row.extendedDeparture === null || originDeparture === null
                ? null
                : minutesToSeconds(row.extendedDeparture - originDeparture);

        return {
            sequence: row.sequence,
            source_time_text: row.source_time_text,
            source_time_type: row.source_time_type,
            travel_time_from_previous_seconds,
            arrival_offset_seconds,
            departure_offset_seconds,
        };
    });
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

type SelfTestCase = {
    name: string;
    run: () => void;
};

function assertEqual<T>(actual: T, expected: T, label: string): void {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
        throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
    }
}

function runSelfTest(): void {
    const cases: SelfTestCase[] = [
        {
            name: "parseClockTimeToMinutes AM",
            run: () => {
                assertEqual(parseClockTimeToMinutes("05:00 AM"), 300, "05:00 AM");
                assertEqual(parseClockTimeToMinutes("12:00 AM"), 0, "12:00 AM");
                assertEqual(parseClockTimeToMinutes("12:30 AM"), 30, "12:30 AM");
            },
        },
        {
            name: "parseClockTimeToMinutes PM",
            run: () => {
                assertEqual(parseClockTimeToMinutes("06:30 PM"), 18 * 60 + 30, "06:30 PM");
                assertEqual(parseClockTimeToMinutes("12:00 PM"), 12 * 60, "12:00 PM");
            },
        },
        {
            name: "parseClockTimeToMinutes invalid",
            run: () => {
                assertEqual(parseClockTimeToMinutes(""), null, "empty");
                assertEqual(parseClockTimeToMinutes("bad"), null, "bad");
            },
        },
        {
            name: "parseDurationToMinutes",
            run: () => {
                assertEqual(parseDurationToMinutes("13 hr 30 min"), 13 * 60 + 30, "13 hr 30 min");
                assertEqual(parseDurationToMinutes("6 hr 0 min"), 6 * 60, "6 hr 0 min");
                assertEqual(parseDurationToMinutes("10 hr 10 min"), 10 * 60 + 10, "10 hr 10 min");
                assertEqual(parseDurationToMinutes("n/a"), null, "invalid");
            },
        },
        {
            name: "calculateTrainOffsets simple route",
            run: () => {
                const result = calculateTrainOffsets([
                    { sequence: 1, source_time_text: "05:00 AM" },
                    { sequence: 2, source_time_text: "06:00 AM / 06:05 AM" },
                    { sequence: 3, source_time_text: "07:00 AM" },
                ]);

                assertEqual(result[0]?.source_time_type, "departure", "first type");
                assertEqual(result[2]?.source_time_type, "arrival", "last type");
                assertEqual(result[1]?.source_time_type, "arrival_departure", "middle type");
                assertEqual(result[0]?.departure_offset_seconds, 0, "origin departure");
                assertEqual(result[1]?.travel_time_from_previous_seconds, 60 * 60, "leg 2 travel");
                assertEqual(result[2]?.arrival_offset_seconds, 2 * 60 * 60, "final arrival");
            },
        },
        {
            name: "calculateTrainOffsets midnight crossing",
            run: () => {
                const result = calculateTrainOffsets([
                    { sequence: 1, source_time_text: "10:00 PM" },
                    { sequence: 2, source_time_text: "11:30 PM / 11:35 PM" },
                    { sequence: 3, source_time_text: "01:00 AM" },
                ]);

                assertEqual(result[2]?.arrival_offset_seconds, 3 * 60 * 60, "cross-midnight arrival");
                assertEqual(
                    result[2]?.travel_time_from_previous_seconds,
                    85 * 60,
                    "cross-midnight leg travel",
                );
            },
        },
    ];

    let passed = 0;
    for (const testCase of cases) {
        testCase.run();
        passed += 1;
        console.log(`ok - ${testCase.name}`);
    }

    console.log(`\n${passed}/${cases.length} self-tests passed`);
}

const isSelfTestEntry =
    process.argv[1]?.includes("time.ts") && process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runSelfTest();
}

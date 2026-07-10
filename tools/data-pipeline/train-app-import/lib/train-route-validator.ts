/**
 * Pure validation helpers for imported train routes.
 * No database access.
 */

import {
    TRAIN_IMPORT_GENERATION,
    TRAIN_IMPORT_REVIEW_STATUS,
    TRAIN_MODE,
} from "./train-import-constants.js";

export type ValidationCheckStatus = "passed" | "failed" | "skipped";

export type TrainValidationCheck = {
    check_id: number;
    name: string;
    status: ValidationCheckStatus;
    message: string;
};

export type DbRouteRow = {
    route_id: number;
    route_code: string;
    mode: string;
    review_status: string;
    is_active: boolean;
    normalized_data: Record<string, unknown> | null;
};

export type DbVariantRow = {
    variant_id: number;
    variant_code: string;
    review_status: string;
    is_active: boolean;
    normalized_data: Record<string, unknown> | null;
};

export type DbRouteStopRow = {
    route_stop_id: number;
    stop_id: number | null;
    stop_sequence: number;
    arrival_offset_seconds: number | null;
    departure_offset_seconds: number | null;
    source_time_type: string | null;
    stop_exists: boolean;
    stop_mode: string | null;
    has_geom: boolean;
};

export type TrainRouteValidationInput = {
    variant_code: string;
    route: DbRouteRow | null;
    variant: DbVariantRow | null;
    route_stops: DbRouteStopRow[];
    expected_stop_count: number | null;
    warnings?: string[];
};

export type TrainRouteValidationResult = {
    checks: TrainValidationCheck[];
    warnings: string[];
    overall_status: "passed" | "failed";
    summary: {
        passed: number;
        failed: number;
        skipped: number;
    };
};

function generationFromNormalizedData(data: Record<string, unknown> | null): string | null {
    const value = data?.generation;
    return typeof value === "string" ? value : null;
}

function check(
    check_id: number,
    name: string,
    status: ValidationCheckStatus,
    message: string,
): TrainValidationCheck {
    return { check_id, name, status, message };
}

export function validateTrainRouteData(input: TrainRouteValidationInput): TrainRouteValidationResult {
    const checks: TrainValidationCheck[] = [];
    const warnings = [...(input.warnings ?? [])];

    // 1. route exists
    if (input.route) {
        checks.push(check(1, "route_exists", "passed", `Route ${input.route.route_code} exists (id=${input.route.route_id})`));
    } else {
        checks.push(check(1, "route_exists", "failed", `Route not found for variant ${input.variant_code}`));
    }

    // 2. variant exists
    if (input.variant) {
        checks.push(
            check(2, "variant_exists", "passed", `Variant ${input.variant.variant_code} exists (id=${input.variant.variant_id})`),
        );
    } else {
        checks.push(check(2, "variant_exists", "failed", `Variant ${input.variant_code} not found`));
    }

    if (!input.route || !input.variant) {
        const remaining = [
            [3, "route_mode_train"],
            [4, "route_generation"],
            [5, "variant_generation"],
            [6, "route_stop_count"],
            [7, "stop_sequence_starts_at_one"],
            [8, "stop_sequence_no_gaps"],
            [9, "route_stop_has_stop_id"],
            [10, "stop_id_exists"],
            [11, "stop_has_geom"],
            [12, "arrival_offset_non_decreasing"],
            [13, "first_station_departure"],
            [14, "last_station_arrival"],
            [15, "inactive_until_reviewed"],
        ] as const;
        for (const [id, name] of remaining) {
            checks.push(check(id, name, "skipped", "Skipped because route or variant is missing"));
        }
        return finalize(checks, warnings);
    }

    // 3. route mode = train
    if (input.route.mode === TRAIN_MODE) {
        checks.push(check(3, "route_mode_train", "passed", `Route mode is ${TRAIN_MODE}`));
    } else {
        checks.push(
            check(3, "route_mode_train", "failed", `Route mode is ${input.route.mode}, expected ${TRAIN_MODE}`),
        );
    }

    // 4. route generation
    const routeGeneration = generationFromNormalizedData(input.route.normalized_data);
    if (routeGeneration === TRAIN_IMPORT_GENERATION) {
        checks.push(
            check(4, "route_generation", "passed", `Route generation is ${TRAIN_IMPORT_GENERATION}`),
        );
    } else {
        checks.push(
            check(
                4,
                "route_generation",
                "failed",
                `Route generation is ${routeGeneration ?? "missing"}, expected ${TRAIN_IMPORT_GENERATION}`,
            ),
        );
    }

    // 5. variant generation
    const variantGeneration = generationFromNormalizedData(input.variant.normalized_data);
    if (variantGeneration === TRAIN_IMPORT_GENERATION) {
        checks.push(
            check(5, "variant_generation", "passed", `Variant generation is ${TRAIN_IMPORT_GENERATION}`),
        );
    } else {
        checks.push(
            check(
                5,
                "variant_generation",
                "failed",
                `Variant generation is ${variantGeneration ?? "missing"}, expected ${TRAIN_IMPORT_GENERATION}`,
            ),
        );
    }

    const stops = [...input.route_stops].sort((a, b) => a.stop_sequence - b.stop_sequence);

    // 6. route_stop count
    if (input.expected_stop_count == null) {
        checks.push(
            check(
                6,
                "route_stop_count",
                "failed",
                "Expected stop count is unknown",
            ),
        );
    } else if (stops.length === input.expected_stop_count) {
        checks.push(
            check(
                6,
                "route_stop_count",
                "passed",
                `Route stop count ${stops.length} matches expected ${input.expected_stop_count}`,
            ),
        );
    } else {
        checks.push(
            check(
                6,
                "route_stop_count",
                "failed",
                `Route stop count ${stops.length} does not match expected ${input.expected_stop_count}`,
            ),
        );
    }

    // 7. stop_sequence starts at 1
    if (stops.length === 0) {
        checks.push(check(7, "stop_sequence_starts_at_one", "failed", "No route_stops found"));
    } else if (stops[0]!.stop_sequence === 1) {
        checks.push(check(7, "stop_sequence_starts_at_one", "passed", "First stop_sequence is 1"));
    } else {
        checks.push(
            check(
                7,
                "stop_sequence_starts_at_one",
                "failed",
                `First stop_sequence is ${stops[0]!.stop_sequence}, expected 1`,
            ),
        );
    }

    // 8. no gaps
    const gap = stops.find((row, index) => row.stop_sequence !== index + 1);
    if (stops.length === 0) {
        checks.push(check(8, "stop_sequence_no_gaps", "failed", "No route_stops found"));
    } else if (!gap) {
        checks.push(check(8, "stop_sequence_no_gaps", "passed", "stop_sequence has no gaps"));
    } else {
        checks.push(
            check(
                8,
                "stop_sequence_no_gaps",
                "failed",
                `stop_sequence gap at row index ${stops.indexOf(gap)} (sequence=${gap.stop_sequence})`,
            ),
        );
    }

    // 9. every route_stop has stop_id
    const missingStopId = stops.find((row) => !row.stop_id || row.stop_id <= 0);
    if (stops.length === 0) {
        checks.push(check(9, "route_stop_has_stop_id", "failed", "No route_stops found"));
    } else if (!missingStopId) {
        checks.push(check(9, "route_stop_has_stop_id", "passed", "Every route_stop has stop_id"));
    } else {
        checks.push(
            check(
                9,
                "route_stop_has_stop_id",
                "failed",
                `route_stop ${missingStopId.route_stop_id} at sequence ${missingStopId.stop_sequence} has no stop_id`,
            ),
        );
    }

    // 10. every stop_id exists in transport.stops
    const missingStop = stops.find((row) => row.stop_id && !row.stop_exists);
    if (stops.length === 0) {
        checks.push(check(10, "stop_id_exists", "failed", "No route_stops found"));
    } else if (!missingStop) {
        checks.push(check(10, "stop_id_exists", "passed", "Every stop_id exists in transport.stops"));
    } else {
        checks.push(
            check(
                10,
                "stop_id_exists",
                "failed",
                `stop_id ${missingStop.stop_id} at sequence ${missingStop.stop_sequence} not found in transport.stops`,
            ),
        );
    }

    // 11. every stop has geom
    const missingGeom = stops.find((row) => row.stop_id && row.stop_exists && !row.has_geom);
    if (stops.length === 0) {
        checks.push(check(11, "stop_has_geom", "failed", "No route_stops found"));
    } else if (!missingGeom) {
        checks.push(check(11, "stop_has_geom", "passed", "Every matched stop has geometry"));
    } else {
        checks.push(
            check(
                11,
                "stop_has_geom",
                "failed",
                `stop_id ${missingGeom.stop_id} at sequence ${missingGeom.stop_sequence} has no geometry`,
            ),
        );
    }

    // 12. arrival_offset_seconds non-decreasing
    let arrivalViolation: DbRouteStopRow | null = null;
    let previousArrival: number | null = null;
    for (const row of stops) {
        if (row.arrival_offset_seconds == null) {
            continue;
        }
        if (previousArrival != null && row.arrival_offset_seconds < previousArrival) {
            arrivalViolation = row;
            break;
        }
        previousArrival = row.arrival_offset_seconds;
    }
    if (stops.length === 0) {
        checks.push(check(12, "arrival_offset_non_decreasing", "failed", "No route_stops found"));
    } else if (!arrivalViolation) {
        checks.push(
            check(12, "arrival_offset_non_decreasing", "passed", "arrival_offset_seconds is non-decreasing"),
        );
    } else {
        checks.push(
            check(
                12,
                "arrival_offset_non_decreasing",
                "failed",
                `arrival_offset_seconds decreases at sequence ${arrivalViolation.stop_sequence}`,
            ),
        );
    }

    // 13. first station source_time_type is departure
    const first = stops[0];
    if (!first) {
        checks.push(check(13, "first_station_departure", "failed", "No route_stops found"));
    } else if (first.source_time_type === "departure") {
        checks.push(check(13, "first_station_departure", "passed", "First station source_time_type is departure"));
    } else {
        checks.push(
            check(
                13,
                "first_station_departure",
                "failed",
                `First station source_time_type is ${first.source_time_type ?? "missing"}, expected departure`,
            ),
        );
    }

    // 14. last station source_time_type is arrival
    const last = stops[stops.length - 1];
    if (!last) {
        checks.push(check(14, "last_station_arrival", "failed", "No route_stops found"));
    } else if (last.source_time_type === "arrival") {
        checks.push(check(14, "last_station_arrival", "passed", "Last station source_time_type is arrival"));
    } else {
        checks.push(
            check(
                14,
                "last_station_arrival",
                "failed",
                `Last station source_time_type is ${last.source_time_type ?? "missing"}, expected arrival`,
            ),
        );
    }

    // 15. route and variant inactive until reviewed
    const routeInactive =
        input.route.is_active === false &&
        input.route.review_status === TRAIN_IMPORT_REVIEW_STATUS;
    const variantInactive =
        input.variant.is_active === false &&
        input.variant.review_status === TRAIN_IMPORT_REVIEW_STATUS;

    if (routeInactive && variantInactive) {
        checks.push(
            check(
                15,
                "inactive_until_reviewed",
                "passed",
                `Route and variant are inactive with review_status=${TRAIN_IMPORT_REVIEW_STATUS}`,
            ),
        );
    } else {
        const parts: string[] = [];
        if (!routeInactive) {
            parts.push(
                `route is_active=${input.route.is_active}, review_status=${input.route.review_status}`,
            );
        }
        if (!variantInactive) {
            parts.push(
                `variant is_active=${input.variant.is_active}, review_status=${input.variant.review_status}`,
            );
        }
        checks.push(
            check(
                15,
                "inactive_until_reviewed",
                "failed",
                `Route/variant are not safely inactive: ${parts.join("; ")}`,
            ),
        );
    }

    return finalize(checks, warnings);
}

function finalize(
    checks: TrainValidationCheck[],
    warnings: string[],
): TrainRouteValidationResult {
    const passed = checks.filter((row) => row.status === "passed").length;
    const failed = checks.filter((row) => row.status === "failed").length;
    const skipped = checks.filter((row) => row.status === "skipped").length;

    return {
        checks,
        warnings,
        overall_status: failed > 0 ? "failed" : "passed",
        summary: { passed, failed, skipped },
    };
}

export function runTrainRouteValidatorSelfTest(): void {
    const baseRoute: DbRouteRow = {
        route_id: 1,
        route_code: "TRAIN-11",
        mode: TRAIN_MODE,
        review_status: TRAIN_IMPORT_REVIEW_STATUS,
        is_active: false,
        normalized_data: { generation: TRAIN_IMPORT_GENERATION },
    };
    const baseVariant: DbVariantRow = {
        variant_id: 2,
        variant_code: "TRAIN-11-UP",
        review_status: TRAIN_IMPORT_REVIEW_STATUS,
        is_active: false,
        normalized_data: { generation: TRAIN_IMPORT_GENERATION },
    };
    const baseStops: DbRouteStopRow[] = [
        {
            route_stop_id: 10,
            stop_id: 100,
            stop_sequence: 1,
            arrival_offset_seconds: null,
            departure_offset_seconds: 0,
            source_time_type: "departure",
            stop_exists: true,
            stop_mode: TRAIN_MODE,
            has_geom: true,
        },
        {
            route_stop_id: 11,
            stop_id: 101,
            stop_sequence: 2,
            arrival_offset_seconds: 3600,
            departure_offset_seconds: 3900,
            source_time_type: "arrival_departure",
            stop_exists: true,
            stop_mode: TRAIN_MODE,
            has_geom: true,
        },
        {
            route_stop_id: 12,
            stop_id: 102,
            stop_sequence: 3,
            arrival_offset_seconds: 7200,
            departure_offset_seconds: null,
            source_time_type: "arrival",
            stop_exists: true,
            stop_mode: TRAIN_MODE,
            has_geom: true,
        },
    ];

    const ok = validateTrainRouteData({
        variant_code: "TRAIN-11-UP",
        route: baseRoute,
        variant: baseVariant,
        route_stops: baseStops,
        expected_stop_count: 3,
    });
    if (ok.overall_status !== "passed") {
        throw new Error(`expected passed validation, got ${ok.summary.failed} failures`);
    }

    const badSequence = validateTrainRouteData({
        variant_code: "TRAIN-11-UP",
        route: baseRoute,
        variant: baseVariant,
        route_stops: [
            { ...baseStops[0]!, stop_sequence: 2 },
            { ...baseStops[1]!, stop_sequence: 3 },
        ],
        expected_stop_count: 2,
    });
    if (badSequence.checks.find((row) => row.check_id === 7)?.status !== "failed") {
        throw new Error("expected stop_sequence start failure");
    }

    console.log("ok - train-route-validator self-test");
}

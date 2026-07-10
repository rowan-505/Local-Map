import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateVariantTimetableOffsets } from "./transport-timetable.js";

describe("calculateVariantTimetableOffsets", () => {
    it("handles first, middle, and final stops", () => {
        const calculated = calculateVariantTimetableOffsets([
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 1560, waiting_time_seconds: 300 },
            { travel_time_from_previous_seconds: 900, waiting_time_seconds: null },
        ]);

        assert.deepEqual(calculated, [
            { arrival_offset_seconds: null, departure_offset_seconds: 0 },
            { arrival_offset_seconds: 1560, departure_offset_seconds: 1860 },
            { arrival_offset_seconds: 2760, departure_offset_seconds: null },
        ]);
    });

    it("uses zero when waiting is null on middle stops", () => {
        const calculated = calculateVariantTimetableOffsets([
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 600, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: 300, waiting_time_seconds: 0 },
        ]);

        assert.deepEqual(calculated[1], {
            arrival_offset_seconds: 600,
            departure_offset_seconds: 600,
        });
    });

    it("keeps offsets null when travel is missing", () => {
        const calculated = calculateVariantTimetableOffsets([
            { travel_time_from_previous_seconds: null, waiting_time_seconds: null },
            { travel_time_from_previous_seconds: null, waiting_time_seconds: 120 },
        ]);

        assert.deepEqual(calculated[1], {
            arrival_offset_seconds: null,
            departure_offset_seconds: null,
        });
    });

    it("applies first-stop rules for a single stop", () => {
        assert.deepEqual(
            calculateVariantTimetableOffsets([
                { travel_time_from_previous_seconds: 999, waiting_time_seconds: 999 },
            ]),
            [{ arrival_offset_seconds: null, departure_offset_seconds: 0 }],
        );
    });
});

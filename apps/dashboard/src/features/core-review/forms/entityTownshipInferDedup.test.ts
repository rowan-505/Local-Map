import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
    abortInferDedupKey,
    buildInferDedupKey,
    peekCompletedInferResult,
    resetInferDedupStateForTests,
    scheduleInferDeduped,
    stableInferGeometryKey,
} from "./entityTownshipInferDedup";

// Real timers with a tiny debounce keep these async/abort flows deterministic
// without depending on fake-timer microtask semantics.
const DEBOUNCE_MS = 5;

describe("entityTownshipInferDedup", () => {
    afterEach(() => {
        resetInferDedupStateForTests();
    });

    it("builds stable dedup keys for equivalent geometry coordinates", () => {
        const geometryKey = stableInferGeometryKey(
            "street",
            {
                type: "LineString",
                coordinates: [
                    [96.12345678901, 16.98765432109],
                    [96.22345678901, 16.88765432109],
                ],
            },
            null,
            null,
        );
        const geometryKeyRounded = stableInferGeometryKey(
            "street",
            {
                type: "LineString",
                coordinates: [
                    [96.12345678902, 16.98765432108],
                    [96.22345678902, 16.88765432108],
                ],
            },
            null,
            null,
        );

        assert.equal(geometryKey, geometryKeyRounded);
        assert.equal(
            buildInferDedupKey({
                kind: "street",
                entityPublicId: "b9a8902c-d202-46b6-8e89-0a3bab75a648",
                currentAdminAreaId: "42",
                geometryKey,
            }),
            "street|b9a8902c-d202-46b6-8e89-0a3bab75a648|42|" + geometryKey,
        );
    });

    it("dedupes concurrent schedules for the same key", async () => {
        const run = mock.fn(async () => ({
            admin_area_id: "1",
            canonical_name: "Township",
            admin_level_code: null,
            name_mm: null,
            name_en: null,
            geometry_contains: false,
        }));

        const first = scheduleInferDeduped("street|road|1|geom", DEBOUNCE_MS, run);
        const second = scheduleInferDeduped("street|road|1|geom", DEBOUNCE_MS, run);

        const [resultA, resultB] = await Promise.all([first, second]);

        assert.equal(run.mock.callCount(), 1);
        assert.deepEqual(resultA, resultB);
    });

    it("aborts stale in-flight requests when the key changes", async () => {
        let aborted = false;
        const firstRun = mock.fn(
            (_signal: AbortSignal) =>
                new Promise<never>((_resolve, reject) => {
                    _signal.addEventListener("abort", () => {
                        aborted = true;
                        reject(new DOMException("Aborted", "AbortError"));
                    });
                }),
        );
        const secondRun = mock.fn(async () => ({
            admin_area_id: "2",
            canonical_name: "Other",
            admin_level_code: null,
            name_mm: null,
            name_en: null,
            geometry_contains: false,
        }));

        const firstPromise = scheduleInferDeduped("street|road|1|geom-a", DEBOUNCE_MS, firstRun);
        const firstSettled = firstPromise.catch((error: unknown) => error);

        // Let the debounce fire and the in-flight run start before aborting.
        await delay(DEBOUNCE_MS * 4);
        abortInferDedupKey("street|road|1|geom-a");

        const secondPromise = scheduleInferDeduped("street|road|1|geom-b", DEBOUNCE_MS, secondRun);

        assert.ok(await firstSettled);
        assert.deepEqual(await secondPromise, {
            admin_area_id: "2",
            canonical_name: "Other",
            admin_level_code: null,
            name_mm: null,
            name_en: null,
            geometry_contains: false,
        });
        assert.equal(aborted, true);
        assert.equal(secondRun.mock.callCount(), 1);
    });

    it("does not reuse cached query_error infer results", async () => {
        const key = "street|road|1|geom";
        const queryErrorResult = {
            admin_area_id: null,
            canonical_name: null,
            admin_level_code: null,
            name_mm: null,
            name_en: null,
            geometry_contains: false,
            status: "no_match" as const,
            debugReason: "query_error" as const,
            message: "Township recommendation failed due to a query error (query_error).",
        };

        const run = mock.fn(async () => ({
            admin_area_id: "42",
            canonical_name: "Kyauktan",
            admin_level_code: null,
            name_mm: null,
            name_en: null,
            geometry_contains: true,
            status: "recommendation_found" as const,
            debugReason: null,
        }));

        const first = scheduleInferDeduped(key, DEBOUNCE_MS, async () => queryErrorResult);
        await first;
        assert.equal(peekCompletedInferResult(key), undefined);

        const second = scheduleInferDeduped(key, DEBOUNCE_MS, run);
        const result = await second;

        assert.equal(run.mock.callCount(), 1);
        assert.deepEqual(result, {
            admin_area_id: "42",
            canonical_name: "Kyauktan",
            admin_level_code: null,
            name_mm: null,
            name_en: null,
            geometry_contains: true,
            status: "recommendation_found",
            debugReason: null,
        });
    });
});

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

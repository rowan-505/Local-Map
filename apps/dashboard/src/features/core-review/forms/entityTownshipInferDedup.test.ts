import { afterEach, describe, expect, it, vi } from "vitest";

import {
    abortInferDedupKey,
    buildInferDedupKey,
    peekCompletedInferResult,
    resetInferDedupStateForTests,
    scheduleInferDeduped,
    stableInferGeometryKey,
} from "./entityTownshipInferDedup";

describe("entityTownshipInferDedup", () => {
    afterEach(() => {
        resetInferDedupStateForTests();
        vi.useRealTimers();
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

        expect(geometryKey).toBe(geometryKeyRounded);
        expect(
            buildInferDedupKey({
                kind: "street",
                entityPublicId: "b9a8902c-d202-46b6-8e89-0a3bab75a648",
                currentAdminAreaId: "42",
                geometryKey,
            }),
        ).toBe(
            "street|b9a8902c-d202-46b6-8e89-0a3bab75a648|42|" + geometryKey,
        );
    });

    it("dedupes concurrent schedules for the same key", async () => {
        vi.useFakeTimers();

        const run = vi.fn(async () => ({ admin_area_id: "1", canonical_name: "Township" }));

        const first = scheduleInferDeduped("street|road|1|geom", 500, run);
        const second = scheduleInferDeduped("street|road|1|geom", 500, run);

        await vi.advanceTimersByTimeAsync(500);

        const [resultA, resultB] = await Promise.all([first, second]);

        expect(run).toHaveBeenCalledTimes(1);
        expect(resultA).toEqual(resultB);
    });

    it("aborts stale in-flight requests when the key changes", async () => {
        vi.useFakeTimers();

        let aborted = false;
        const firstRun = vi.fn(
            (_signal: AbortSignal) =>
                new Promise<never>((_resolve, reject) => {
                    _signal.addEventListener("abort", () => {
                        aborted = true;
                        reject(new DOMException("Aborted", "AbortError"));
                    });
                }),
        );
        const secondRun = vi.fn(async () => ({ admin_area_id: "2", canonical_name: "Other" }));

        const firstPromise = scheduleInferDeduped("street|road|1|geom-a", 500, firstRun);
        await vi.advanceTimersByTimeAsync(500);
        const firstSettled = firstPromise.catch((error: unknown) => error);

        abortInferDedupKey("street|road|1|geom-a");

        const secondPromise = scheduleInferDeduped("street|road|1|geom-b", 500, secondRun);
        await vi.advanceTimersByTimeAsync(500);

        await expect(firstSettled).resolves.toBeTruthy();
        await expect(secondPromise).resolves.toEqual({
            admin_area_id: "2",
            canonical_name: "Other",
        });
        expect(aborted).toBe(true);
        expect(secondRun).toHaveBeenCalledTimes(1);
    });

    it("does not reuse cached query_error infer results", async () => {
        vi.useFakeTimers();

        const key = "street|road|1|geom";
        const queryErrorResult = {
            admin_area_id: null,
            canonical_name: null,
            status: "no_match" as const,
            debugReason: "query_error" as const,
            message: "Township recommendation failed due to a query error (query_error).",
        };

        const run = vi.fn(async () => ({
            admin_area_id: "42",
            canonical_name: "Kyauktan",
            status: "recommendation_found" as const,
            debugReason: null,
        }));

        const first = scheduleInferDeduped(key, 500, async () => queryErrorResult);
        await vi.advanceTimersByTimeAsync(500);
        await first;
        expect(peekCompletedInferResult(key)).toBeUndefined();

        const second = scheduleInferDeduped(key, 500, run);
        await vi.advanceTimersByTimeAsync(500);
        const result = await second;

        expect(run).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            admin_area_id: "42",
            canonical_name: "Kyauktan",
            status: "recommendation_found",
            debugReason: null,
        });
    });
});

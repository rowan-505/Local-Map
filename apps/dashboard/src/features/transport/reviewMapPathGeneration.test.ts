import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildGeneratePathFailureUi,
    buildGeneratePathSuccessUi,
    evaluateGeneratePathFromStopsReadiness,
    generatePathFromStopsCopy,
} from "./reviewMapPathGeneration.js";
import type {
    GeneratePathFromStopsResult,
    TransportRouteStopItem,
    TransportVariantSummary,
} from "./types.js";

function stop(
    id: string,
    sequence: number,
    options?: { geometry?: boolean },
): TransportRouteStopItem {
    const withGeom = options?.geometry !== false;
    return {
        id,
        stop_sequence: sequence,
        pickup_type: 0,
        drop_off_type: 0,
        is_timing_point: false,
        distance_from_start_m: null,
        stop: {
            public_id: `stop-${id}`,
            name: `Stop ${id}`,
            name_mm: null,
            name_en: `Stop ${id}`,
            mode: "bus",
            stop_type: "stop",
            geometry: withGeom
                ? { type: "Point", coordinates: [96.1 + Number(id), 16.8] }
                : null,
        },
    };
}

function variant(
    overrides: Partial<TransportVariantSummary> & Pick<TransportVariantSummary, "public_id">,
): TransportVariantSummary {
    return {
        variant_code: "YBS-1-D0",
        direction_name: "D0",
        direction_id: 0,
        headsign: null,
        origin_name: null,
        destination_name: null,
        first_stop_name: null,
        stop_count: 2,
        path_count: 0,
        path_status: "none",
        distance_m: null,
        estimated_duration_min: null,
        review_status: "needs_review",
        confidence_score: 60,
        is_active: true,
        ...overrides,
    };
}

function generatedPathResult(
    overrides: Partial<GeneratePathFromStopsResult> = {},
): GeneratePathFromStopsResult {
    return {
        route_path_id: "42",
        path_kind: "valhalla_snapped",
        review_status: "needs_review",
        distance_m: 1234,
        geometry: {
            type: "LineString",
            coordinates: [
                [96.1, 16.8],
                [96.2, 16.81],
            ],
        },
        warnings: [],
        ...overrides,
    };
}

const twoStops = [stop("1", 1), stop("2", 2)];

describe("evaluateGeneratePathFromStopsReadiness", () => {
    it("blocks generation when a stop move is unsaved", () => {
        const readiness = evaluateGeneratePathFromStopsReadiness(twoStops, true);
        assert.equal(readiness.eligible, false);
        assert.ok(readiness.reasons.includes("Save or revert stop changes first."));
    });

    it("allows generation when stops are saved and sequence is continuous", () => {
        const readiness = evaluateGeneratePathFromStopsReadiness(twoStops, false);
        assert.equal(readiness.eligible, true);
        assert.deepEqual(readiness.reasons, []);
    });
});

describe("generatePathFromStopsCopy", () => {
    it("uses Generate path from stops when the variant has no saved path", () => {
        const copy = generatePathFromStopsCopy(false);
        assert.equal(copy.buttonLabel, "Generate path from stops");
        assert.equal(copy.dialogTitle, "Generate path from stops");
        assert.match(copy.dialogBody, /current saved stop locations/);
        assert.equal(copy.confirmLabel, "Generate path");
        assert.equal(copy.dialogBody.includes("replace the current route path"), false);
    });

    it("uses Regenerate from stops when the variant already has a saved path", () => {
        const copy = generatePathFromStopsCopy(true);
        assert.equal(copy.buttonLabel, "Regenerate from stops");
        assert.equal(copy.dialogTitle, "Regenerate path from stops");
        assert.match(copy.dialogBody, /replace the current route path/);
        assert.match(copy.dialogBody, /Stop locations will not be changed/);
        assert.equal(copy.confirmLabel, "Regenerate");
    });
});

describe("buildGeneratePathFailureUi", () => {
    it("keeps the dialog open and retryable when Valhalla is unavailable", () => {
        const ui = buildGeneratePathFailureUi(
            new Error("Cannot reach Valhalla. Is the local service running?"),
        );
        assert.equal(ui.closeDialog, false);
        assert.equal(ui.retryable, true);
        assert.match(ui.error, /Cannot reach Valhalla/);
    });
});

describe("buildGeneratePathSuccessUi", () => {
    it("updates local path state and reloads stop quality without changing stops", () => {
        const selected = variant({ public_id: "variant-a", path_status: "none", path_count: 0 });
        const other = variant({ public_id: "variant-b", path_status: "none" });
        const result = generatedPathResult({
            warnings: ["No Valhalla route for stop pair 1→2; used straight line."],
        });

        const ui = buildGeneratePathSuccessUi({
            stops: twoStops,
            variants: [selected, other],
            selectedVariantId: "variant-a",
            result,
        });

        assert.equal(ui.closeDialog, true);
        assert.equal(ui.reloadStopQuality, true);
        assert.equal(ui.path.path_kind, "valhalla_snapped");
        assert.equal(ui.path.review_status, "needs_review");
        assert.equal(ui.path.id, "42");
        assert.equal(ui.variants[0]?.path_status, "has_path");
        assert.equal(ui.variants[0]?.path_count, 1);
        assert.equal(ui.variants[0]?.distance_m, 1234);
        assert.equal(ui.variants[1]?.path_status, "none");
        assert.equal(ui.toastMessage, "Path generated with 1 routing warning");
        assert.equal(ui.warnings.length, 1);
        assert.equal(ui.canEditPath, true);
        assert.equal(ui.stops, twoStops);
        assert.deepEqual(
            ui.stops.map((row) => row.stop_sequence),
            [1, 2],
        );
        assert.deepEqual(
            ui.stops.map((row) => row.id),
            ["1", "2"],
        );
        assert.equal(ui.stops[0]?.stop.geometry?.type, "Point");
    });

    it("keeps Edit path available after generation and does not rewrite stop sequence", () => {
        const ui = buildGeneratePathSuccessUi({
            stops: twoStops,
            variants: [variant({ public_id: "variant-a", path_status: "has_path", path_count: 1 })],
            selectedVariantId: "variant-a",
            result: generatedPathResult(),
        });

        assert.equal(ui.canEditPath, true);
        assert.equal(ui.toastMessage, "Auto-generated path saved");
        assert.notEqual(ui.stops[0]?.stop_sequence, undefined);
        assert.equal(ui.stops[0]?.stop_sequence, twoStops[0]?.stop_sequence);
        assert.equal(ui.stops[1]?.stop_sequence, twoStops[1]?.stop_sequence);
    });
});

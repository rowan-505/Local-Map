import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canSubmitTransportStopMerge } from "./reviewMapMergeCompare.js";
import {
    formatTransportStopMergeError,
    formatTransportStopMergeErrorOverlay,
} from "./reviewMapActionFeedback.js";

describe("canSubmitTransportStopMerge", () => {
    it("disables Merge when terminal conflict exists", () => {
        assert.equal(
            canSubmitTransportStopMerge({
                previewLoaded: true,
                previewError: false,
                mergeAllowed: false,
                terminalConflictExists: true,
                sameVariantConflictCount: 0,
                acknowledgedSameVariantOccurrences: false,
            }),
            false,
        );
    });

    it("allows Merge when preview permits and no blockers remain", () => {
        assert.equal(
            canSubmitTransportStopMerge({
                previewLoaded: true,
                previewError: false,
                mergeAllowed: true,
                terminalConflictExists: false,
                sameVariantConflictCount: 0,
                acknowledgedSameVariantOccurrences: false,
            }),
            true,
        );
    });
});

describe("formatTransportStopMergeError terminal conflict", () => {
    it("maps MERGE_TERMINAL_CONFLICT to a specific message, not generic 500 text", () => {
        const message = formatTransportStopMergeError(
            new Error(
                "409 MERGE_TERMINAL_CONFLICT Both stops are linked to active terminals. Resolve the terminal conflict before merging the stops.",
            ),
        );
        assert.match(message, /linked to terminals/i);
        assert.match(message, /resolve the terminal relationship/i);
        assert.equal(message.includes("could not be completed"), false);
    });

    it("includes not-applied note in overlay copy", () => {
        const message = formatTransportStopMergeErrorOverlay(
            new Error("MERGE_TERMINAL_CONFLICT"),
        );
        assert.match(message, /linked to terminals/i);
        assert.match(message, /not applied/i);
    });
});

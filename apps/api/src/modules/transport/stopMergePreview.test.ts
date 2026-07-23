import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildStopMergeConflictAnalysis,
    buildStopMergeFieldComparison,
    buildStopMergeTerminalConflict,
    extractSqlErrorCode,
    isHttpAuthError,
    jsonSafeId,
    jsonSafeNumber,
    MERGE_TERMINAL_CONFLICT_BLOCKER,
    type MergePreviewUsageMembership,
} from "./stopMergePreview.js";

function membership(
    overrides: Partial<MergePreviewUsageMembership> &
        Pick<MergePreviewUsageMembership, "routeStopId" | "stopSequence">,
): MergePreviewUsageMembership {
    return {
        routeId: overrides.routeId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        routeCode: overrides.routeCode ?? "YBS-11",
        routeName: overrides.routeName ?? "YBS 11",
        variantId: overrides.variantId ?? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        variantCode: overrides.variantCode ?? "YBS-11-A",
        directionName: overrides.directionName ?? "outbound",
        routeStopId: overrides.routeStopId,
        stopSequence: overrides.stopSequence,
    };
}

describe("jsonSafeNumber / jsonSafeId", () => {
    it("converts bigint admin_area_id values to JSON-safe numbers", () => {
        const adminAreaId = jsonSafeNumber(5801n);
        assert.equal(adminAreaId, 5801);
        assert.equal(typeof adminAreaId, "number");
        assert.doesNotThrow(() => JSON.stringify({ adminAreaId }));
    });

    it("converts bigint IDs to strings", () => {
        assert.equal(jsonSafeId(1234567890123456789n), "1234567890123456789");
        assert.equal(jsonSafeId(null), null);
    });
});

describe("buildStopMergeFieldComparison bigint safety", () => {
    it("serializes when admin_area_id originated as bigint", () => {
        const comparison = buildStopMergeFieldComparison(
            {
                name: "A",
                name_mm: null,
                name_en: "A",
                stop_type: "stop",
                admin_area_id: jsonSafeNumber(5801n),
                confidence_score: 80,
                review_status: "reviewed",
                is_active: true,
                longitude: 96.15,
                latitude: 16.8,
            },
            {
                name: "B",
                name_mm: null,
                name_en: "B",
                stop_type: "stop",
                admin_area_id: jsonSafeNumber(5801n),
                confidence_score: 70,
                review_status: "needs_review",
                is_active: true,
                longitude: 96.16,
                latitude: 16.81,
            },
            false,
            12.5,
        );

        assert.equal(comparison.admin_area_id.current, 5801);
        assert.doesNotThrow(() => JSON.stringify(comparison));
    });
});

describe("buildStopMergeConflictAnalysis", () => {
    it("handles two unused stops", () => {
        const analysis = buildStopMergeConflictAnalysis([], []);
        assert.deepEqual(analysis.affectedRoutes, []);
        assert.deepEqual(analysis.affectedVariants, []);
        assert.deepEqual(analysis.duplicateMembershipConflicts, []);
        assert.deepEqual(analysis.sequenceConflicts, []);
        assert.equal(analysis.mergeAllowed, true);
        assert.deepEqual(analysis.mergeBlockers, []);
    });

    it("handles one stop used by one route", () => {
        const analysis = buildStopMergeConflictAnalysis(
            [
                membership({
                    routeStopId: "rs-1",
                    stopSequence: 3,
                }),
            ],
            [],
        );

        assert.equal(analysis.affectedRoutes.length, 1);
        assert.equal(analysis.affectedRoutes[0]?.routeCode, "YBS-11");
        assert.equal(analysis.affectedVariants.length, 1);
        assert.equal(analysis.duplicateMembershipConflicts.length, 0);
        assert.equal(analysis.mergeAllowed, true);
    });

    it("handles a shared stop used by many routes", () => {
        const current = [
            membership({
                routeId: "r1",
                routeCode: "YBS-11",
                variantId: "v1",
                variantCode: "YBS-11-A",
                routeStopId: "rs-a",
                stopSequence: 10,
            }),
            membership({
                routeId: "r2",
                routeCode: "YBS-34",
                variantId: "v2",
                variantCode: "YBS-34-A",
                routeStopId: "rs-b",
                stopSequence: 20,
            }),
            membership({
                routeId: "r3",
                routeCode: "YBS-21",
                variantId: "v3",
                variantCode: "YBS-21-A",
                routeStopId: "rs-c",
                stopSequence: 5,
            }),
        ];
        const analysis = buildStopMergeConflictAnalysis(current, []);
        assert.equal(analysis.affectedRoutes.length, 3);
        assert.equal(analysis.affectedVariants.length, 3);
        assert.equal(analysis.mergeAllowed, true);
    });

    it("reports duplicate membership when both stops are in the same variant", () => {
        const analysis = buildStopMergeConflictAnalysis(
            [
                membership({
                    routeStopId: "rs-cur",
                    stopSequence: 4,
                }),
            ],
            [
                membership({
                    routeStopId: "rs-cand",
                    stopSequence: 9,
                }),
            ],
        );

        assert.equal(analysis.duplicateMembershipConflicts.length, 1);
        assert.equal(analysis.sequenceConflicts.length, 0);
        assert.equal(analysis.mergeAllowed, true);
        assert.equal(analysis.duplicateMembershipConflicts[0]?.currentSequence, 4);
        assert.equal(analysis.duplicateMembershipConflicts[0]?.candidateSequence, 9);
    });

    it("scales to a YBS-11-sized variant without assuming a single pair", () => {
        const variantId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        const current: MergePreviewUsageMembership[] = [];
        const candidate: MergePreviewUsageMembership[] = [];

        for (let sequence = 1; sequence <= 52; sequence++) {
            current.push(
                membership({
                    variantId,
                    variantCode: "YBS-11-A",
                    routeStopId: `cur-${sequence}`,
                    stopSequence: sequence === 10 ? 10 : sequence + 100,
                }),
            );
        }
        // Only one real current membership in the shared variant for this stop.
        const currentOnly = [
            membership({
                variantId,
                variantCode: "YBS-11-A",
                routeStopId: "cur-10",
                stopSequence: 10,
            }),
        ];
        candidate.push(
            membership({
                variantId,
                variantCode: "YBS-11-A",
                routeStopId: "cand-40",
                stopSequence: 40,
            }),
        );

        const analysis = buildStopMergeConflictAnalysis(currentOnly, candidate);
        assert.equal(analysis.affectedVariants.length, 1);
        assert.equal(analysis.duplicateMembershipConflicts.length, 1);
        assert.equal(analysis.mergeAllowed, true);
        assert.doesNotThrow(() => JSON.stringify(analysis));
        void current;
    });

    it("marks same-sequence pairs as hard duplicate constraint / sequence conflicts", () => {
        const analysis = buildStopMergeConflictAnalysis(
            [
                membership({
                    routeStopId: "rs-cur",
                    stopSequence: 7,
                }),
            ],
            [
                membership({
                    routeStopId: "rs-cand",
                    stopSequence: 7,
                }),
            ],
        );

        assert.equal(analysis.duplicateMembershipConflicts.length, 0);
        assert.equal(analysis.sequenceConflicts.length, 1);
        assert.equal(analysis.mergeAllowed, false);
        assert.deepEqual(analysis.mergeBlockers, ["sequence_conflict"]);
    });
});

describe("auth error status handling", () => {
    it("detects expired authentication errors as 401 (not 500)", () => {
        const expired = Object.assign(new Error("Authorization token expired"), {
            statusCode: 401 as const,
        });
        assert.equal(isHttpAuthError(expired), true);
        assert.equal(isHttpAuthError(new Error("boom")), false);
        assert.equal(isHttpAuthError({ statusCode: 500 }), false);
    });
});

describe("extractSqlErrorCode", () => {
    it("reads SQLSTATE from Prisma meta and messages", () => {
        assert.equal(extractSqlErrorCode({ meta: { code: "23505" } }), "23505");
        assert.equal(
            extractSqlErrorCode(new Error("unique constraint violation 23505 detail")),
            "23505",
        );
        assert.equal(extractSqlErrorCode(new Error("no code here")), null);
    });
});

describe("buildStopMergeFieldComparison", () => {
    const base = {
        name: "Stop A",
        name_mm: "မှတ်",
        name_en: "Stop A",
        stop_type: "station",
        admin_area_id: 1,
        confidence_score: 80,
        review_status: "reviewed",
        is_active: true,
        longitude: 96.15,
        latitude: 16.8,
    };

    it("marks differing scalar fields as not same", () => {
        const comparison = buildStopMergeFieldComparison(
            base,
            {
                ...base,
                name: "Stop B",
                review_status: "needs_review",
            },
            false,
            12.5,
        );

        assert.equal(comparison.name.same, false);
        assert.equal(comparison.review_status.same, false);
        assert.equal(comparison.geom.same, false);
        assert.equal(comparison.geom.distanceMeters, 12.5);
    });

    it("marks identical fields as same", () => {
        const comparison = buildStopMergeFieldComparison(base, base, true, 0);
        assert.equal(comparison.name.same, true);
        assert.equal(comparison.geom.same, true);
        assert.equal(comparison.geom.distanceMeters, 0);
    });
});

describe("buildStopMergeTerminalConflict", () => {
    it("reports exists=true when both stops have active terminals", () => {
        const conflict = buildStopMergeTerminalConflict(1n, 2n, [
            {
                id: 10n,
                public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                linked_stop_id: 1n,
                name: "Canonical terminal",
            },
            {
                id: 20n,
                public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                linked_stop_id: 2n,
                name: "Duplicate terminal",
            },
        ]);

        assert.equal(conflict.exists, true);
        assert.equal(conflict.canonicalTerminal?.id, "10");
        assert.equal(conflict.duplicateTerminal?.id, "20");
        assert.equal(conflict.canonicalTerminal?.publicId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        assert.doesNotThrow(() => JSON.stringify(conflict));
        assert.equal(MERGE_TERMINAL_CONFLICT_BLOCKER, "MERGE_TERMINAL_CONFLICT");
    });

    it("reports exists=false when only one stop has a terminal", () => {
        const conflict = buildStopMergeTerminalConflict(1n, 2n, [
            {
                id: 20n,
                public_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                linked_stop_id: 2n,
                name: "Duplicate terminal",
            },
        ]);
        assert.equal(conflict.exists, false);
        assert.equal(conflict.canonicalTerminal, null);
        assert.equal(conflict.duplicateTerminal?.id, "20");
    });
});

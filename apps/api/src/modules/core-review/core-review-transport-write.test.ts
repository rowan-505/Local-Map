import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
    getCoreReviewPatchSchema,
    sanitizeCoreReviewWriteBody,
} from "./core-review-write.schema.js";
import {
    appendTransportVerificationAndConfidenceSets,
    pickTransportConfidenceScore,
    resolveTransportVerification,
} from "./core-review-transport-verification.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function readModuleFile(name: string): string {
    return readFileSync(join(moduleDir, name), "utf8");
}

const sampleLine = {
    type: "LineString",
    coordinates: [
        [96.15, 16.78],
        [96.16, 16.79],
    ],
};

const samplePoint = {
    type: "Point",
    coordinates: [96.15, 16.78],
};

describe("core-review transport write schemas", () => {
    it("accepts valid bus route patch payloads", () => {
        const parsed = getCoreReviewPatchSchema("bus-routes").parse({
            route_code: "YBS-12",
            public_name: "Line 12",
            mode_type: "local_bus",
            operator_id: "1",
            is_active: true,
            verification_status: "verified",
            confidence_score: 85,
        }) as Record<string, unknown>;
        assert.equal(parsed.route_code, "YBS-12");
        assert.equal(parsed.mode_type, "local_bus");
        assert.equal(parsed.confidence_score, 85);
    });

    it("rejects bus route confidence_score outside 0-100", () => {
        assert.throws(() =>
            getCoreReviewPatchSchema("bus-routes").parse({
                confidence_score: 101,
            }),
        );
    });

    it("accepts valid bus stop patch payloads", () => {
        const parsed = getCoreReviewPatchSchema("bus-stops").parse({
            stop_code: "S-001",
            name: "Main Gate",
            name_local: "မင်းလမ်း",
            admin_area_id: "42",
            is_active: true,
            verification_status: "needs_fix",
            confidence_score: 40,
            geometry: samplePoint,
        }) as Record<string, unknown>;
        assert.equal(parsed.stop_code, "S-001");
        assert.equal(parsed.verification_status, "needs_fix");
    });

    it("accepts valid bus route variant patch payloads", () => {
        const parsed = getCoreReviewPatchSchema("bus-route-variants").parse({
            variant_code: "inbound",
            direction_name: "Inbound",
            origin_name: "Downtown",
            destination_name: "Airport",
            distance_m: 12500,
            is_active: true,
            verification_status: "verified",
            confidence_score: 90,
            geometry: sampleLine,
        }) as Record<string, unknown>;
        assert.equal(parsed.variant_code, "inbound");
        assert.equal(parsed.distance_m, 12500);
    });

    it("blocks client attempts to overwrite source_refs and normalized_data", () => {
        const sanitized = sanitizeCoreReviewWriteBody({
            public_name: "Updated",
            source_refs: { hacked: true },
            normalized_data: { hacked: true },
        }) as Record<string, unknown>;
        assert.equal(sanitized.public_name, "Updated");
        assert.equal(sanitized.source_refs, undefined);
        assert.equal(sanitized.normalized_data, undefined);
    });
});

describe("resolveTransportVerification", () => {
    const boolOr = (value: unknown, fallback: boolean) =>
        typeof value === "boolean" ? value : fallback;

    it("prefers verification_status over is_verified", () => {
        const result = resolveTransportVerification(
            { verification_status: "needs_fix", is_verified: true },
            boolOr,
        );
        assert.equal(result.verificationStatus, "needs_fix");
        assert.equal(result.isVerified, false);
    });

    it("defaults to unverified when verification_status is omitted on create", () => {
        const result = resolveTransportVerification({}, boolOr);
        assert.equal(result.verificationStatus, "unverified");
        assert.equal(result.isVerified, false);
    });
});

describe("pickTransportConfidenceScore", () => {
    it("returns undefined when confidence is omitted", () => {
        assert.equal(pickTransportConfidenceScore({}), undefined);
    });

    it("treats explicit null confidence as omitted", () => {
        assert.equal(pickTransportConfidenceScore({ confidence_score: null }), undefined);
    });
});

describe("core-review transport write repo SQL", () => {
    const writeRepo = readModuleFile("core-review-entities-write.repo.ts");
    const genericWrite = readModuleFile("core-review-generic-write.service.ts");

    it("updates core_transport tables and sets updated_at on patch", () => {
        for (const method of ["updateBusStop", "updateBusRoute", "updateBusRouteVariant"]) {
            const start = writeRepo.indexOf(`async ${method}`);
            assert.ok(start >= 0, `${method} should exist`);
            const block = writeRepo.slice(start, start + 2500);
            assert.match(block, /updated_at = NOW\(\)/);
            assert.doesNotMatch(block, /source_refs\s*=/);
            assert.doesNotMatch(block, /normalized_data\s*=/);
        }
    });

    it("recalculates variant distance_m from geometry when distance is omitted", () => {
        assert.match(writeRepo, /lineDistanceMExpr/);
        assert.match(writeRepo, /distance_m = \$\{lineDistanceMExpr/);
    });

    it("returns refreshed detail rows after transport updates", () => {
        assert.match(genericWrite, /getBusStopByPublicId/);
        assert.match(genericWrite, /getBusRouteById/);
        assert.match(genericWrite, /getBusRouteVariantById/);
        assert.match(genericWrite, /buildDetailResponse\(serializeGenericCoreRow/);
    });
});

describe("appendTransportVerificationAndConfidenceSets", () => {
    it("appends verification and confidence SET clauses", () => {
        const sets: import("@prisma/client").Prisma.Sql[] = [];
        appendTransportVerificationAndConfidenceSets(
            sets,
            {
                verification_status: "questionable",
                confidence_score: 55,
            },
            (value, fallback) => (typeof value === "boolean" ? value : fallback),
        );
        assert.equal(sets.length, 3);
    });
});

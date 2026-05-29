import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { appendCoreReviewVerificationSets } from "./core-review-verification-write.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function readModuleFile(name: string): string {
    return readFileSync(join(moduleDir, name), "utf8");
}

describe("core-review transport cutover to core_transport", () => {
    const readRepo = readModuleFile("core-review-entities.repo.ts");
    const writeRepo = readModuleFile("core-review-entities-write.repo.ts");
    const lifecycleConfig = readModuleFile("core-review-lifecycle.config.ts");
    const refValidation = readFileSync(
        join(moduleDir, "../../lib/core-review/ref-validation.ts"),
        "utf8",
    );

    const activeTransportSources = [readRepo, writeRepo, lifecycleConfig, refValidation];

    it("does not query legacy core.core_bus_* tables in active core-review transport modules", () => {
        for (const source of activeTransportSources) {
            assert.doesNotMatch(source, /core\.core_bus_/);
        }
    });

    it("core-review bus routes repo does not query core.core_bus_routes", () => {
        for (const source of activeTransportSources) {
            assert.doesNotMatch(source, /core\.core_bus_routes/);
        }
        assert.match(readRepo, /core_transport\.routes/);
        assert.match(writeRepo, /core_transport\.routes/);
    });

    it("core-review bus stops repo does not query core.core_bus_stops", () => {
        for (const source of activeTransportSources) {
            assert.doesNotMatch(source, /core\.core_bus_stops/);
        }
        assert.match(readRepo, /core_transport\.stops/);
        assert.match(writeRepo, /core_transport\.stops/);
    });

    it("core-review bus route variants repo does not query core.core_bus_route_variants", () => {
        for (const source of activeTransportSources) {
            assert.doesNotMatch(source, /core\.core_bus_route_variants/);
        }
        assert.match(readRepo, /core_transport\.route_variants/);
        assert.match(writeRepo, /core_transport\.route_variants/);
    });

    it("reads bus stops from core_transport.stops and stop_names", () => {
        assert.match(readRepo, /FROM core_transport\.stops AS bs/);
        assert.match(readRepo, /FROM core_transport\.stop_names AS n/);
    });

    it("reads bus routes from core_transport.routes with operators join", () => {
        assert.match(readRepo, /FROM core_transport\.routes AS br/);
        assert.match(readRepo, /INNER JOIN core_transport\.operators AS op/);
        assert.match(readRepo, /FROM core_transport\.route_names AS n/);
    });

    it("reads bus route variants from core_transport.route_variants", () => {
        assert.match(readRepo, /FROM core_transport\.route_variants AS v/);
        assert.match(readRepo, /FROM core_transport\.route_stops AS rs/);
        assert.match(readRepo, /FROM core_transport\.route_paths AS rp/);
    });

    it("writes bus entities to core_transport tables", () => {
        assert.match(writeRepo, /INSERT INTO core_transport\.stops/);
        assert.match(writeRepo, /UPDATE core_transport\.stops SET/);
        assert.match(writeRepo, /INSERT INTO core_transport\.routes/);
        assert.match(writeRepo, /UPDATE core_transport\.routes SET/);
        assert.match(writeRepo, /INSERT INTO core_transport\.route_variants/);
        assert.match(writeRepo, /UPDATE core_transport\.route_variants SET/);
    });

    it("maps lifecycle soft-delete tables to core_transport", () => {
        assert.match(lifecycleConfig, /table: "core_transport\.stops"/);
        assert.match(lifecycleConfig, /table: "core_transport\.routes"/);
        assert.match(lifecycleConfig, /table: "core_transport\.route_variants"/);
    });

    it("validates route_id against core_transport.routes", () => {
        assert.match(refValidation, /FROM core_transport\.routes/);
    });
});

describe("appendCoreReviewVerificationSets for transport", () => {
    it("returns paired is_verified and verification_status updates", () => {
        const verifiedSets: import("@prisma/client").Prisma.Sql[] = [];
        appendCoreReviewVerificationSets(verifiedSets, { verification_status: "verified" });
        assert.equal(verifiedSets.length, 2);

        const unverifiedSets: import("@prisma/client").Prisma.Sql[] = [];
        appendCoreReviewVerificationSets(unverifiedSets, { verification_status: "unverified" });
        assert.equal(unverifiedSets.length, 2);
    });
});

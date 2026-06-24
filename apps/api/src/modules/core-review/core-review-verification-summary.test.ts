import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS } from "./core-review-verification-summary.config.js";
import { VERIFICATION_SUMMARY_STATUSES } from "../../lib/verification-summary/verification-summary.types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

describe("core-review verification summary", () => {
    const routesSource = readFileSync(join(moduleDir, "core-review.routes.ts"), "utf8");
    const compatSource = readFileSync(
        join(moduleDir, "../core-verification-compat/core-verification-compat.routes.ts"),
        "utf8"
    );

    it("registers GET /verification-summary before /:entity", () => {
        const summaryIndex = routesSource.indexOf('"/verification-summary"');
        const entityIndex = routesSource.indexOf('"/:entity"');
        assert.ok(summaryIndex >= 0);
        assert.ok(entityIndex > summaryIndex);
    });

    it("includes core schema overview families", () => {
        const families = CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS.map((item) => item.family);
        assert.ok(families.includes("addresses"));
    });

    it("does not use isVerifiedOnly summary mode for addresses", () => {
        const addresses = CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS.find((item) => item.family === "addresses");
        assert.ok(addresses);
        assert.equal("isVerifiedOnly" in addresses!, false);
    });

    it("exposes standard verification status keys", () => {
        assert.deepEqual([...VERIFICATION_SUMMARY_STATUSES], [
            "unverified",
            "verified",
            "needs_fix",
            "questionable",
            "rejected_after_core_review",
        ]);
    });

    it("keeps deprecated /api/core-verification/summary compatibility with successor headers", () => {
        assert.match(compatSource, /Deprecation/);
        assert.match(compatSource, /\/core-review\/verification-summary/);
        assert.match(compatSource, /CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS/);
    });

    it("returns 410 for other retired core-verification routes", () => {
        assert.match(compatSource, /410/);
        assert.match(compatSource, /core-verification API is retired/);
    });
});

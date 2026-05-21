import assert from "node:assert/strict";

import {
    applyVerificationDefaults,
    buildCoreVerificationDefaults,
    buildVerificationMetadataTracking,
    isCoreRowAlreadyVerified,
    normalizeCoreVerificationColumns,
} from "./import-review-promotion-core-verification.js";

function runTests(): void {
    assert.deepEqual(
        buildCoreVerificationDefaults(["is_verified", "verification_status", "unknown_col"]),
        {
            is_verified: false,
            verification_status: "unverified",
        }
    );

    assert.equal(
        isCoreRowAlreadyVerified(
            { is_verified: false, verification_status: "verified" },
            ["is_verified", "verification_status"]
        ),
        true
    );

    assert.equal(
        isCoreRowAlreadyVerified(
            { is_verified: false, verification_status: "unverified", verified_at: null },
            ["is_verified", "verification_status", "verified_at"]
        ),
        false
    );

    const updateUnverified = applyVerificationDefaults(
        { is_verified: false, verification_status: "unverified" },
        ["is_verified", "verification_status", "verified_at"]
    );
    assert.equal(updateUnverified.skipped_already_verified, false);
    assert.deepEqual(updateUnverified.values, {
        is_verified: false,
        verification_status: "unverified",
        verified_at: null,
    });

    const updateVerified = applyVerificationDefaults(
        { is_verified: true, verification_status: "verified", verified_at: "2026-01-01T00:00:00Z" },
        ["is_verified", "verification_status", "verified_at"]
    );
    assert.equal(updateVerified.skipped_already_verified, true);

    assert.deepEqual(
        buildVerificationMetadataTracking({
            outcome: "inserted",
            beforeData: null,
            entityKey: "buildings",
        }),
        {
            verification_metadata_applied: true,
            verification_metadata_skipped_already_verified: false,
        }
    );

    assert.deepEqual(
        buildVerificationMetadataTracking({
            outcome: "updated",
            beforeData: { is_verified: true, verification_status: "verified" },
            entityKey: "places",
        }),
        {
            verification_metadata_applied: false,
            verification_metadata_skipped_already_verified: true,
        }
    );

    assert.deepEqual(normalizeCoreVerificationColumns([]), []);

    console.log("import-review-promotion-core-verification tests passed");
}

runTests();

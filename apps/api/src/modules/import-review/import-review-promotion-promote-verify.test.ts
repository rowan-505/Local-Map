import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repoPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "import-review-promotion-promote.repo.ts"
);

describe("verifyCoreRows promotion scope", () => {
    it("only counts publish_status success rows, not pending blocked items", () => {
        const source = readFileSync(repoPath, "utf8");
        const verifyStart = source.indexOf("async verifyCoreRows(");
        assert.ok(verifyStart >= 0);
        const verifyEnd = source.indexOf("async getBatchVerify(", verifyStart);
        assert.ok(verifyEnd > verifyStart);
        const verifyBlock = source.slice(verifyStart, verifyEnd);
        assert.match(verifyBlock, /publish_status = 'success'/);
        assert.doesNotMatch(verifyBlock, /validation_result->>'status' = 'blocked'/);
    });
});

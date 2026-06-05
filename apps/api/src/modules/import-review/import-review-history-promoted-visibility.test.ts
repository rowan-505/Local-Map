import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const dir = dirname(fileURLToPath(import.meta.url));

describe("import-review history publish batch items", () => {
    it("does not apply default include_promoted candidate list exclusion", () => {
        const src = readFileSync(join(dir, "import-review-history.repo.ts"), "utf8");
        const listFn = src.slice(
            src.indexOf("async listPublishBatchItems"),
            src.indexOf("async listPublishBatchItems") + 1200
        );
        assert.doesNotMatch(listFn, /IS DISTINCT FROM 'promoted'/i);
        assert.doesNotMatch(listFn, /include_promoted/i);
    });
});

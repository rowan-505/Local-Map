import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const TRANSPORT_ROOT = join(process.cwd(), "src/features/import-transport");
const TRANSPORT_APP_ROOT = join(process.cwd(), "src/app/(admin)/dashboard/import-transport");

const FORBIDDEN_PATTERNS = [
    /\/api\/import-review/,
    /getImportReviewSummary/,
    /useImportReviewBatchContext/,
    /useImportReviewSummary/,
    /ImportReviewBatchScopeBar/,
    /ImportReviewBatchPicker/,
    /from "@\/src\/features\/import-review/,
    /from '@\/src\/features\/import-review/,
    /import-review\/_components/,
];

function collectFiles(dir: string): string[] {
    const entries = readdirSync(dir);
    const files: string[] = [];
    for (const entry of entries) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            files.push(...collectFiles(full));
            continue;
        }
        if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
            files.push(full);
        }
    }
    return files;
}

describe("import-transport isolation from import-review API", () => {
    it("does not reference import-review hooks, components, or API paths", () => {
        const files = [...collectFiles(TRANSPORT_ROOT), ...collectFiles(TRANSPORT_APP_ROOT)];
        const violations: string[] = [];

        for (const file of files) {
            const content = readFileSync(file, "utf8");
            for (const pattern of FORBIDDEN_PATTERNS) {
                if (pattern.test(content)) {
                    violations.push(`${file}: ${pattern}`);
                }
            }
        }

        assert.equal(
            violations.length,
            0,
            `import-transport must not use import-review API or hooks:\n${violations.join("\n")}`
        );
    });

    it("uses import-transport API prefix in api client", () => {
        const client = readFileSync(
            join(TRANSPORT_ROOT, "api/importTransportApiClient.ts"),
            "utf8"
        );
        assert.match(client, /const API_PREFIX = "\/api\/import-transport"/);
        assert.doesNotMatch(client, /\/api\/import-review/);
    });
});

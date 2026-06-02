#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();

const roadsPagePath = path.join(
    repoRoot,
    "apps/dashboard/src/app/(admin)/dashboard/import-review/roads/page.tsx"
);
const landusePagePath = path.join(
    repoRoot,
    "apps/dashboard/src/app/(admin)/dashboard/import-review/landuse/page.tsx"
);
const entityRegistryPath = path.join(
    repoRoot,
    "apps/dashboard/src/features/import-review/config/importReviewEntityConfigs.ts"
);

function readUtf8(filePath) {
    return fs.readFileSync(filePath, "utf8");
}

function has(text, fragment) {
    return text.includes(fragment);
}

function fail(message) {
    return { ok: false, message };
}

function pass(message) {
    return { ok: true, message };
}

const checks = [];

try {
    const roadsPage = readUtf8(roadsPagePath);
    const landusePage = readUtf8(landusePagePath);
    const registry = readUtf8(entityRegistryPath);

    checks.push(
        has(roadsPage, 'import { createImportReviewEntityRoutePage }')
            ? pass("roads page imports createImportReviewEntityRoutePage")
            : fail("roads page does not import createImportReviewEntityRoutePage")
    );

    checks.push(
        has(landusePage, 'import { createImportReviewEntityRoutePage }')
            ? pass("landuse page imports createImportReviewEntityRoutePage")
            : fail("landuse page does not import createImportReviewEntityRoutePage")
    );

    checks.push(
        has(roadsPage, 'createImportReviewEntityRoutePage("roads"')
            ? pass("roads page uses createImportReviewEntityRoutePage('roads')")
            : fail("roads page is not using createImportReviewEntityRoutePage('roads')")
    );

    checks.push(
        !has(roadsPage, "ImportReviewRoadOverridesPanel")
            ? pass("roads page does not import ImportReviewRoadOverridesPanel")
            : fail("roads page still imports ImportReviewRoadOverridesPanel")
    );

    checks.push(
        !has(roadsPage, "importReviewRoadOverridesPayload")
            ? pass("roads page does not import importReviewRoadOverridesPayload")
            : fail("roads page still imports importReviewRoadOverridesPayload")
    );

    checks.push(
        !has(roadsPage, "ImportReviewCandidatesClient")
            ? pass("roads page does not import legacy ImportReviewCandidatesClient")
            : fail("roads page still imports legacy ImportReviewCandidatesClient")
    );

    checks.push(
        has(registry, "roadsImportReviewEntityConfig")
            ? pass("roads config exists in import review entity registry")
            : fail("roads config missing from import review entity registry")
    );
} catch (error) {
    console.error("[route-consistency] Fatal error:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
}

const failures = checks.filter((c) => !c.ok);
for (const c of checks) {
    const prefix = c.ok ? "PASS" : "FAIL";
    console.log(`[route-consistency] ${prefix}: ${c.message}`);
}

if (failures.length > 0) {
    console.error(`\n[route-consistency] ${failures.length} check(s) failed.`);
    process.exit(1);
}

console.log("\n[route-consistency] All checks passed.");

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const DASHBOARD_ROOT = process.cwd();
const ENTITY_CONFIGS_PATH = join(
    DASHBOARD_ROOT,
    "src/features/core-review/config/entity-configs.tsx"
);
const CORE_REVIEW_TRANSPORT_SCAN_ROOTS = [
    join(DASHBOARD_ROOT, "src/features/core-review/transport"),
    join(DASHBOARD_ROOT, "src/app/(admin)/dashboard/core-review/bus-stops"),
    join(DASHBOARD_ROOT, "src/app/(admin)/dashboard/core-review/bus-routes"),
    join(DASHBOARD_ROOT, "src/app/(admin)/dashboard/core-review/bus-route-variants"),
];

function collectActiveSourceFiles(dir: string): string[] {
    const entries = readdirSync(dir);
    const files: string[] = [];
    for (const entry of entries) {
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
            files.push(...collectActiveSourceFiles(full));
            continue;
        }
        if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
            files.push(full);
        }
    }
    return files;
}

describe("core-review transport dashboard regression", () => {
    it("labels bus routes, stops, and variants with core_transport data source", () => {
        const entityConfigs = readFileSync(ENTITY_CONFIGS_PATH, "utf8");

        for (const exportName of [
            "CORE_REVIEW_BUS_STOPS_CONFIG",
            "CORE_REVIEW_BUS_ROUTES_CONFIG",
            "CORE_REVIEW_BUS_ROUTE_VARIANTS_CONFIG",
        ]) {
            const block = entityConfigs.match(
                new RegExp(`export const ${exportName}[\\s\\S]*?(?=\\nexport const |\\nexport function |$)`)
            )?.[0];
            assert.ok(block, `${exportName} must exist in entity-configs.tsx`);
            assert.match(
                block,
                /dataSource:\s*CORE_REVIEW_TRANSPORT_DATA_SOURCE/,
                `${exportName} must set dataSource to core_transport`
            );
        }
    });

    it("active core-review transport dashboard sources do not reference core.core_bus_*", () => {
        const violations: string[] = [];
        const files = CORE_REVIEW_TRANSPORT_SCAN_ROOTS.flatMap((root) => collectActiveSourceFiles(root));

        for (const file of files) {
            const content = readFileSync(file, "utf8");
            if (/core\.core_bus_/.test(content)) {
                violations.push(file);
            }
        }

        const entityConfigs = readFileSync(ENTITY_CONFIGS_PATH, "utf8");
        if (/core\.core_bus_/.test(entityConfigs)) {
            violations.push(ENTITY_CONFIGS_PATH);
        }

        assert.equal(
            violations.length,
            0,
            `core-review transport UI must not reference legacy core.core_bus_* tables:\n${violations.join("\n")}`
        );
    });
});

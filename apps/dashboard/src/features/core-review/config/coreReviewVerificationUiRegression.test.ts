import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const DASHBOARD_ROOT = process.cwd();
const ENTITY_CONFIGS_DIR = join(DASHBOARD_ROOT, "src/lib/core-review/entityConfigs");
const ENTITY_CONFIGS_LIST_PATH = join(
    DASHBOARD_ROOT,
    "src/features/core-review/config/entity-configs.tsx"
);
const SHARED_CONFIG_PATH = join(ENTITY_CONFIGS_DIR, "shared.ts");

const EDIT_CONFIG_EXPORTS = [
    { file: "buildings.ts", exportName: "BUILDINGS_ENTITY_CONFIG" },
    { file: "places.ts", exportName: "PLACES_ENTITY_CONFIG" },
    { file: "streets.ts", exportName: "STREETS_ENTITY_CONFIG" },
    { file: "land-areas.ts", exportName: "LAND_AREAS_ENTITY_CONFIG" },
    { file: "extendedEntities.tsx", exportName: "WATER_LINES_ENTITY_CONFIG" },
    { file: "extendedEntities.tsx", exportName: "WATER_POLYGONS_ENTITY_CONFIG" },
    { file: "extendedEntities.tsx", exportName: "ADDRESSES_ENTITY_CONFIG" },
    { file: "extendedEntities.tsx", exportName: "ADMIN_AREAS_ENTITY_CONFIG" },
] as const;

const LIST_CONFIG_EXPORTS = [
    "CORE_REVIEW_BUILDINGS_CONFIG",
    "CORE_REVIEW_PLACES_CONFIG",
    "CORE_REVIEW_STREETS_CONFIG",
    "CORE_REVIEW_LAND_AREAS_CONFIG",
    "CORE_REVIEW_WATER_LINES_CONFIG",
    "CORE_REVIEW_WATER_POLYGONS_CONFIG",
    "CORE_REVIEW_ADDRESSES_CONFIG",
    "CORE_REVIEW_ADMIN_AREAS_CONFIG",
] as const;

function extractExportBlock(source: string, exportName: string): string {
    return (
        source.match(
            new RegExp(`export const ${exportName}[\\s\\S]*?(?=\\nexport const |\\nexport function |$)`)
        )?.[0] ?? ""
    );
}

function stripLineComments(source: string): string {
    return source.replace(/^\s*\/\/.*$/gm, "");
}

describe("core-review verification UI regression", () => {
    it("edit configs do not expose editable is_verified boolean fields", () => {
        const scannedFiles = new Set(EDIT_CONFIG_EXPORTS.map((item) => item.file));
        for (const file of scannedFiles) {
            const content = stripLineComments(readFileSync(join(ENTITY_CONFIGS_DIR, file), "utf8"));
            assert.doesNotMatch(
                content,
                /editableFields:\s*\[[\s\S]*?\bkey:\s*["']is_verified["']/,
                `${file} must not expose editable is_verified`
            );
            assert.doesNotMatch(
                content,
                /editableFields:\s*\[[\s\S]*?\bkey:\s*["']isVerified["']/,
                `${file} must not expose editable isVerified`
            );
        }
    });

    it("edit configs expose verification_status dropdown", () => {
        const shared = readFileSync(SHARED_CONFIG_PATH, "utf8");
        assert.match(
            shared,
            /key:\s*["']verification_status["'][\s\S]*?type:\s*["']select["']/,
            "verification_status form field must be a select dropdown"
        );

        const extendedEntities = readFileSync(join(ENTITY_CONFIGS_DIR, "extendedEntities.tsx"), "utf8");
        assert.match(
            extendedEntities,
            /function createMapFeatureConfig[\s\S]*verificationStatusFormField\(\)/,
            "shared map-feature edit config must include verification_status dropdown"
        );

        for (const { file, exportName } of EDIT_CONFIG_EXPORTS) {
            const source = readFileSync(join(ENTITY_CONFIGS_DIR, file), "utf8");
            const block = extractExportBlock(source, exportName);
            assert.ok(block, `${exportName} must exist`);
            assert.match(
                block,
                /verificationStatusFormField\(\)|createMapFeatureConfig/,
                `${exportName} must expose verification_status dropdown`
            );
        }
    });

    it("detail drawer fields do not use legacy Verified boolean badges", () => {
        const entityConfigs = readFileSync(ENTITY_CONFIGS_LIST_PATH, "utf8");
        assert.doesNotMatch(
            entityConfigs,
            /VerifiedBadge/,
            "entity-configs must not render VerifiedBadge in drawer/detail fields"
        );
        assert.doesNotMatch(
            entityConfigs,
            /label:\s*["']Verified["']/,
            "entity-configs must not label detail fields as Verified"
        );
    });

    it("list configs include verification status column for every entity family", () => {
        const entityConfigs = readFileSync(ENTITY_CONFIGS_LIST_PATH, "utf8");
        assert.match(
            entityConfigs,
            /function genericClassColumns[\s\S]*standardNameAndVerificationColumns/,
            "genericClassColumns must include verification status column"
        );

        for (const exportName of LIST_CONFIG_EXPORTS) {
            const block = extractExportBlock(entityConfigs, exportName);
            assert.ok(block, `${exportName} must exist in entity-configs.tsx`);
            assert.match(
                block,
                /standardNameAndVerificationColumns|id:\s*["']verification["']|TransportVerificationStatusCell|genericClassColumns/,
                `${exportName} must expose a verification status table column`
            );
            assert.doesNotMatch(
                block,
                /columns:\s*\[[\s\S]*?header:\s*["']Verified["']/,
                `${exportName} must not use legacy Verified table column header`
            );
        }
    });
});

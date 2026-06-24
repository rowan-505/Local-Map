#!/usr/bin/env npx tsx
/**
 * Validate GTFS feed directory (skeleton).
 *
 * TODO: run GTFS validator, write gtfs_export.validation_issues.
 * See docs/transport/gtfs-export-plan.md
 */

import fs from "node:fs";
import path from "node:path";

import {
    closePool,
    createPool,
    parseCliFlag,
    requireCliValue,
    verifyDatabaseConnection,
} from "./gtfs-db.js";
import { listPlannedGtfsFiles } from "./gtfs-writers.js";
import type { ValidateGtfsOptions } from "./gtfs-types.js";

const ENABLE_VALIDATION_WRITES = false;

function parseOptions(argv: string[]): ValidateGtfsOptions {
    return {
        inputDir: path.resolve(requireCliValue(parseCliFlag(argv, "input-dir"), "input-dir")),
    };
}

function printPlannedValidationRules(): void {
    const rules = [
        "no_agency (error)",
        "no_stops (error)",
        "route_without_variant (error)",
        "variant_without_stops (error)",
        "missing_frequency (error)",
        "invalid_stop_sequence (error)",
        "missing_geometry (warning)",
        "invalid_time_value (error)",
    ];

    console.log("\nPlanned validation rules (not executed in skeleton):");
    for (const rule of rules) {
        console.log(`  - ${rule}`);
    }
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));

    console.log("validate-gtfs (skeleton)");
    console.log("  inputDir:", options.inputDir);
    console.log("  ENABLE_VALIDATION_WRITES:", ENABLE_VALIDATION_WRITES);

    if (!fs.existsSync(options.inputDir)) {
        throw new Error(`Input directory does not exist: ${options.inputDir}`);
    }

    const entries = fs.readdirSync(options.inputDir);
    console.log("\nDirectory listing:");
    for (const name of entries.sort()) {
        console.log(`  ${name}`);
    }

    console.log("\nExpected GTFS files (production):");
    for (const fileName of listPlannedGtfsFiles()) {
        const fullPath = path.join(options.inputDir, fileName);
        const status = fs.existsSync(fullPath) ? "present" : "missing (expected for now)";
        console.log(`  ${fileName}: ${status}`);
    }

    const skeletonReadme = path.join(options.inputDir, "README-SKELETON.md");
    if (fs.existsSync(skeletonReadme)) {
        console.log("\nDetected skeleton export (README-SKELETON.md). Validator will run after real export.");
    }

    printPlannedValidationRules();

    const pool = createPool();
    try {
        const health = await verifyDatabaseConnection(pool);
        console.log("\nDatabase connection: OK");
        console.log("  database:", health.database);
        console.log("  gtfs_export schema:", health.gtfsExportSchema);

        if (ENABLE_VALIDATION_WRITES) {
            console.warn("\nENABLE_VALIDATION_WRITES is true but validation logic is not implemented yet.");
        } else {
            console.log("\nNo validation_issues written (skeleton).");
        }
    } finally {
        await closePool(pool);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});

#!/usr/bin/env npx tsx
/**
 * YBS import validation (skeleton) — import_transport.validation_issues.
 *
 * TODO: implement rules from docs/transport/ybs-import-plan.md
 */

import {
    closePool,
    createPool,
    findImportBatchByCode,
    parseCliFlag,
    requireCliValue,
    verifyDatabaseConnection,
} from "./transport-import-db.js";
import type { ValidateYbsImportOptions } from "./transport-import-types.js";

const ENABLE_VALIDATION_WRITES = false;

function parseOptions(argv: string[]): ValidateYbsImportOptions {
    return {
        batchCode: requireCliValue(parseCliFlag(argv, "batch-code"), "batch-code"),
    };
}

function printPlannedValidationRules(): void {
    const rules = [
        "missing_route_code (error)",
        "missing_stop_name (warning)",
        "missing_lat_lng (error)",
        "invalid_geometry (error)",
        "duplicate_stop_ids (error)",
        "duplicate_stop_sequence (error)",
        "variant_fewer_than_two_stops (error)",
        "stops_far_from_path (warning)",
        "route_path_missing (warning)",
        "no_service_calendar / no_frequency_for_variant (warning)",
    ];

    console.log("\nPlanned validation rules (not executed in skeleton):");
    for (const rule of rules) {
        console.log(`  - ${rule}`);
    }
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));

    console.log("validate-ybs-import (skeleton)");
    console.log("  batchCode:", options.batchCode);
    console.log("  ENABLE_VALIDATION_WRITES:", ENABLE_VALIDATION_WRITES);

    const pool = createPool();
    try {
        const health = await verifyDatabaseConnection(pool);
        console.log("\nDatabase connection: OK");
        console.log("  database:", health.database);

        if (!health.importTransportSchema) {
            throw new Error("import_transport schema missing. Apply migration 066 first.");
        }

        const batch = await findImportBatchByCode(pool, options.batchCode);
        if (!batch) {
            console.warn(
                `\nNo import_batches row found for batch_code="${options.batchCode}". ` +
                    "Run import-ybs-dataset after it is implemented.",
            );
        } else {
            console.log("\nTarget batch:");
            console.log("  id:", batch.id);
            console.log("  importStatus:", batch.importStatus);
            console.log("  validationStatus:", batch.validationStatus);
        }

        printPlannedValidationRules();

        if (ENABLE_VALIDATION_WRITES) {
            console.warn("\nENABLE_VALIDATION_WRITES is true but validation logic is not implemented yet.");
        } else {
            console.log("\nValidation writes disabled. No validation_issues inserted.");
        }
    } finally {
        await closePool(pool);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});

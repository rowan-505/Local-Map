#!/usr/bin/env npx tsx
/**
 * YBS dataset import (skeleton) — external files → import_transport.
 *
 * TODO: parse routes JSON, stops TSV, route_stops, geometries; insert raw rows.
 * See docs/transport/ybs-import-plan.md
 */

import path from "node:path";

import {
    closePool,
    createPool,
    findImportBatchByCode,
    parseCliFlag,
    requireCliValue,
    verifyDatabaseConnection,
} from "./transport-import-db.js";
import { TRANSPORT_MODES, type ImportYbsDatasetOptions, type TransportMode } from "./transport-import-types.js";

/** When false, no rows are written to import_transport (default). */
const ENABLE_DATA_IMPORT = false;

function parseScope(raw: string | undefined): TransportMode {
    const scope = (raw ?? "local_bus").trim() as TransportMode;
    if (!TRANSPORT_MODES.includes(scope)) {
        throw new Error(
            `Invalid --scope "${scope}". Expected one of: ${TRANSPORT_MODES.join(", ")}`,
        );
    }
    return scope;
}

function parseOptions(argv: string[]): ImportYbsDatasetOptions {
    return {
        sourceCode: requireCliValue(parseCliFlag(argv, "source-code"), "source-code"),
        sourceName: requireCliValue(parseCliFlag(argv, "source-name"), "source-name"),
        inputDir: requireCliValue(parseCliFlag(argv, "input-dir"), "input-dir"),
        batchCode: requireCliValue(parseCliFlag(argv, "batch-code"), "batch-code"),
        scope: parseScope(parseCliFlag(argv, "scope")),
    };
}

function printPlannedSteps(options: ImportYbsDatasetOptions): void {
    const steps = [
        "Upsert import_transport.source_datasets (if missing)",
        `Create import_transport.import_batches (batch_name = ${options.batchCode})`,
        `Read input from ${path.resolve(options.inputDir)}`,
        "Parse routes JSON → raw_routes, raw_route_variants, raw_route_paths",
        "Parse stops TSV/CSV → raw_stops",
        "Parse route_stops → raw_route_stops",
        "Set batch import_status = imported and record_counts summary",
    ];

    console.log("\nPlanned import steps (not executed in skeleton):");
    for (const [index, step] of steps.entries()) {
        console.log(`  ${index + 1}. ${step}`);
    }
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));

    console.log("import-ybs-dataset (skeleton)");
    console.log("  sourceCode:", options.sourceCode);
    console.log("  sourceName:", options.sourceName);
    console.log("  inputDir:", path.resolve(options.inputDir));
    console.log("  batchCode:", options.batchCode);
    console.log("  scope:", options.scope);
    console.log("  ENABLE_DATA_IMPORT:", ENABLE_DATA_IMPORT);

    const pool = createPool();
    try {
        const health = await verifyDatabaseConnection(pool);
        console.log("\nDatabase connection: OK");
        console.log("  database:", health.database);
        console.log("  serverTime:", health.serverTime);
        console.log("  import_transport schema:", health.importTransportSchema);
        console.log("  core_transport schema:", health.coreTransportSchema);

        if (!health.importTransportSchema) {
            throw new Error(
                "import_transport schema missing. Apply migration 066_create_import_transport_schema.sql first.",
            );
        }

        const existing = await findImportBatchByCode(pool, options.batchCode);
        if (existing) {
            console.log("\nExisting batch (read-only lookup):");
            console.log("  id:", existing.id);
            console.log("  importStatus:", existing.importStatus);
            console.log("  validationStatus:", existing.validationStatus);
        } else {
            console.log("\nNo existing import_batches row for batch_code:", options.batchCode);
        }

        printPlannedSteps(options);

        if (ENABLE_DATA_IMPORT) {
            console.warn("\nENABLE_DATA_IMPORT is true but import logic is not implemented yet.");
        } else {
            console.log("\nData import disabled (ENABLE_DATA_IMPORT = false). No rows inserted.");
        }
    } finally {
        await closePool(pool);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});

#!/usr/bin/env npx tsx
/**
 * YBS promotion (skeleton) — import_transport → core_transport.
 *
 * TODO: promotion_batches/items; map raw_* to core_transport.*
 * See docs/transport/ybs-import-plan.md
 */

import {
    closePool,
    createPool,
    findImportBatchByCode,
    parseCliBoolFlag,
    parseCliFlag,
    requireCliValue,
    verifyDatabaseConnection,
} from "./transport-import-db.js";
import type { PromoteYbsToCoreOptions } from "./transport-import-types.js";

const ENABLE_PROMOTION = false;

function parseOptions(argv: string[]): PromoteYbsToCoreOptions {
    return {
        batchCode: requireCliValue(parseCliFlag(argv, "batch-code"), "batch-code"),
        confirmWarnings: parseCliBoolFlag(argv, "confirm-warnings", false),
    };
}

function printPlannedPromotionOrder(): void {
    const order = [
        "operators (link ybs / seed 072)",
        "routes + route_names",
        "stops + stop_names",
        "route_variants + route_paths",
        "route_stops",
        "frequencies (MVP headways)",
        "route_sources (import_transport lineage)",
    ];

    console.log("\nPlanned promotion order (not executed in skeleton):");
    for (const [index, step] of order.entries()) {
        console.log(`  ${index + 1}. ${step}`);
    }
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));

    console.log("promote-ybs-to-core (skeleton)");
    console.log("  batchCode:", options.batchCode);
    console.log("  confirmWarnings:", options.confirmWarnings);
    console.log("  ENABLE_PROMOTION:", ENABLE_PROMOTION);

    if (!options.confirmWarnings) {
        console.log(
            "\nNote: --confirm-warnings not set (default false). " +
                "Future runs with warnings will require --confirm-warnings.",
        );
    }

    const pool = createPool();
    try {
        const health = await verifyDatabaseConnection(pool);
        console.log("\nDatabase connection: OK");
        console.log("  database:", health.database);
        console.log("  core_transport schema:", health.coreTransportSchema);

        if (!health.importTransportSchema) {
            throw new Error("import_transport schema missing. Apply migration 066 first.");
        }
        if (!health.coreTransportSchema) {
            throw new Error("core_transport schema missing. Apply migration 067 first.");
        }

        const batch = await findImportBatchByCode(pool, options.batchCode);
        if (!batch) {
            console.warn(`\nNo import_batches row for batch_code="${options.batchCode}".`);
        } else {
            console.log("\nSource batch:");
            console.log("  id:", batch.id);
            console.log("  importStatus:", batch.importStatus);
            console.log("  validationStatus:", batch.validationStatus);
        }

        printPlannedPromotionOrder();

        if (ENABLE_PROMOTION) {
            console.warn("\nENABLE_PROMOTION is true but promotion logic is not implemented yet.");
        } else {
            console.log("\nPromotion disabled (ENABLE_PROMOTION = false). No core_transport writes.");
        }
    } finally {
        await closePool(pool);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});

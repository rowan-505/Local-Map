#!/usr/bin/env npx tsx
/**
 * Export core_transport → GTFS zip (skeleton).
 *
 * TODO: query scope, write GTFS CSV files, zip, update export_builds.
 * See docs/transport/gtfs-export-plan.md
 */

import fs from "node:fs";
import path from "node:path";

import {
    assertCoreTransportTablesReady,
    checkCoreTransportTables,
    closePool,
    createPool,
    fetchGtfsReadinessSummary,
    findExportBuildByCode,
    insertDraftExportBuild,
    parseCliBoolFlag,
    parseCliFlag,
    requireCliValue,
    verifyDatabaseConnection,
} from "./gtfs-db.js";
import { writeSkeletonOutput } from "./gtfs-writers.js";
import type { ExportGtfsOptions, ScheduleMode } from "./gtfs-types.js";

const ENABLE_GTFS_EXPORT = false;

function defaultBuildCode(scope: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const safeScope = scope.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    return `${safeScope}_gtfs_${date}`;
}

function parseScheduleMode(raw: string | undefined): ScheduleMode {
    const mode = (raw ?? "hybrid").trim() as ScheduleMode;
    if (mode !== "frequencies" && mode !== "synthetic" && mode !== "hybrid") {
        throw new Error(`Invalid --schedule-mode "${mode}". Use frequencies, synthetic, or hybrid.`);
    }
    return mode;
}

function parseOptions(argv: string[]): ExportGtfsOptions {
    const scope = requireCliValue(parseCliFlag(argv, "scope"), "scope");
    const outputDir = requireCliValue(parseCliFlag(argv, "output-dir"), "output-dir");
    const buildCode =
        parseCliFlag(argv, "build-code")?.trim() || defaultBuildCode(scope);

    return {
        scope,
        outputDir: path.resolve(outputDir),
        buildCode,
        createBuild: parseCliBoolFlag(argv, "create-build"),
        scheduleMode: parseScheduleMode(parseCliFlag(argv, "schedule-mode")),
    };
}

function printPlannedSteps(options: ExportGtfsOptions): void {
    const steps = [
        `Load active rows for scope=${options.scope}`,
        "Write agency.txt ← core_transport.operators",
        "Write stops.txt ← stops + stop_names",
        "Write routes.txt ← routes",
        "Write trips.txt ← route_variants",
        "Write stop_times.txt ← route_stops (synthetic or exact)",
        "Write calendar.txt ← service_calendars",
        `Write frequencies.txt (schedule-mode=${options.scheduleMode})`,
        "Write shapes.txt ← route_paths / route_variants.geom",
        "Write feed_info.txt with build metadata",
        `Zip → ${path.join(options.outputDir, "gtfs.zip")}`,
        "Update gtfs_export.export_builds + export_files",
    ];

    console.log("\nPlanned export steps (not executed in skeleton):");
    for (const [index, step] of steps.entries()) {
        console.log(`  ${index + 1}. ${step}`);
    }
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));

    console.log("export-gtfs (skeleton)");
    console.log("  scope:", options.scope);
    console.log("  outputDir:", options.outputDir);
    console.log("  buildCode:", options.buildCode);
    console.log("  createBuild:", options.createBuild);
    console.log("  scheduleMode:", options.scheduleMode);
    console.log("  ENABLE_GTFS_EXPORT:", ENABLE_GTFS_EXPORT);

    fs.mkdirSync(options.outputDir, { recursive: true });
    console.log("\nOutput directory ready:", options.outputDir);

    const pool = createPool();
    try {
        const health = await verifyDatabaseConnection(pool);
        console.log("\nDatabase connection: OK");
        console.log("  database:", health.database);
        console.log("  serverTime:", health.serverTime);
        console.log("  core_transport schema:", health.coreTransportSchema);
        console.log("  gtfs_export schema:", health.gtfsExportSchema);

        if (!health.coreTransportSchema) {
            throw new Error("core_transport schema missing. Apply migration 067 first.");
        }

        const tables = await checkCoreTransportTables(pool);
        console.log("\ncore_transport tables:");
        for (const t of tables) {
            console.log(`  ${t.tableName}: ${t.exists ? "ok" : "MISSING"}`);
        }
        assertCoreTransportTablesReady(tables);

        const readiness = await fetchGtfsReadinessSummary(pool);
        if (readiness) {
            console.log("\ncore_transport.v_gtfs_readiness_summary:");
            console.log("  activeRoutes:", readiness.activeRoutes);
            console.log("  activeVariants:", readiness.activeVariants);
            console.log("  activeStops:", readiness.activeStops);
            console.log("  variantsTooFewStops:", readiness.variantsTooFewStops);
            console.log("  variantsWithoutFrequency:", readiness.variantsWithoutFrequency);
            console.log("  variantsWithoutPath:", readiness.variantsWithoutPath);
        } else {
            console.log("\nReadiness view not found (migration 069 not applied?).");
        }

        if (options.createBuild) {
            if (!health.gtfsExportSchema) {
                throw new Error("gtfs_export schema missing. Apply migration 068 before --create-build.");
            }
            const build = await insertDraftExportBuild(pool, {
                buildCode: options.buildCode,
                scope: options.scope,
                outputPath: options.outputDir,
                notes:
                    "Skeleton export-gtfs run; no GTFS files written yet. schedule_mode=" +
                    options.scheduleMode,
            });
            console.log("\ngtfs_export.export_builds (draft):");
            console.log("  id:", build.id);
            console.log("  status:", build.status);
        } else {
            const existing = await findExportBuildByCode(pool, options.buildCode);
            if (existing) {
                console.log("\nExisting export_builds row (read-only):", existing);
            }
        }

        printPlannedSteps(options);

        writeSkeletonOutput(options.outputDir, options.scope, options.buildCode);
        console.log("\nWrote README-SKELETON.md and *.TODO placeholders (not production GTFS).");

        if (ENABLE_GTFS_EXPORT) {
            console.warn("\nENABLE_GTFS_EXPORT is true but export logic is not implemented yet.");
        } else {
            console.log("\nGTFS export disabled (ENABLE_GTFS_EXPORT = false).");
        }
    } finally {
        await closePool(pool);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});

/**
 * Phase 9: safe Supabase importer for one YBS route.
 *
 * Default mode is DRY-RUN (no writes). Pass --execute to write to the database.
 * Import only the route named by --route-code, one transaction per route.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/import/import-ybs-plan.ts \
 *     --run tmp/transport-imports/ybs-all --route-code YBS-1 [--execute]
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import dotenv from "dotenv";
import pg from "pg";

import {
    emptyResult,
    executeRouteImport,
    selectRouteActions,
    validateExecuteGuards,
    type DryRunPlan,
    type ImportResult,
    type PlanAction,
} from "../lib/import-executor.js";
import { refuseAllRoutesWithoutMaxRoutes } from "../lib/import-execute-guards.js";
import { repairRouteImport } from "../lib/repair-route-import.js";

type FullDryRunPlan = DryRunPlan & {
    blockers?: Array<{ code: string; message: string; route_code?: string }>;
    summary?: Record<string, number>;
    route_readiness_reports?: Array<{
        route_code: string;
        executable: boolean;
        risk_level: string;
        blockers_count: number;
        placeholder_geometry_count?: number;
    }>;
};

export type CliOptions = {
    runRoot: string;
    routeCode: string;
    routeCodes: string[];
    execute: boolean;
    databaseUrl?: string;
    replaceExistingUnreviewedRouteStops?: boolean;
    maxRoutes: number;
    maxRoutesExplicit: boolean;
    allowPlaceholderGeometry: boolean;
    allowHighRisk: boolean;
    repairImport: boolean;
};

function repoRoot(): string {
    return process.cwd();
}

function resolveFromRepo(relativePath: string): string {
    return path.isAbsolute(relativePath) ? relativePath : path.join(repoRoot(), relativePath);
}

function loadDatabaseEnv(): void {
    for (const envPath of [
        path.join(repoRoot(), "apps/api/.env"),
        path.join(repoRoot(), "infrastructure/.env"),
    ]) {
        if (fs.existsSync(envPath)) {
            dotenv.config({ path: envPath, override: false });
        }
    }
}

function resolveDatabaseUrl(explicit?: string): string | undefined {
    return (
        explicit ??
        process.env.SUPABASE_DIRECT_DATABASE_URL ??
        process.env.DATABASE_URL ??
        process.env.LOCAL_DATABASE_URL
    );
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeTextFile(filePath: string, text: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, text, "utf8");
}

/**
 * Split route-scoped actions from stop actions for one route import.
 *
 * Stop rows are shared catalog entities, but each stop action in the plan is
 * still tagged to a route via external_id / entity_ref. For multi-route plans,
 * include only stop actions for the target route — never the whole batch.
 */
function partitionActions(
    plan: DryRunPlan,
    routeCode: string,
): { routeActions: PlanAction[]; stopActions: PlanAction[] } {
    const stopEntityTypes = new Set(["stop"]);
    const routeActions: PlanAction[] = [];
    const stopActions: PlanAction[] = [];

    const routeScoped = new Set(selectRouteActions(plan, routeCode));

    // Find operators the selected route(s) reference, so we import them first.
    const operatorRefs = new Set<string>();
    for (const action of routeScoped) {
        const operatorRef = action.payload?.operator_ref;
        if (typeof operatorRef === "string") {
            operatorRefs.add(operatorRef);
        }
    }

    for (const action of plan.actions) {
        if (stopEntityTypes.has(action.entity_type)) {
            if (routeScoped.has(action)) {
                stopActions.push(action);
            }
        } else if (routeScoped.has(action)) {
            routeActions.push(action);
        } else if (action.entity_type === "operator" && operatorRefs.has(action.entity_ref)) {
            // Operator upsert + its source_link, referenced by the route.
            routeActions.push(action);
        }
    }

    return { routeActions, stopActions };
}

function countActions(actions: PlanAction[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const action of actions) {
        counts[action.action] = (counts[action.action] ?? 0) + 1;
    }
    return counts;
}

/** Dry-run: report what would happen, without touching the database. */
function buildDryRunResult(
    routeCode: string,
    routeActions: PlanAction[],
    stopActions: PlanAction[],
): ImportResult {
    const result = emptyResult(routeCode);
    result.executed = false;
    const all = [...routeActions, ...stopActions];
    result.counts = {
        planned_actions: {
            inserted: all.length,
            updated: 0,
            reused: 0,
            skipped: 0,
        },
    };
    for (const action of all) {
        if (action.action === "blocked_conflict") {
            result.conflicts.push({
                entity_type: action.entity_type,
                external_id: action.external_id,
                action: action.action,
                reason: action.reason ?? "Blocked conflict from plan.",
            });
        }
    }
    return result;
}

function renderReport(
    options: CliOptions,
    result: ImportResult,
    plannedCounts: Record<string, number>,
): string {
    const lines: string[] = [];
    lines.push(`# Phase 9 Import — ${options.routeCode}`);
    lines.push("");
    lines.push(`- Mode: ${options.execute ? "EXECUTE (wrote to database)" : "DRY-RUN (no writes)"}`);
    lines.push(`- Route code: ${options.routeCode}`);
    lines.push(`- Import batch id: ${result.import_batch_id ?? "n/a (dry-run)"}`);
    lines.push("");

    lines.push("## Planned actions");
    lines.push("");
    lines.push("| Action | Count |");
    lines.push("| --- | ---: |");
    for (const [action, count] of Object.entries(plannedCounts).sort()) {
        lines.push(`| ${action} | ${count} |`);
    }
    lines.push("");

    if (options.execute) {
        lines.push("## Table counts");
        lines.push("");
        lines.push("| Table | Inserted | Updated | Reused | Skipped |");
        lines.push("| --- | ---: | ---: | ---: | ---: |");
        for (const [table, c] of Object.entries(result.counts).sort()) {
            lines.push(`| ${table} | ${c.inserted} | ${c.updated} | ${c.reused} | ${c.skipped} |`);
        }
        lines.push("");
    }

    if (options.execute && result.stop_identity_metrics) {
        lines.push("## Stop identity metrics");
        lines.push("");
        lines.push(`- protected_stop_reuse_count: ${result.stop_identity_metrics.protected_stop_reuse_count}`);
        lines.push(
            `- protected_stop_not_modified_count: ${result.stop_identity_metrics.protected_stop_not_modified_count}`,
        );
        lines.push(
            `- reused_cross_route_stop_count: ${result.stop_identity_metrics.reused_cross_route_stop_count}`,
        );
        lines.push("");
    }

    lines.push("## Conflicts");
    lines.push("");
    if (result.conflicts.length === 0) {
        lines.push("None.");
    } else {
        lines.push("| Entity | External id | Action | Reason |");
        lines.push("| --- | --- | --- | --- |");
        for (const row of result.conflicts) {
            lines.push(`| ${row.entity_type} | ${row.external_id ?? ""} | ${row.action} | ${row.reason} |`);
        }
    }
    lines.push("");

    lines.push("## Skipped (non-fatal)");
    lines.push("");
    if (result.skipped.length === 0) {
        lines.push("None.");
    } else {
        lines.push("| Entity | External id | Action | Reason |");
        lines.push("| --- | --- | --- | --- |");
        for (const row of result.skipped) {
            lines.push(`| ${row.entity_type} | ${row.external_id ?? ""} | ${row.action} | ${row.reason} |`);
        }
    }
    lines.push("");

    if (result.errors.length > 0) {
        lines.push("## Import errors");
        lines.push("");
        lines.push("| Entity | Code | Message |");
        lines.push("| --- | --- | --- |");
        for (const err of result.errors) {
            lines.push(`| ${err.entity_type} | ${err.error_code} | ${err.error_message} |`);
        }
        lines.push("");
    }

    return `${lines.join("\n")}\n`;
}

function loadRouteCodesFile(filePath: string): string[] {
    const absolute = resolveFromRepo(filePath);
    return fs
        .readFileSync(absolute, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function assertExecuteAllowed(
    options: CliOptions,
    plan: FullDryRunPlan,
    routeCode: string,
    routeActions: PlanAction[],
    stopActions: PlanAction[],
    databaseUrl: string,
): Promise<void> {
    const multiRouteRefusal = refuseAllRoutesWithoutMaxRoutes({
        routeCodes: options.routeCodes,
        maxRoutesExplicit: options.maxRoutesExplicit,
    });
    if (multiRouteRefusal) {
        throw new Error(multiRouteRefusal);
    }

    const readiness = plan.route_readiness_reports?.find((row) => row.route_code === routeCode);
    if (readiness) {
        if (!readiness.executable) {
            throw new Error(
                `Refusing --execute for ${routeCode}: route readiness reports executable=false (risk=${readiness.risk_level}).`,
            );
        }
        if (readiness.blockers_count > 0) {
            throw new Error(
                `Refusing --execute for ${routeCode}: route readiness reports ${readiness.blockers_count} blocker(s).`,
            );
        }
        if (!options.allowHighRisk && readiness.risk_level === "high") {
            throw new Error(
                `Refusing --execute for ${routeCode}: risk_level=high. Pass --allow-high-risk to override.`,
            );
        }
        if (!options.allowPlaceholderGeometry && readiness.placeholder_geometry_count > 0) {
            throw new Error(
                `Refusing --execute for ${routeCode}: placeholder geometry present. Pass --allow-placeholder-geometry to override.`,
            );
        }
    }

    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 180_000,
    });
    const client = await pool.connect();
    try {
        const guardResult = await validateExecuteGuards({
            client,
            routeCode,
            routeActions,
            stopActions,
            plan,
            replaceExistingUnreviewedRouteStops: options.replaceExistingUnreviewedRouteStops,
        });
        if (!guardResult.safe) {
            throw new Error(
                `Refusing --execute for ${routeCode}:\n- ${guardResult.violations.join("\n- ")}`,
            );
        }
    } finally {
        client.release();
        await pool.end();
    }
}

export async function runImport(options: CliOptions): Promise<ImportResult> {
    const planPath = resolveFromRepo(
        path.join(options.runRoot, "supabase-dry-run/plan.json"),
    );
    if (!fs.existsSync(planPath)) {
        throw new Error(`Plan not found: ${planPath}`);
    }

    const plan = readJsonFile<FullDryRunPlan>(planPath);
    const { routeActions, stopActions } = partitionActions(plan, options.routeCode);

    if (routeActions.length === 0) {
        throw new Error(
            `No actions found for route ${options.routeCode} in plan. Check --route-code.`,
        );
    }

    const plannedCounts = countActions([...routeActions, ...stopActions]);

    let result: ImportResult;

    if (!options.execute) {
        result = buildDryRunResult(options.routeCode, routeActions, stopActions);
    } else {
        const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
        if (!databaseUrl) {
            throw new Error(
                "No database URL. Set SUPABASE_DIRECT_DATABASE_URL or DATABASE_URL for --execute.",
            );
        }

        await assertExecuteAllowed(
            options,
            plan,
            options.routeCode,
            routeActions,
            stopActions,
            databaseUrl,
        );

        const pool = new pg.Pool({
            connectionString: databaseUrl,
            max: 1,
            statement_timeout: 180_000,
        });
        const client = await pool.connect();
        try {
            result = await executeRouteImport({
                client,
                plan,
                routeCode: options.routeCode,
                routeActions,
                stopActions,
                replaceExistingUnreviewedRouteStops: options.replaceExistingUnreviewedRouteStops,
            });
        } catch (error) {
            const maybeResult = (error as { importResult?: ImportResult }).importResult;
            if (maybeResult) {
                result = maybeResult;
            } else {
                throw error;
            }
        } finally {
            client.release();
            await pool.end();
        }
    }

    const resultPath = resolveFromRepo(
        path.join(options.runRoot, `supabase-import/import-result-${options.routeCode}.json`),
    );
    const reportPath = resolveFromRepo(
        path.join(options.runRoot, `reports/phase9-import-${options.routeCode}.md`),
    );

    writeJsonFile(resultPath, {
        schema_version: 1,
        generated_at: new Date().toISOString(),
        mode: options.execute ? "execute" : "dry_run",
        route_code: options.routeCode,
        planned_counts: plannedCounts,
        result,
    });
    writeTextFile(reportPath, renderReport(options, result, plannedCounts));

    return result;
}

export async function runRepairImport(options: CliOptions): Promise<void> {
    const planPath = resolveFromRepo(
        path.join(options.runRoot, "supabase-dry-run/plan.json"),
    );
    if (!fs.existsSync(planPath)) {
        throw new Error(`Plan not found: ${planPath}`);
    }

    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    if (!databaseUrl) {
        throw new Error(
            "No database URL. Set SUPABASE_DIRECT_DATABASE_URL or DATABASE_URL for --repair-import.",
        );
    }

    const plan = readJsonFile<FullDryRunPlan>(planPath);
    const pool = new pg.Pool({
        connectionString: databaseUrl,
        max: 1,
        statement_timeout: 180_000,
    });
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const repairResult = await repairRouteImport({
            client,
            plan,
            routeCode: options.routeCode,
        });
        await client.query("COMMIT");

        console.log(`Phase 9 repair for ${options.routeCode}.`);
        console.log(
            `  source_links: inserted=${repairResult.source_links_inserted} reused=${repairResult.source_links_reused} skipped=${repairResult.source_links_skipped}`,
        );
        console.log(
            `  duplicate_stop_skips_recorded=${repairResult.duplicate_stop_skips_recorded} public_visibility_fixed=${repairResult.public_visibility_fixed}`,
        );
        if (repairResult.errors.length > 0) {
            console.log(`  repair_errors=${repairResult.errors.length}`);
            for (const error of repairResult.errors.slice(0, 10)) {
                console.log(`    - ${error}`);
            }
            if (repairResult.errors.length > 10) {
                console.log(`    - ... and ${repairResult.errors.length - 10} more`);
            }
        }
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

function parseCliArgs(argv: string[]): CliOptions {
    let runRoot = "tmp/transport-imports/ybs-all";
    let routeCode = "";
    let routeCodesFile = "";
    let execute = false;
    let databaseUrl: string | undefined;
    let replaceExistingUnreviewedRouteStops = false;
    let maxRoutes = 5;
    let maxRoutesExplicit = false;
    let allowPlaceholderGeometry = false;
    let allowHighRisk = false;
    let repairImport = false;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        const next = argv[index + 1];

        if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = next.trim();
            index++;
        } else if (arg === "--route-code" && next) {
            routeCode = next.trim();
            index++;
        } else if (arg === "--route-codes-file" && next) {
            routeCodesFile = next.trim();
            index++;
        } else if (arg === "--database-url" && next) {
            databaseUrl = next.trim();
            index++;
        } else if (arg === "--max-routes" && next) {
            maxRoutes = Number(next);
            maxRoutesExplicit = true;
            index++;
        } else if (arg === "--execute") {
            execute = true;
        } else if (arg === "--replace-existing-unreviewed-route-stops") {
            replaceExistingUnreviewedRouteStops = true;
        } else if (arg === "--allow-placeholder-geometry") {
            allowPlaceholderGeometry = true;
        } else if (arg === "--allow-high-risk") {
            allowHighRisk = true;
        } else if (arg === "--repair-import") {
            repairImport = true;
        }
    }

    const routeCodes = routeCodesFile
        ? loadRouteCodesFile(routeCodesFile)
        : routeCode
          ? [routeCode]
          : [];

    if (routeCodes.length === 0) {
        throw new Error("--route-code or --route-codes-file is required.");
    }

    return {
        runRoot,
        routeCode: routeCodes[0],
        routeCodes,
        execute,
        databaseUrl,
        replaceExistingUnreviewedRouteStops,
        maxRoutes: Number.isFinite(maxRoutes) && maxRoutes > 0 ? maxRoutes : 5,
        maxRoutesExplicit,
        allowPlaceholderGeometry,
        allowHighRisk,
        repairImport,
    };
}

async function main(): Promise<void> {
    loadDatabaseEnv();
    const options = parseCliArgs(process.argv.slice(2));
    if (options.repairImport) {
        await runRepairImport(options);
        return;
    }
    const result = await runImport(options);

    console.log(`Phase 9 import ${options.execute ? "EXECUTE" : "DRY-RUN"} for ${options.routeCode}.`);
    console.log(`Import batch id: ${result.import_batch_id ?? "n/a"}`);
    if (options.execute) {
        for (const [table, c] of Object.entries(result.counts).sort()) {
            console.log(
                `  ${table}: inserted=${c.inserted} updated=${c.updated} reused=${c.reused} skipped=${c.skipped}`,
            );
        }
    }
    console.log(`Conflicts: ${result.conflicts.length}, skipped: ${result.skipped.length}, errors: ${result.errors.length}`);
}

const isMainModule =
    process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (isMainModule) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

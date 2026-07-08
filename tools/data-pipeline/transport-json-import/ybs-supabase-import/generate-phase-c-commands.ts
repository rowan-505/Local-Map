#!/usr/bin/env npx tsx
/**
 * Generate manual Phase C commands for separate A/B/C YBS route codes.
 *
 * Phase C routes import as distinct codes (e.g. YBS-7-A, YBS-7-B).
 * Cleanup is usually not required unless dry-run shows a blocker for that exact code.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../");

const SOURCE_DIR = "tmp/transport-imports/ybs-all/merged/routes";
const PHASE_C_ROOT = "tmp/transport-imports/ybs-phase-c";

export const PHASE_C_ROUTES = [
    "YBS-7-A",
    "YBS-7-B",
    "YBS-9-A",
    "YBS-9-B",
    "YBS-31-A",
    "YBS-31-B",
    "YBS-34-A",
    "YBS-34-B",
    "YBS-53-A",
    "YBS-53-B",
    "YBS-60-A",
    "YBS-60-B",
    "YBS-64-A",
    "YBS-64-B",
    "YBS-70-A",
    "YBS-70-B",
    "YBS-89-A",
    "YBS-89-B",
    "YBS-89-C",
    "YBS-111-A",
    "YBS-111-B",
    "YBS-123-A",
    "YBS-123-B",
] as const;

const IMPORT_SCRIPT =
    "tools/data-pipeline/transport-json-import/ybs-supabase-import/run-ybs-import-workflow.ts";
const VALIDATE_SCRIPT =
    "tools/data-pipeline/transport-json-import/ybs-supabase-import/validate-imported-ybs.ts";

const SAFETY_NOTES = `## Notes

- Phase C keeps A/B/C suffixes as separate \`route_code\` values (for example \`YBS-7-A\`, not \`YBS-7\`).
- Old parent rows like \`YBS-7\` may remain until optional manual cleanup; importing \`YBS-7-A\` does not require deleting \`YBS-7\` first.
- After dry-run, confirm \`reports/route-code-map.json\` shows the hyphenated code and variants like \`YBS-7-A-INBOUND\`.
- Stop if import dry-run has blockers > 0 in \`reports/final-summary.md\`.
`;

function parseArgs(argv: string[]): { routes: string[]; outPath: string } {
    let routes: string[] = [];
    let allPhaseC = false;
    let outPath = join(REPO_ROOT, PHASE_C_ROOT, "phase-c-commands.md");

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--routes" && argv[i + 1]) {
            routes = argv[++i]!
                .split(",")
                .map((code) => code.trim().toUpperCase())
                .filter(Boolean);
        } else if (arg === "--all-phase-c") {
            allPhaseC = true;
        } else if (arg === "--out" && argv[i + 1]) {
            outPath = argv[++i]!.startsWith("/")
                ? argv[i]!
                : join(REPO_ROOT, argv[i]!);
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    if (allPhaseC) {
        routes = [...PHASE_C_ROUTES];
    }

    if (routes.length === 0) {
        printHelp();
        throw new Error("Provide --routes or --all-phase-c");
    }

    return { routes, outPath };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/generate-phase-c-commands.ts \\
    [--routes YBS-7-A,YBS-7-B] \\
    [--all-phase-c] \\
    [--out tmp/transport-imports/ybs-phase-c/phase-c-commands.md]
`);
}

function routeRunRoot(routeCode: string): string {
    return `${PHASE_C_ROOT}/${routeCode}`;
}

function renderRouteSection(routeCode: string): string {
    const runRoot = routeRunRoot(routeCode);

    return `## ${routeCode}

### 1) Import dry-run

\`\`\`bash
cd ${REPO_ROOT}

npx tsx ${IMPORT_SCRIPT} \\
  --source-dir ${SOURCE_DIR} \\
  --routes ${routeCode} \\
  --run-root ${runRoot} \\
  --dry-run \\
  --allow-placeholder-geometry \\
  --allow-high-risk
\`\`\`

Confirm in \`${runRoot}/reports/route-code-map.json\`: \`route_code = ${routeCode}\` (not parent without suffix).

### 2) Import execute

\`\`\`bash
cd ${REPO_ROOT}

npx tsx ${IMPORT_SCRIPT} \\
  --source-dir ${SOURCE_DIR} \\
  --routes ${routeCode} \\
  --run-root ${runRoot} \\
  --execute \\
  --allow-placeholder-geometry \\
  --allow-high-risk \\
  --confirm-import
\`\`\`

### 3) Validate

\`\`\`bash
cd ${REPO_ROOT}

npx tsx ${VALIDATE_SCRIPT} \\
  --routes ${routeCode} \\
  --run-root ${runRoot}
\`\`\`
`;
}

function generateMarkdown(routes: string[]): string {
    const sections = [
        "# Phase C YBS import commands",
        "",
        "Generated manual commands for separate A/B/C route codes.",
        "",
        SAFETY_NOTES,
        `## Routes (${routes.length})`,
        "",
        routes.map((route) => `- ${route}`).join("\n"),
        "",
        ...routes.map((route) => renderRouteSection(route)),
    ];

    return `${sections.join("\n").trim()}\n`;
}

function main(): void {
    const { routes, outPath } = parseArgs(process.argv.slice(2));
    const markdown = generateMarkdown(routes);

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown, "utf8");

    console.log(`Wrote ${routes.length} route command blocks to ${outPath}`);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("generate-phase-c-commands.ts") ||
        process.argv[1].endsWith("generate-phase-c-commands.js"));

if (isMain) {
    main();
}

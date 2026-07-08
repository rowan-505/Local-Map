#!/usr/bin/env npx tsx
/**
 * Generate manual Phase B commands for YBS routes blocked by pre-existing DB rows.
 *
 * Phase B routes need cleanup (--allow-non-ybs-route) before re-import.
 * Default output is markdown with dry-run and execute steps per route.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../../");

const SOURCE_DIR = "tmp/transport-imports/ybs-all/merged/routes";
const PHASE_B_ROOT = "tmp/transport-imports/ybs-phase-b";

export const PHASE_B_TEST_TRIO = ["YBS-10", "YBS-11", "YBS-12"] as const;

export const PHASE_B_GROUPS: ReadonlyArray<{ label: string; routes: readonly string[] }> = [
    { label: "Test trio (run first)", routes: PHASE_B_TEST_TRIO },
    {
        label: "Group 1",
        routes: [
            "YBS-15",
            "YBS-16",
            "YBS-17",
            "YBS-18",
            "YBS-19",
            "YBS-20",
            "YBS-21",
            "YBS-22",
            "YBS-23",
            "YBS-24",
        ],
    },
    {
        label: "Group 2",
        routes: [
            "YBS-25",
            "YBS-26",
            "YBS-27",
            "YBS-28",
            "YBS-33",
            "YBS-35",
            "YBS-38",
            "YBS-39",
            "YBS-40",
            "YBS-42",
        ],
    },
    {
        label: "Group 3",
        routes: [
            "YBS-43",
            "YBS-44",
            "YBS-45",
            "YBS-52",
            "YBS-55",
            "YBS-57",
            "YBS-58",
            "YBS-59",
            "YBS-61",
            "YBS-63",
        ],
    },
    {
        label: "Group 4",
        routes: [
            "YBS-65",
            "YBS-66",
            "YBS-68",
            "YBS-71",
            "YBS-72",
            "YBS-75",
            "YBS-76",
            "YBS-77",
            "YBS-79",
            "YBS-81",
        ],
    },
    {
        label: "Group 5",
        routes: [
            "YBS-83",
            "YBS-84",
            "YBS-85",
            "YBS-86",
            "YBS-87",
            "YBS-88",
            "YBS-90",
            "YBS-91",
            "YBS-92",
            "YBS-93",
        ],
    },
    {
        label: "Group 6",
        routes: ["YBS-94", "YBS-95", "YBS-96", "YBS-97", "YBS-98", "YBS-100", "YBS-129"],
    },
];

export const PHASE_B_ROUTES = PHASE_B_GROUPS.flatMap((group) => group.routes);

const CLEANUP_SCRIPT =
    "tools/data-pipeline/transport-json-import/ybs-supabase-import/cleanup-test-ybs-route.ts";
const IMPORT_SCRIPT =
    "tools/data-pipeline/transport-json-import/ybs-supabase-import/run-ybs-import-workflow.ts";
const VALIDATE_SCRIPT =
    "tools/data-pipeline/transport-json-import/ybs-supabase-import/validate-imported-ybs.ts";

const SAFETY_WARNINGS = `## Safety rules (read before execute)

- Stop if cleanup report has \`status: refused\` (protected reviewed/verified/manual_protected route).
- Review cleanup dry-run counts in \`<run>/reports/cleanup-<ROUTE>.md\` before \`--execute\`.
- Stop if import dry-run has blockers > 0 in \`reports/final-summary.md\`.
- Route tree cleanup only — no \`--cleanup-orphan-stops\` in these commands.
- Confirm \`route_code\` and \`route.id\` in cleanup report match the intended route.
`;

function parseArgs(argv: string[]): {
    routes: string[];
    allPhaseB: boolean;
    batchSize: number;
    outPath: string;
} {
    let routes: string[] = [];
    let allPhaseB = false;
    let batchSize = 10;
    let outPath = join(REPO_ROOT, PHASE_B_ROOT, "phase-b-commands.md");

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--routes" && argv[i + 1]) {
            routes = argv[++i]!
                .split(",")
                .map((code) => code.trim().toUpperCase())
                .filter(Boolean);
        } else if (arg === "--all-phase-b") {
            allPhaseB = true;
        } else if (arg === "--batch-size" && argv[i + 1]) {
            batchSize = Number(argv[++i]);
        } else if (arg === "--out" && argv[i + 1]) {
            outPath = argv[++i]!.startsWith("/")
                ? argv[i]!
                : join(REPO_ROOT, argv[i]!);
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    if (allPhaseB) {
        routes = [...PHASE_B_ROUTES];
    }

    if (routes.length === 0) {
        printHelp();
        throw new Error("Provide --routes or --all-phase-b");
    }

    if (!Number.isFinite(batchSize) || batchSize < 1) {
        throw new Error("--batch-size must be a positive number");
    }

    return { routes, allPhaseB, batchSize, outPath };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/generate-phase-b-commands.ts \\
    [--routes YBS-10,YBS-11,YBS-12] \\
    [--all-phase-b] \\
    [--batch-size 10] \\
    [--out tmp/transport-imports/ybs-phase-b/phase-b-commands.md]
`);
}

function routeRunRoot(routeCode: string): string {
    return `${PHASE_B_ROOT}/${routeCode}`;
}

function renderRouteSection(routeCode: string): string {
    const runRoot = routeRunRoot(routeCode);

    return `## ${routeCode}

### 1) Cleanup dry-run

\`\`\`bash
cd ${REPO_ROOT}

npx tsx ${CLEANUP_SCRIPT} \\
  --route-code ${routeCode} \\
  --allow-non-ybs-route \\
  --dry-run \\
  --run ${runRoot}
\`\`\`

Review: \`${runRoot}/reports/cleanup-${routeCode}.md\`

### 2) Cleanup execute

\`\`\`bash
cd ${REPO_ROOT}

npx tsx ${CLEANUP_SCRIPT} \\
  --route-code ${routeCode} \\
  --allow-non-ybs-route \\
  --execute \\
  --run ${runRoot}
\`\`\`

### 3) Import dry-run

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

Review: \`${runRoot}/reports/final-summary.md\`

### 4) Import execute

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

### 5) Validate

\`\`\`bash
cd ${REPO_ROOT}

npx tsx ${VALIDATE_SCRIPT} \\
  --routes ${routeCode} \\
  --run-root ${runRoot}
\`\`\`
`;
}

function renderBatchOverview(routes: string[], batchSize: number): string {
    const batches: string[][] = [];
    for (let i = 0; i < routes.length; i += batchSize) {
        batches.push(routes.slice(i, i + batchSize));
    }

    const lines = batches.map(
        (batch, index) =>
            `- Batch ${index + 1} (${batch.length} routes): ${batch.join(", ")}`,
    );

    return `## Suggested batch order (${routes.length} routes, batch size ${batchSize})

${lines.join("\n")}

### Recommended group order

${PHASE_B_GROUPS.map((group) => `- ${group.label}: ${group.routes.join(", ")}`).join("\n")}
`;
}

function generateMarkdown(routes: string[], batchSize: number): string {
    const sections = [
        "# Phase B YBS import commands",
        "",
        "Generated manual commands for routes blocked by pre-existing non-YBS DB rows.",
        "",
        SAFETY_WARNINGS,
        renderBatchOverview(routes, batchSize),
        "",
        ...routes.map((route) => renderRouteSection(route)),
    ];

    return `${sections.join("\n").trim()}\n`;
}

function main(): void {
    const { routes, batchSize, outPath } = parseArgs(process.argv.slice(2));
    const markdown = generateMarkdown(routes, batchSize);

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown, "utf8");

    console.log(`Wrote ${routes.length} route command blocks to ${outPath}`);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("generate-phase-b-commands.ts") ||
        process.argv[1].endsWith("generate-phase-b-commands.js"));

if (isMain) {
    main();
}

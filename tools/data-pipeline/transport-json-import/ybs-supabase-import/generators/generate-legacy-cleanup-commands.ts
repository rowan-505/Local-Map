#!/usr/bin/env npx tsx
/**
 * Generate Phase D legacy cleanup command sheet (reports only, no DB access).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    DEFAULT_REPORT_DIR,
    REPO_ROOT,
    renderWorkflowCommands,
    resolveReportDir,
} from "../lib/legacy-cleanup-shared.js";

function parseArgs(argv: string[]): { reportDir: string } {
    let reportDir = DEFAULT_REPORT_DIR;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--report-dir" && argv[i + 1]) {
            reportDir = resolveReportDir(argv[++i]!);
        } else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }
    return { reportDir };
}

function printHelp(): void {
    console.log(`Usage:
  npx tsx tools/data-pipeline/transport-json-import/ybs-supabase-import/generators/generate-legacy-cleanup-commands.ts \\
    --report-dir tmp/transport-imports/legacy-cleanup
`);
}

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const rel = args.reportDir.startsWith(REPO_ROOT)
        ? args.reportDir.slice(REPO_ROOT.length + 1)
        : args.reportDir;

    const content = `# Legacy transport cleanup — Phase D command sheet

Generated for report folder: \`${rel}\`

## Goal

Two-phase cleanup for legacy bus routes and orphan legacy stops.

- **Phase D1**: delete legacy route trees only. Stops are kept.
- **Phase D2**: after D1 validation, delete orphan legacy stops that are no longer used and not protected.

## Definitions

- **Systematic/current route**: \`transport.routes.mode = 'bus'\` with \`transport.source_links\` where \`entity_type = 'route'\`, \`source_name = 'external_ybs_app'\`, \`external_id LIKE 'route:ybs_go:%'\`.
- **Legacy route**: \`transport.routes.mode = 'bus'\`, \`deleted_at IS NULL\`, and no matching external_ybs_app route source link.

## Safety rules

1. Read reports first. All scripts default to dry-run except explicit report scripts (read-only).
2. Never run \`--execute\` without \`--confirm-legacy-route-cleanup\`.
3. Do not run Phase D2 until Phase D1 validation passes.
4. Systematic YBS routes and their source links must never be selected.
5. Protected rows (\`reviewed\`, \`verified\`, \`manual_protected\`) are blocked.

${renderWorkflowCommands(rel)}

## Expected report files

\`\`\`text
${rel}/phase-d1-legacy-route-candidates.json
${rel}/phase-d1-legacy-route-candidates.md
${rel}/legacy-route-cleanup-dry-run.json
${rel}/legacy-route-cleanup-dry-run.md
${rel}/legacy-route-cleanup-validation.json
${rel}/legacy-route-cleanup-validation.md
${rel}/orphan-legacy-stops-report.json
${rel}/orphan-legacy-stops-report.md
${rel}/orphan-stop-cleanup-dry-run.json
${rel}/orphan-stop-cleanup-dry-run.md
${rel}/orphan-stop-cleanup-execute.json
${rel}/orphan-stop-cleanup-execute.md
\`\`\`
`;

    mkdirSync(args.reportDir, { recursive: true });
    const mdPath = join(args.reportDir, "phase-d-commands.md");
    writeFileSync(mdPath, content, "utf8");
    console.log(`Wrote ${mdPath}`);
}

const isMain =
    process.argv[1] &&
    (process.argv[1].endsWith("generate-legacy-cleanup-commands.ts") ||
        process.argv[1].endsWith("generate-legacy-cleanup-commands.js"));

if (isMain) {
    main();
}

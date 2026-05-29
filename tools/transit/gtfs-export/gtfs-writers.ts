/**
 * GTFS CSV writers (skeleton — no production feed output yet).
 */

import fs from "node:fs";
import path from "node:path";

import { PLANNED_GTFS_FILES, type PlannedGtfsFile } from "./gtfs-types.js";

const SKELETON_README = `# GTFS export output (skeleton)

This directory was created by tools/transit/gtfs-export/export-gtfs.ts.

**No production GTFS files have been written yet.** Implement export logic per docs/transport/gtfs-export-plan.md.

## Planned files (not generated)

`;

export function writeSkeletonOutput(outputDir: string, scope: string, buildCode: string): void {
    fs.mkdirSync(outputDir, { recursive: true });

    const readmePath = path.join(outputDir, "README-SKELETON.md");
    const fileList = PLANNED_GTFS_FILES.map((f) => `- ${f}`).join("\n");

    const content = `${SKELETON_README}${fileList}

## Build metadata (placeholder)

- scope: ${scope}
- build_code: ${buildCode}
- status: skeleton only

## Next steps

1. Query core_transport for scope filter
2. Implement gtfs-writers per file
3. Zip bundle → gtfs.zip
4. Run validate-gtfs.ts
`;

    fs.writeFileSync(readmePath, content, "utf8");

    for (const fileName of PLANNED_GTFS_FILES) {
        const todoPath = path.join(outputDir, `${fileName}.TODO`);
        fs.writeFileSync(
            todoPath,
            [
                `# TODO: ${fileName}`,
                "",
                `Not implemented. Will be generated from core_transport when export-gtfs.ts is complete.`,
                `See docs/transport/gtfs-export-plan.md`,
                "",
            ].join("\n"),
            "utf8",
        );
    }
}

export function listPlannedGtfsFiles(): readonly PlannedGtfsFile[] {
    return PLANNED_GTFS_FILES;
}

/**
 * Future: writeAgencyCsv(rows, filePath), writeStopsCsv(...), etc.
 */
export function writersNotImplemented(): void {
    // Intentionally empty — reserved for Phase G1+ in gtfs-export-plan.md
}

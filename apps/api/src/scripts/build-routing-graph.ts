/**
 * Build a tiny routing graph from promoted core.core_streets rows.
 *
 * Usage:
 *   ENABLE_ROUTING_GRAPH_BUILD=true \
 *   npx tsx src/scripts/build-routing-graph.ts \
 *     --profile walk \
 *     --publish-batch-id 123 \
 *     --max-roads 3
 *
 * Dry run:
 *   npx tsx src/scripts/build-routing-graph.ts --profile drive --publish-batch-id 123 --dry-run
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { prisma } from "../lib/prisma.js";
import {
    isRoutingGraphProfileCode,
    ROUTING_GRAPH_BUILD_DEFAULT_MAX_ROADS,
} from "../modules/routing/routing.config.js";
import { RoutingGraphBuildService } from "../modules/routing/routing-graph-build.service.js";
import type { RoutingGraphBuildInput } from "../modules/routing/routing.types.js";

function readArg(name: string): string | undefined {
    const idx = process.argv.indexOf(name);
    if (idx === -1) {
        return undefined;
    }
    return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

async function main() {
    const profile = readArg("--profile") ?? "walk";
    if (!isRoutingGraphProfileCode(profile)) {
        throw new Error(`Invalid --profile ${profile}. Expected walk | drive | bus.`);
    }

    const publishBatchId = readArg("--publish-batch-id");
    const reviewBatchId = readArg("--review-batch-id");
    const bboxRaw = readArg("--bbox");
    const maxRoadsRaw = readArg("--max-roads");
    const regionCode = readArg("--region-code");
    const dryRun = hasFlag("--dry-run");

    let bbox: RoutingGraphBuildInput["bbox"] = null;
    if (bboxRaw) {
        const parts = bboxRaw.split(",").map((v) => Number(v.trim()));
        if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) {
            throw new Error("--bbox must be min_lon,min_lat,max_lon,max_lat");
        }
        bbox = { minLon: parts[0]!, minLat: parts[1]!, maxLon: parts[2]!, maxLat: parts[3]! };
    }

    const service = new RoutingGraphBuildService(prisma);
    const result = await service.buildGraph({
        profileCode: profile,
        sourcePublishBatchId: publishBatchId ? BigInt(publishBatchId) : null,
        sourceReviewBatchId: reviewBatchId ? BigInt(reviewBatchId) : null,
        bbox,
        regionCode: regionCode ?? null,
        maxRoads: maxRoadsRaw ? Number(maxRoadsRaw) : ROUTING_GRAPH_BUILD_DEFAULT_MAX_ROADS,
        dryRun,
        createdBy: null,
    });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

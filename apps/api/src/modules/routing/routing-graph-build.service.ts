import type { PrismaClient } from "@prisma/client";

import {
    isRoutingGraphBulkBuildEnabled,
    isRoutingGraphBuildEnabled,
    ROUTING_GRAPH_BUILD_CONTROLLED_MAX_ROADS,
} from "./routing.config.js";
import {
    RoutingGraphBuildDisabledError,
    RoutingGraphBuildInputError,
    RoutingGraphBuildMaxRoadsError,
} from "./routing.errors.js";
import { RoutingGraphBuildRepository } from "./routing-graph-build.repo.js";
import type { RoutingGraphBuildInput, RoutingGraphBuildResult } from "./routing.types.js";

function effectiveMaxRoads(requested: number): number {
    if (isRoutingGraphBulkBuildEnabled()) {
        return requested;
    }
    return Math.min(requested, ROUTING_GRAPH_BUILD_CONTROLLED_MAX_ROADS);
}

export class RoutingGraphBuildService {
    constructor(private readonly prisma: PrismaClient) {}

    async buildGraph(input: RoutingGraphBuildInput): Promise<RoutingGraphBuildResult> {
        if (!isRoutingGraphBuildEnabled()) {
            throw new RoutingGraphBuildDisabledError();
        }

        if (
            !input.sourcePublishBatchId &&
            !input.sourceReviewBatchId &&
            !input.bbox
        ) {
            throw new RoutingGraphBuildInputError(
                "At least one scope filter is required: source_publish_batch_id, source_review_batch_id, or bbox."
            );
        }

        const cappedMaxRoads = effectiveMaxRoads(input.maxRoads);
        if (cappedMaxRoads !== input.maxRoads) {
            throw new RoutingGraphBuildMaxRoadsError(input.maxRoads, cappedMaxRoads);
        }

        const repo = new RoutingGraphBuildRepository(this.prisma);
        const speeds = await repo.resolveProfileSpeeds(input.profileCode);

        const job = await repo.createBuildJob(input);
        let metadataId: bigint | null = null;

        try {
            const initialCounts = {
                selectedCoreRoadCount: 0,
                generatedNodeCount: 0,
                generatedEdgeCount: 0,
                generatedEdgeNameCount: 0,
                warningCount: 0,
                errorCount: 0,
                validationCodes: [] as string[],
            };
            metadataId = await repo.createBuildMetadata(job.id, input, initialCounts);

            const counts = await this.prisma.$transaction(async (tx) => {
                const txRepo = new RoutingGraphBuildRepository(tx);
                return txRepo.runGraphBuild(job.id, input, speeds);
            });

            const fatal = counts.selectedCoreRoadCount === 0 || counts.generatedEdgeCount === 0;
            const status = input.dryRun
                ? ("dry_run" as const)
                : fatal
                  ? ("failed" as const)
                  : ("completed" as const);

            if (input.dryRun) {
                await repo.finalizeBuildMetadata(
                    metadataId,
                    fatal ? "failed" : "completed",
                    counts,
                    input,
                    job.id
                );
                await repo.finalizeBuildJob(job.id, fatal ? "failed" : "completed", counts, input);
            } else if (fatal) {
                await repo.finalizeBuildMetadata(metadataId, "failed", counts, input, job.id);
                await repo.finalizeBuildJob(job.id, "failed", counts, input);
            } else {
                await repo.finalizeBuildMetadata(metadataId, "completed", counts, input, job.id);
                await repo.finalizeBuildJob(job.id, "completed", counts, input);
            }

            const message = input.dryRun
                ? fatal
                    ? "Dry-run completed: no routable core streets matched filters."
                    : `Dry-run completed: would build ${counts.generatedEdgeCount} edge(s) from ${counts.selectedCoreRoadCount} core street(s).`
                : fatal
                  ? "Routing graph build failed: no routable edges generated."
                  : `Routing graph build completed: ${counts.generatedEdgeCount} edge(s), ${counts.generatedNodeCount} node(s).`;

            return {
                build_job_id: job.id.toString(),
                build_job_public_id: job.publicId,
                status,
                dry_run: input.dryRun,
                profile_code: input.profileCode,
                selected_core_road_count: counts.selectedCoreRoadCount,
                generated_node_count: counts.generatedNodeCount,
                generated_edge_count: counts.generatedEdgeCount,
                generated_edge_name_count: counts.generatedEdgeNameCount,
                warning_count: counts.warningCount,
                error_count: counts.errorCount,
                validation_codes: counts.validationCodes,
                message,
                metadata_id: metadataId.toString(),
            };
        } catch (error) {
            await repo.markBuildJobFailed(
                job.id,
                error instanceof Error ? error.message : "Routing graph build failed."
            );
            if (metadataId !== null) {
                await repo.finalizeBuildMetadata(
                    metadataId,
                    "failed",
                    {
                        selectedCoreRoadCount: 0,
                        generatedNodeCount: 0,
                        generatedEdgeCount: 0,
                        generatedEdgeNameCount: 0,
                        warningCount: 0,
                        errorCount: 1,
                        validationCodes: [],
                    },
                    input,
                    job.id
                );
            }
            throw error;
        }
    }
}

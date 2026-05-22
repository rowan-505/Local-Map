import type { RoutingGraphProfileCode } from "./routing.config.js";

export type RoutingGraphBuildInput = {
    profileCode: RoutingGraphProfileCode;
    sourcePublishBatchId: bigint | null;
    sourceReviewBatchId: bigint | null;
    bbox: {
        minLon: number;
        minLat: number;
        maxLon: number;
        maxLat: number;
    } | null;
    regionCode: string | null;
    maxRoads: number;
    dryRun: boolean;
    createdBy: bigint | null;
};

export type RoutingGraphBuildResult = {
    build_job_id: string;
    build_job_public_id: string;
    status: "completed" | "failed" | "dry_run";
    dry_run: boolean;
    profile_code: RoutingGraphProfileCode;
    selected_core_road_count: number;
    generated_node_count: number;
    generated_edge_count: number;
    generated_edge_name_count: number;
    warning_count: number;
    error_count: number;
    validation_codes: string[];
    message: string;
    metadata_id: string | null;
};

export const postRoutingAdminBuildGraphSchema = {
    tags: ["routing"],
    summary: "Build a tiny routing graph from selected core.core_streets rows",
    description:
        "Generates routing.routing_nodes, routing.routing_edges, routing.routing_edge_names, and validation reports for a scoped batch. Requires ENABLE_ROUTING_GRAPH_BUILD=true.",
    security: [{ bearerAuth: [] }],
    body: {
        type: "object",
        required: ["profile_code"],
        properties: {
            profile_code: { type: "string", enum: ["walk", "drive", "bus"] },
            source_publish_batch_id: { type: "string", pattern: "^\\d+$" },
            source_review_batch_id: { type: "string", pattern: "^\\d+$" },
            bbox: {
                type: "object",
                required: ["min_lon", "min_lat", "max_lon", "max_lat"],
                properties: {
                    min_lon: { type: "number" },
                    min_lat: { type: "number" },
                    max_lon: { type: "number" },
                    max_lat: { type: "number" },
                },
            },
            region_code: { type: "string" },
            max_roads: { type: "integer", minimum: 1, maximum: 10000, default: 25 },
            dry_run: { type: "boolean", default: false },
        },
    },
    response: {
        200: {
            type: "object",
            properties: {
                build_job_id: { type: "string" },
                build_job_public_id: { type: "string" },
                status: { type: "string", enum: ["completed", "failed", "dry_run"] },
                dry_run: { type: "boolean" },
                profile_code: { type: "string" },
                selected_core_road_count: { type: "integer" },
                generated_node_count: { type: "integer" },
                generated_edge_count: { type: "integer" },
                generated_edge_name_count: { type: "integer" },
                warning_count: { type: "integer" },
                error_count: { type: "integer" },
                validation_codes: { type: "array", items: { type: "string" } },
                message: { type: "string" },
                metadata_id: { type: "string", nullable: true },
            },
        },
        400: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
        },
        403: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
        },
        409: {
            type: "object",
            properties: {
                message: { type: "string" },
            },
        },
    },
} as const;

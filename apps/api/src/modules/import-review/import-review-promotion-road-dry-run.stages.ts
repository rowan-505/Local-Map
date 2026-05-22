export const IMPORT_REVIEW_ROAD_DRY_RUN_STAGES = [
    { key: "road_dry_run_start", label: "Road dry-run start" },
    { key: "road_geometry_checks", label: "Road geometry checks" },
    { key: "road_reference_checks", label: "Road reference checks" },
    { key: "road_duplicate_checks", label: "Road duplicate checks" },
    { key: "road_connectivity_checks", label: "Road connectivity checks" },
    { key: "road_routing_attribute_checks", label: "Road routing attribute checks" },
    { key: "road_dry_run_summary", label: "Road dry-run summary" },
] as const;

export type ImportReviewRoadDryRunStageKey =
    (typeof IMPORT_REVIEW_ROAD_DRY_RUN_STAGES)[number]["key"];

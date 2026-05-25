export const IMPORT_REVIEW_ROUTING_BARRIER_DRY_RUN_STAGES = [
    { key: "routing_barrier_dry_run_start", label: "Routing barrier dry-run start" },
    { key: "routing_barrier_geometry_checks", label: "Routing barrier geometry checks" },
    { key: "routing_barrier_network_checks", label: "Routing barrier network checks" },
    { key: "routing_barrier_duplicate_checks", label: "Routing barrier duplicate checks" },
    { key: "routing_barrier_dry_run_summary", label: "Routing barrier dry-run summary" },
] as const;

export type ImportReviewRoutingBarrierDryRunStageKey =
    (typeof IMPORT_REVIEW_ROUTING_BARRIER_DRY_RUN_STAGES)[number]["key"];

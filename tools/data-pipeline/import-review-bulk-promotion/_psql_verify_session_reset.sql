-- Drop verify-script temp tables so standalone re-runs and \ir from delete scripts are idempotent.

DROP TABLE IF EXISTS
    bulk_admin_verify_warnings,
    bulk_admin_verify_hard_fails,
    bulk_admin_verify_summary,
    bulk_admin_verify_scope,
    bulk_admin_verify_params,
    bulk_hier_verify_sample_results,
    bulk_hier_verify_sample_centroids,
    bulk_hier_verify_warnings,
    bulk_hier_verify_hard_fails,
    bulk_hier_verify_summary,
    bulk_hier_verify_admin,
    bulk_hier_verify_params,
    bulk_road_verify_dup_global_ext,
    bulk_road_verify_dup_batch_ext,
    bulk_road_verify_batch_ext_all,
    bulk_road_verify_warnings,
    bulk_road_verify_hard_fails,
    bulk_road_verify_summary,
    bulk_road_verify_scope,
    bulk_road_verify_params;

-- Drop repair-script temp tables so re-runs in the same psql session are idempotent.

DROP TABLE IF EXISTS
    _hier_planned,
    _hier_parents,
    _hier_ctx;

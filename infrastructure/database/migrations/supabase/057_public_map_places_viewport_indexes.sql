-- Public map viewport places endpoint indexes.
-- Existing migration 023 provides the GIST index on core.core_places(point_geom).

create index if not exists core_places_public_category_updated_idx
    on core.core_places (category_id, updated_at desc, id)
    where is_public = true
      and deleted_at is null;

create index if not exists core_places_public_importance_idx
    on core.core_places (
        importance_score desc nulls last,
        is_verified desc,
        updated_at desc,
        id asc
    )
    where is_public = true
      and deleted_at is null;

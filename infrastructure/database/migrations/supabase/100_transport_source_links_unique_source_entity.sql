-- Idempotency guard for OSM (and other source) transport imports.
-- transport.source_links currently has only a NON-unique btree on
-- (source_name, source_kind, external_id), which does not prevent duplicate
-- source links when re-running an import. This adds a partial UNIQUE index on
-- (entity_type, source_name, source_kind, external_id) so an upsert can use
-- ON CONFLICT to stay idempotent. The WHERE external_id IS NOT NULL clause
-- keeps rows without an external id (manual links) out of the uniqueness rule.

begin;

create unique index if not exists transport_source_links_unique_source_entity
    on transport.source_links (entity_type, source_name, source_kind, external_id)
    where external_id is not null;

commit;

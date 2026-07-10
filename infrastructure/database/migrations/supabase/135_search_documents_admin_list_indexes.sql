-- Admin search documents list: default sort by indexed_at desc.
-- Speeds GET /admin/search/documents first-page pagination without full canonical joins.

begin;

create index if not exists search_documents_indexed_at_desc_idx
    on search.search_documents (indexed_at desc, entity_type asc, entity_id asc);

comment on index search.search_documents_indexed_at_desc_idx is
    'Admin search documents default list sort (indexed_at desc, entity_type, entity_id).';

commit;

-- =============================================================================
-- Supabase migration 140: settlement place class + POI category codes
-- =============================================================================
--
-- Purpose:
--   Support OSM settlement extraction (place=city|town|village|…) into
--   core.core_places with stable category codes for import_work / Import Review.
--
-- Scope:
--   - ref.ref_place_classes: settlement
--   - ref.ref_poi_categories: settlement parent + leaf settlement types
--
-- Safety:
--   - Idempotent inserts (ON CONFLICT DO NOTHING / WHERE NOT EXISTS).
--   - Does not modify core entity rows.
--
-- Apply: deliberate Supabase migration / SQL Editor. Not CI auto-apply.
-- =============================================================================

BEGIN;

-- Place class used by Stage 05 settlement candidates (preferred over poi).
INSERT INTO ref.ref_place_classes (code, name)
SELECT 'settlement', 'Settlement'
WHERE NOT EXISTS (
    SELECT 1 FROM ref.ref_place_classes WHERE code = 'settlement'
);

-- Parent category
INSERT INTO ref.ref_poi_categories (parent_id, code, name, sort_order, is_searchable, is_public)
SELECT NULL, 'settlement', 'Settlement', 70, true, true
WHERE NOT EXISTS (
    SELECT 1 FROM ref.ref_poi_categories WHERE code = 'settlement'
);

-- Leaf settlement types (OSM place=* values)
WITH parent AS (
    SELECT id FROM ref.ref_poi_categories WHERE code = 'settlement' LIMIT 1
),
leaves(code, name, sort_order) AS (
    VALUES
        ('city', 'City', 10),
        ('town', 'Town', 20),
        ('village', 'Village', 30),
        ('hamlet', 'Hamlet', 40),
        ('suburb', 'Suburb', 50),
        ('quarter', 'Quarter', 60),
        ('neighbourhood', 'Neighbourhood', 70),
        ('locality', 'Locality', 80)
)
INSERT INTO ref.ref_poi_categories (parent_id, code, name, sort_order, is_searchable, is_public)
SELECT parent.id, leaves.code, leaves.name, leaves.sort_order, true, true
FROM parent
CROSS JOIN leaves
WHERE NOT EXISTS (
    SELECT 1 FROM ref.ref_poi_categories c WHERE c.code = leaves.code
);

COMMIT;

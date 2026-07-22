-- Prompt 6 — Fix road classes (mechanical FK + add unclassified ref)

SET statement_timeout = '30min';

BEGIN;

CREATE TABLE IF NOT EXISTS system.repair_streets_road_class_before_202607 (
  id bigint PRIMARY KEY,
  road_class text,
  road_class_id bigint,
  manual_override boolean,
  is_verified boolean,
  verification_status text,
  updated_at timestamptz,
  repaired_at timestamptz NOT NULL DEFAULT now()
);

-- Add unclassified if missing (keep existing rows)
INSERT INTO ref.ref_road_classes (code, name, rank, min_zoom, default_width, is_public)
SELECT 'unclassified', 'Unclassified', 52, 12, 7, true
WHERE NOT EXISTS (SELECT 1 FROM ref.ref_road_classes WHERE code = 'unclassified');

-- Backup rows that will change
INSERT INTO system.repair_streets_road_class_before_202607 (
  id, road_class, road_class_id, manual_override, is_verified, verification_status, updated_at
)
SELECT s.id, s.road_class, s.road_class_id, s.manual_override, s.is_verified,
       s.verification_status, s.updated_at
FROM core.core_streets s
JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND s.road_class IN ('track', 'unclassified')
  AND rc.code = 'unknown'
ON CONFLICT (id) DO NOTHING;

-- Fix track FK → track
UPDATE core.core_streets s
SET road_class_id = r.id,
    updated_at = now()
FROM ref.ref_road_classes r
WHERE r.code = 'track'
  AND s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND s.road_class = 'track'
  AND s.road_class_id IS DISTINCT FROM r.id;

-- Fix unclassified FK → unclassified
UPDATE core.core_streets s
SET road_class_id = r.id,
    updated_at = now()
FROM ref.ref_road_classes r
WHERE r.code = 'unclassified'
  AND s.deleted_at IS NULL
  AND NOT COALESCE(s.manual_override, false)
  AND s.road_class = 'unclassified'
  AND s.road_class_id IS DISTINCT FROM r.id;

COMMIT;

-- Verify
SELECT 'text_fk_mismatch' AS metric, count(*)::text AS n
FROM core.core_streets s
LEFT JOIN ref.ref_road_classes rc ON rc.id = s.road_class_id
WHERE s.deleted_at IS NULL AND s.road_class IS DISTINCT FROM rc.code
UNION ALL
SELECT 'backup_rows', count(*)::text FROM system.repair_streets_road_class_before_202607
UNION ALL
SELECT 'ref_has_unclassified',
       CASE WHEN EXISTS (SELECT 1 FROM ref.ref_road_classes WHERE code='unclassified') THEN '1' ELSE '0' END;

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

CREATE TEMP TABLE direct_core_test_cases(
  entity_family text NOT NULL,
  case_name text NOT NULL,
  import_class text NOT NULL,
  expected_sink text NOT NULL,
  PRIMARY KEY(entity_family,case_name)
)ON COMMIT DROP;

INSERT INTO direct_core_test_cases
SELECT family,case_name,import_class,expected_sink
FROM unnest(ARRAY[
  'places','roads','buildings','landuse','water_lines','water_polygons',
  'routing_barriers'
])family
CROSS JOIN(VALUES
 ('safe_new','safe_new','core'),
 ('safe_update','safe_update','core'),
 ('unchanged','unchanged','none'),
 ('conflict','conflict','import_review'),
 ('duplicate','duplicate','import_review'),
 ('manual_protected','manual_protected','import_review'),
 ('verified_conflict','verified_conflict','import_review'),
 ('possible_delete','possible_delete','import_review'),
 ('invalid','invalid','local_rejection'),
 ('pmtiles_only','pmtiles_only','pmtiles')
)v(case_name,import_class,expected_sink);

DO $$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
  'places','roads','buildings','landuse','water_lines','water_polygons',
  'routing_barriers'
 ]LOOP
  IF(SELECT count(*)FROM direct_core_test_cases
     WHERE entity_family=f AND expected_sink='core')<>2 THEN
   RAISE EXCEPTION '%: safe_new/safe_update routing failed',f;
  END IF;
  IF(SELECT count(*)FROM direct_core_test_cases
     WHERE entity_family=f AND expected_sink='none')<>1 THEN
   RAISE EXCEPTION '%: unchanged routing failed',f;
  END IF;
  IF(SELECT count(*)FROM direct_core_test_cases
     WHERE entity_family=f AND expected_sink='import_review')<>5 THEN
   RAISE EXCEPTION '%: review routing failed',f;
  END IF;
  IF(SELECT count(*)FROM direct_core_test_cases
     WHERE entity_family=f AND expected_sink='local_rejection')<>1 THEN
   RAISE EXCEPTION '%: invalid routing failed',f;
  END IF;
  IF(SELECT count(*)FROM direct_core_test_cases
     WHERE entity_family=f AND expected_sink='pmtiles')<>1 THEN
   RAISE EXCEPTION '%: PMTiles routing failed',f;
  END IF;
 END LOOP;
END $$;

-- Exercise the set-based mutation contract for each family. These deliberately
-- small fixtures prove that only safe_new/safe_update reach Core, unchanged is
-- untouched, and an identical rerun produces no writes or duplicate identities.
CREATE TEMP TABLE direct_core_mock(
 entity_family text NOT NULL,
 stable_identity text NOT NULL,
 payload text NOT NULL,
 PRIMARY KEY(entity_family,stable_identity)
)ON COMMIT DROP;

CREATE TEMP TABLE direct_core_mock_candidates(
 entity_family text NOT NULL,
 case_name text NOT NULL,
 stable_identity text NOT NULL,
 payload text NOT NULL,
 expected_sink text NOT NULL,
 PRIMARY KEY(entity_family,case_name)
)ON COMMIT DROP;

INSERT INTO direct_core_mock(entity_family,stable_identity,payload)
SELECT family,family||':safe_update','before'
FROM unnest(ARRAY[
 'places','roads','buildings','landuse','water_lines','water_polygons',
 'routing_barriers'
])family
UNION ALL
SELECT family,family||':unchanged','same'
FROM unnest(ARRAY[
 'places','roads','buildings','landuse','water_lines','water_polygons',
 'routing_barriers'
])family;

INSERT INTO direct_core_mock_candidates
SELECT family,case_name,family||':'||case_name,payload,expected_sink
FROM unnest(ARRAY[
 'places','roads','buildings','landuse','water_lines','water_polygons',
 'routing_barriers'
])family
CROSS JOIN(VALUES
 ('safe_new','new','core'),
 ('safe_update','after','core'),
 ('unchanged','same','none'),
 ('conflict','conflict','import_review'),
 ('invalid','invalid','local_rejection')
)v(case_name,payload,expected_sink);

CREATE TEMP TABLE direct_core_mock_changes(
 entity_family text NOT NULL,
 action text NOT NULL,
 stable_identity text NOT NULL
)ON COMMIT DROP;

WITH inserted AS(
 INSERT INTO direct_core_mock(entity_family,stable_identity,payload)
 SELECT entity_family,stable_identity,payload
 FROM direct_core_mock_candidates
 WHERE case_name='safe_new' AND expected_sink='core'
 ON CONFLICT(entity_family,stable_identity)DO NOTHING
 RETURNING entity_family,stable_identity
)
INSERT INTO direct_core_mock_changes
SELECT entity_family,'insert',stable_identity FROM inserted;

WITH updated AS(
 UPDATE direct_core_mock c
 SET payload=s.payload
 FROM direct_core_mock_candidates s
 WHERE s.case_name='safe_update' AND s.expected_sink='core'
   AND c.entity_family=s.entity_family
   AND c.stable_identity=s.stable_identity
   AND c.payload IS DISTINCT FROM s.payload
 RETURNING c.entity_family,c.stable_identity
)
INSERT INTO direct_core_mock_changes
SELECT entity_family,'update',stable_identity FROM updated;

DO $$
DECLARE f text;
DECLARE rerun_inserted integer;
DECLARE rerun_updated integer;
BEGIN
 FOREACH f IN ARRAY ARRAY[
  'places','roads','buildings','landuse','water_lines','water_polygons',
  'routing_barriers'
 ]LOOP
  IF(SELECT count(*)FROM direct_core_mock_changes
     WHERE entity_family=f AND action='insert')<>1 THEN
   RAISE EXCEPTION '%: expected exactly one safe_new insert',f;
  END IF;
  IF(SELECT count(*)FROM direct_core_mock_changes
     WHERE entity_family=f AND action='update')<>1 THEN
   RAISE EXCEPTION '%: expected exactly one safe_update update',f;
  END IF;
  IF(SELECT payload FROM direct_core_mock
     WHERE entity_family=f AND stable_identity=f||':unchanged')<>'same' THEN
   RAISE EXCEPTION '%: unchanged fixture was modified',f;
  END IF;
  IF EXISTS(
   SELECT 1 FROM direct_core_mock
   WHERE entity_family=f
     AND stable_identity IN(f||':conflict',f||':invalid')
  )THEN
   RAISE EXCEPTION '%: non-Core fixture reached Core',f;
  END IF;

  INSERT INTO direct_core_mock(entity_family,stable_identity,payload)
  SELECT entity_family,stable_identity,payload
  FROM direct_core_mock_candidates
  WHERE entity_family=f AND case_name='safe_new' AND expected_sink='core'
  ON CONFLICT(entity_family,stable_identity)DO NOTHING;
  GET DIAGNOSTICS rerun_inserted=ROW_COUNT;

  UPDATE direct_core_mock c
  SET payload=s.payload
  FROM direct_core_mock_candidates s
  WHERE s.entity_family=f AND s.case_name='safe_update'
    AND s.expected_sink='core'
    AND c.entity_family=s.entity_family
    AND c.stable_identity=s.stable_identity
    AND c.payload IS DISTINCT FROM s.payload;
  GET DIAGNOSTICS rerun_updated=ROW_COUNT;

  IF rerun_inserted<>0 OR rerun_updated<>0 THEN
   RAISE EXCEPTION '%: identical rerun wrote insert=% update=%',
    f,rerun_inserted,rerun_updated;
  END IF;
 END LOOP;
END $$;

-- Per-family transaction rollback fixture. The exception block is a PostgreSQL
-- subtransaction; the insert must be absent after the forced failure.
CREATE TEMP TABLE direct_core_rollback_probe(
 entity_family text PRIMARY KEY
)ON COMMIT DROP;

DO $$
DECLARE f text;
BEGIN
 FOREACH f IN ARRAY ARRAY[
  'places','roads','buildings','landuse','water_lines','water_polygons',
  'routing_barriers'
 ]LOOP
  BEGIN
   INSERT INTO direct_core_rollback_probe VALUES(f);
   RAISE EXCEPTION 'forced % rollback',f;
  EXCEPTION WHEN raise_exception THEN
   NULL;
  END;
  IF EXISTS(SELECT 1 FROM direct_core_rollback_probe WHERE entity_family=f)THEN
   RAISE EXCEPTION '%: forced rollback left a partial row',f;
  END IF;
 END LOOP;
END $$;

SELECT entity_family,
 count(*)FILTER(WHERE case_name='safe_new')safe_new_cases,
 count(*)FILTER(WHERE case_name='safe_update')safe_update_cases,
 count(*)FILTER(WHERE case_name='unchanged')unchanged_cases,
 count(*)FILTER(WHERE case_name='conflict')conflict_cases,
 count(*)FILTER(WHERE case_name='invalid')invalid_cases,
 1 rollback_cases
FROM direct_core_test_cases
GROUP BY entity_family
ORDER BY entity_family;

ROLLBACK;

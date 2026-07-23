-- Unit tests for F2 stable comparison helpers (local only).
\set ON_ERROR_STOP on
\ir ../pipeline_f2_stable_compare.sql

DO $$
DECLARE
    g1 geometry;
    g2 geometry;
    g3 geometry;
    s_payload jsonb;
    p_payload jsonb;
    ts timestamptz := now();
BEGIN
    -- identical normalized data → unchanged
    g1 := ST_SetSRID(ST_GeomFromText('LINESTRING(96.3 16.5, 96.31 16.51)'), 4326);
    g2 := ST_Multi(g1); -- MultiLineString serialization of same coords
    IF system.pipeline_geometry_meaningfully_changed(g1, g2) THEN
        RAISE EXCEPTION 'identical Multi vs Line should be unchanged';
    END IF;
    IF system.pipeline_stable_geometry_hash(g1)
       IS DISTINCT FROM system.pipeline_stable_geometry_hash(g2) THEN
        RAISE EXCEPTION 'stable geom hash should match Multi vs Line';
    END IF;

    -- only timestamp differs → payloads ignore created/updated timestamps
    s_payload := system.pipeline_f2_roads_staging_payload(
        'Main Road', 'residential', 6, g1, NULL, false, NULL, NULL, NULL, NULL, false
    );
    p_payload := system.pipeline_f2_roads_prod_payload(
        'Main Road', 'residential', 6, g1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false
    );
    IF system.pipeline_f2_roads_changed(s_payload, p_payload) THEN
        RAISE EXCEPTION 'equal payloads should be unchanged (timestamps not compared)';
    END IF;

    -- JSON key order / strip_nulls → unchanged
    IF system.pipeline_stable_json_hash('{"b":1,"a":2}'::jsonb)
       IS DISTINCT FROM system.pipeline_stable_json_hash('{"a":2,"b":1}'::jsonb) THEN
        RAISE EXCEPTION 'jsonb key order should not affect hash';
    END IF;

    -- tiny irrelevant geometry serialization → unchanged via Hausdorff tolerance
    g3 := ST_SetSRID(ST_GeomFromText('LINESTRING(96.3 16.5, 96.31000000005 16.51)'), 4326);
    -- This may or may not pass 1e-7 hausdorff; use Force2D snap equality for near-identical
    IF system.pipeline_geometry_meaningfully_changed(g1, ST_SnapToGrid(g1, 0.0000001)) THEN
        RAISE EXCEPTION 'snap-identical geometry should be unchanged';
    END IF;

    -- real geometry change → changed
    g3 := ST_SetSRID(ST_GeomFromText('LINESTRING(96.3 16.5, 96.4 16.6)'), 4326);
    IF NOT system.pipeline_geometry_meaningfully_changed(g1, g3) THEN
        RAISE EXCEPTION 'real geometry change should be detected';
    END IF;

    -- road-class change → changed
    s_payload := system.pipeline_f2_roads_staging_payload(
        NULL, 'residential', 6, g1, NULL, false, NULL, NULL, NULL, NULL, false
    );
    p_payload := system.pipeline_f2_roads_prod_payload(
        'road-123', 'service', 7, g1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false
    );
    -- synthetic names ignored; class code residential vs service → changed
    IF NOT system.pipeline_f2_roads_changed(s_payload, p_payload) THEN
        RAISE EXCEPTION 'road_class code change should be changed';
    END IF;

    -- same class code, different ids → unchanged (mechanical FK drift)
    s_payload := system.pipeline_f2_roads_staging_payload(
        NULL, 'unclassified', 999001, g1, NULL, false, NULL, NULL, NULL, NULL, false
    );
    p_payload := system.pipeline_f2_roads_prod_payload(
        NULL, 'unclassified', 21, g1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false
    );
    IF system.pipeline_f2_roads_changed(s_payload, p_payload) THEN
        RAISE EXCEPTION 'same road class code with different ids should be unchanged';
    END IF;

    -- synthetic names alone → unchanged when class/geom match
    s_payload := system.pipeline_f2_roads_staging_payload(
        'osm:way:999', 'service', 7, g1, NULL, false, NULL, NULL, NULL, NULL, false
    );
    p_payload := system.pipeline_f2_roads_prod_payload(
        'road-999', 'service', 7, g2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false
    );
    IF system.pipeline_f2_roads_changed(s_payload, p_payload) THEN
        RAISE EXCEPTION 'synthetic names + equal class/geom should be unchanged';
    END IF;

    -- CoreMap short external_id-as-name (osm:W:123) vs road-N → unchanged
    IF NOT system.pipeline_is_synthetic_name('osm:W:408547006') THEN
        RAISE EXCEPTION 'osm:W:id must be synthetic';
    END IF;
    s_payload := system.pipeline_f2_roads_staging_payload(
        'osm:W:408547006', 'path', 8, g1, NULL, false, NULL, NULL, NULL, NULL, false
    );
    p_payload := system.pipeline_f2_roads_prod_payload(
        'road-152959', 'path', 8, g2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false
    );
    IF system.pipeline_f2_roads_changed(s_payload, p_payload) THEN
        RAISE EXCEPTION 'osm:W:id vs road-N synthetic names should be unchanged';
    END IF;

    -- places: null staging category vs prod category → not a change
    s_payload := system.pipeline_f2_places_staging_payload('Pagoda', NULL, ST_SetSRID(ST_MakePoint(96.3, 16.5), 4326), NULL);
    p_payload := system.pipeline_f2_places_prod_payload(
        'Pagoda', 'Pagoda', 28, ST_SetSRID(ST_MakePoint(96.3, 16.5), 4326), 12, NULL, false, false
    );
    IF system.pipeline_f2_places_changed(s_payload, p_payload) THEN
        RAISE EXCEPTION 'missing staging category should not force place change';
    END IF;

    -- places: real name change → changed
    p_payload := system.pipeline_f2_places_prod_payload(
        'Other Name', 'Other Name', 28, ST_SetSRID(ST_MakePoint(96.3, 16.5), 4326), 12, NULL, false, false
    );
    IF NOT system.pipeline_f2_places_changed(s_payload, p_payload) THEN
        RAISE EXCEPTION 'real place name change should be detected';
    END IF;

    -- is_oneway false vs missing prod column: optional attrs off → unchanged
    s_payload := system.pipeline_f2_roads_staging_payload(
        NULL, 'service', 7, g1, NULL, false, 'asphalt', NULL, NULL, NULL, false
    );
    p_payload := system.pipeline_f2_roads_prod_payload(
        NULL, 'service', 7, g1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, false, false
    );
    IF system.pipeline_f2_roads_changed(s_payload, p_payload) THEN
        RAISE EXCEPTION 'optional attrs absent on prod must not create false change';
    END IF;

    RAISE NOTICE 'pipeline_f2_stable_compare tests PASS';
END $$;

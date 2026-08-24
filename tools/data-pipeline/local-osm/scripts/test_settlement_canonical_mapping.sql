-- Smoke: canonical settlement mapping helpers (local pipeline only).
-- Run: psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tools/data-pipeline/local-osm/scripts/test_settlement_canonical_mapping.sql

\set ON_ERROR_STOP on

\ir ../pipeline_settlements.sql

DO $$
BEGIN
    IF system.pipeline_canonical_settlement_type('city') IS DISTINCT FROM 'city' THEN
        RAISE EXCEPTION 'city mapping failed';
    END IF;
    IF system.pipeline_canonical_settlement_type('town') IS DISTINCT FROM 'town' THEN
        RAISE EXCEPTION 'town mapping failed';
    END IF;
    IF system.pipeline_canonical_settlement_type('village') IS DISTINCT FROM 'village' THEN
        RAISE EXCEPTION 'village mapping failed';
    END IF;
    IF system.pipeline_canonical_settlement_type('hamlet') IS DISTINCT FROM 'village' THEN
        RAISE EXCEPTION 'hamlet should canonicalise to village';
    END IF;
    IF system.pipeline_canonical_settlement_type('quarter') IS DISTINCT FROM 'local_area' THEN
        RAISE EXCEPTION 'quarter should canonicalise to local_area';
    END IF;
    IF system.pipeline_canonical_settlement_type('suburb') IS DISTINCT FROM 'local_area' THEN
        RAISE EXCEPTION 'suburb should canonicalise to local_area';
    END IF;
    IF system.pipeline_canonical_settlement_type('neighbourhood') IS DISTINCT FROM 'local_area' THEN
        RAISE EXCEPTION 'neighbourhood should canonicalise to local_area';
    END IF;
    IF system.pipeline_canonical_settlement_type('locality') IS DISTINCT FROM 'local_area' THEN
        RAISE EXCEPTION 'locality should canonicalise to local_area';
    END IF;
    IF system.pipeline_canonical_settlement_type('farm') IS NOT NULL THEN
        RAISE EXCEPTION 'unknown OSM place must not get a canonical type';
    END IF;

    -- Places-family 1:1 helper must stay unchanged.
    IF system.pipeline_normalize_settlement_place('hamlet') IS DISTINCT FROM 'hamlet' THEN
        RAISE EXCEPTION 'places-family OSM place normalize must keep hamlet';
    END IF;
    IF system.pipeline_normalize_settlement_place('quarter') IS DISTINCT FROM 'quarter' THEN
        RAISE EXCEPTION 'places-family OSM place normalize must keep quarter';
    END IF;

    IF system.pipeline_settlement_canonical_name('{"place":"village"}'::jsonb) IS NOT NULL THEN
        RAISE EXCEPTION 'must not invent a name when OSM name tags are missing';
    END IF;
    IF system.pipeline_settlement_canonical_name('{"name":"Kyauktan","name:my":"ကျောက်တန်း"}'::jsonb)
       IS DISTINCT FROM 'ကျောက်တန်း' THEN
        RAISE EXCEPTION 'must preserve original OSM names';
    END IF;

    RAISE NOTICE 'settlement canonical mapping smoke PASS';
END
$$;

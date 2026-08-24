-- Source-fresh OSM street-name refresh (exact way-ID matches only).
-- Generated from the completed dry run; do not edit the VALUES payload by hand.
--
-- PBF timestamp: 2026-08-23T20:21:36Z
-- PBF SHA-256: e64c3e2f2a67ca4d7b8b61aa0883e6414db27539b435b3ea895bcde9e18c1dfb
-- Safe actions: 287 inserts, 62 OSM-managed updates.
-- Geometry, core street identity, external_id, lifecycle, and PMTiles are untouched.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

DO $$
BEGIN
    IF (SELECT count(*) FROM system.system_source_registry WHERE source_code = 'osm_myanmar') <> 1 THEN
        RAISE EXCEPTION 'expected exactly one active osm_myanmar source registry row';
    END IF;
END
$$;

WITH source AS (
    SELECT id
    FROM system.system_source_registry
    WHERE source_code = 'osm_myanmar'
), import_batch AS (
    INSERT INTO system.system_import_batches (
        source_registry_id, batch_name, trigger_type, status,
        started_at, finished_at, note
    )
    SELECT
        source.id,
        'source_fresh_street_names_2026_08_23',
        'manual',
        'completed',
        now(),
        now(),
        'Exact osm:W:<way_id> name-tag refresh; no geometry processing.'
    FROM source
    RETURNING id, source_registry_id
)
INSERT INTO system.system_source_snapshots (
    source_registry_id,
    import_batch_id,
    snapshot_ref,
    snapshot_version,
    region_code,
    checksum,
    captured_at,
    metadata
)
SELECT
    import_batch.source_registry_id,
    import_batch.id,
    'myanmar-260823.osm.pbf',
    'osm_myanmar_2026_08_23_street_names_v1',
    'MM',
    'e64c3e2f2a67ca4d7b8b61aa0883e6414db27539b435b3ea895bcde9e18c1dfb',
    '2026-08-23T20:21:36Z'::timestamptz,
    jsonb_build_object(
        'provider', 'geofabrik',
        'families', jsonb_build_array('street_names'),
        'matching', 'exact_external_id_osm_way',
        'geometry_processed', false,
        'osm_ways_scanned', 6894858,
        'name_metadata_ways', 57586,
        'migration', '194_source_fresh_street_name_refresh'
    )
FROM import_batch;

CREATE TEMP TABLE temp_source_fresh_safe_names (
    action text NOT NULL,
    external_id text NOT NULL,
    osm_way_id bigint NOT NULL,
    osm_version integer,
    osm_timestamp timestamptz,
    source_tag text NOT NULL,
    candidate_name text NOT NULL,
    language_code text NOT NULL,
    script_code text,
    expected_existing_name text
) ON COMMIT DROP;

INSERT INTO temp_source_fresh_safe_names VALUES
        ('safe_insert', 'osm:W:35894669', 35894669, 16, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:35894669', 35894669, 16, '2026-06-08 12:31:30+00', 'name:my', 'ဝေဇယန္တာလမ်း', 'my', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:35916774', 35916774, 53, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_insert', 'osm:W:35920381', 35920381, 19, '2026-06-14 10:02:08+00', 'name:en', 'Byamaso Street', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:36388776', 36388776, 11, '2026-06-14 12:58:09+00', 'name:en', 'Lower 94th Street', 'en', 'Latn', '94th Street'),
        ('safe_update_source_derived', 'osm:W:36388776', 36388776, 11, '2026-06-14 12:58:09+00', 'name:my', 'အောက် ၉၄ လမ်း', 'my', 'Mymr', '၉၄ လမ်း'),
        ('safe_insert', 'osm:W:110555602', 110555602, 41, '2026-08-05 16:25:37+00', 'name:en', 'Ngawon Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:110555602', 110555602, 41, '2026-08-05 16:25:37+00', 'name:my', 'ငဝန်တာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:168607326', 168607326, 10, '2026-07-27 04:27:44+00', 'name', '老街-清水河', 'und', NULL, NULL),
        ('safe_insert', 'osm:W:183166442', 183166442, 14, '2026-06-10 14:15:30+00', 'name:en', 'Miba Myittar Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:183166445', 183166445, 8, '2026-06-10 14:15:30+00', 'name:en', 'San Pya 5th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:183166470', 183166470, 6, '2026-06-10 14:15:30+00', 'name:en', 'San Pya 3rd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:183166472', 183166472, 8, '2026-06-10 14:15:30+00', 'name:en', 'San Pya 2nd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:183366363', 183366363, 9, '2026-07-25 13:35:22+00', 'name', '29 (C) Street', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:186806580', 186806580, 14, '2026-06-08 09:40:56+00', 'name:en', 'Yuzana Marlar Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:186806580', 186806580, 14, '2026-06-08 09:40:56+00', 'name:my', 'ယုဇနမာလာလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:186806590', 186806590, 31, '2026-06-08 12:31:30+00', 'name:en', 'Myittar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:186806599', 186806599, 22, '2026-06-23 06:01:32+00', 'name:en', 'Shwe Phi Khaing Nyar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:186811163', 186811163, 4, '2026-07-23 06:51:30+00', 'name', 'Sapal Road', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:186823235', 186823235, 14, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:186823245', 186823245, 5, '2026-06-08 12:39:11+00', 'name:en', 'Cherry 2nd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:186823257', 186823257, 8, '2026-06-20 05:00:17+00', 'name:my', 'အနော်မာလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:186823259', 186823259, 2, '2026-06-19 03:43:25+00', 'name:en', 'Cherry 1st Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:186823259', 186823259, 2, '2026-06-19 03:43:25+00', 'name:my', 'ချယ်ရီ ၁ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:186823259', 186823259, 2, '2026-06-19 03:43:25+00', 'name', 'ချယ်ရီ ၁ လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:186823268', 186823268, 8, '2026-06-20 05:00:17+00', 'name:my', 'ကောလိယလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:186823274', 186823274, 5, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 11th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353647', 187353647, 11, '2026-06-10 14:15:30+00', 'name:en', 'U Tin Oo Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353653', 187353653, 9, '2026-06-08 09:40:56+00', 'name:en', 'Yinmar Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353659', 187353659, 11, '2026-06-08 12:31:30+00', 'name:en', 'Nanthaphyu Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353666', 187353666, 10, '2026-06-20 05:00:17+00', 'name:my', '၀ရုဏာ ၄ လမ်း', 'my', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:187353669', 187353669, 10, '2026-06-20 05:00:17+00', 'name:en', 'Anawmar 7th Street', 'en', 'Latn', 'Warunar 7th Street'),
        ('safe_insert', 'osm:W:187353669', 187353669, 10, '2026-06-20 05:00:17+00', 'name:my', '၀ရုဏာ ၇ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:187353670', 187353670, 7, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 10th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353671', 187353671, 10, '2026-06-10 14:15:30+00', 'name:en', 'Shwe Yee Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353674', 187353674, 5, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 7th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353678', 187353678, 4, '2026-06-08 09:40:56+00', 'name:en', 'Yinmar 1st Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353682', 187353682, 3, '2026-06-08 09:40:56+00', 'name:en', 'Yinmar 2nd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353683', 187353683, 6, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 8th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:187353684', 187353684, 6, '2026-06-20 05:00:17+00', 'name:my', 'အနော်မာ ၂ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:200180857', 200180857, 8, '2026-08-10 03:46:53+00', 'name', 'Aung Zaya Road', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:203450732', 203450732, 11, '2026-08-03 09:02:56+00', 'name:en', 'Ingapu-Htanpinkone Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:203450732', 203450732, 11, '2026-08-03 09:02:56+00', 'name:my', 'အင်္ဂပူ-ထန်းပင်ကုန်းတာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:216883585', 216883585, 6, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 12th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:224276209', 224276209, 3, '2026-06-20 03:25:57+00', 'name', 'ပန်းလောင်လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:224839446', 224839446, 19, '2026-06-29 02:54:48+00', 'name', 'ถนนแม่สอด-มุกดาหาร', 'und', NULL, NULL),
        ('safe_insert', 'osm:W:228265503', 228265503, 12, '2026-06-08 09:40:56+00', 'name:en', 'Yuzana Marlar Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:239609238', 239609238, 5, '2026-08-20 07:38:54+00', 'name:en', 'Moelin Siangsawn Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:239609238', 239609238, 5, '2026-08-20 07:38:54+00', 'name:my', 'မိုးလင်းရှောင်စောန်းလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:239609238', 239609238, 5, '2026-08-20 07:38:54+00', 'name', 'မိုးလင်းရှောင်စောန်းလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:252081644', 252081644, 29, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:283842017', 283842017, 6, '2026-07-01 06:19:05+00', 'name', 'Nawayat Road', 'und', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:286497473', 286497473, 7, '2026-08-07 04:45:14+00', 'name:en', 'Ayawaddy Road', 'en', 'Latn', 'Padauk Road'),
        ('safe_update_source_derived', 'osm:W:286497473', 286497473, 7, '2026-08-07 04:45:14+00', 'name:my', 'ဧရာဝတီလမ်း', 'my', 'Mymr', 'ပိတောက်လမ်း'),
        ('safe_insert', 'osm:W:291225556', 291225556, 2, '2026-08-23 09:11:56+00', 'name', 'အမှတ်(၁)ဒရုန်းစစ်ဆင်မှုတပ်ရင်း၊ ဒစရ(၁)', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:299228798', 299228798, 13, '2026-06-20 03:29:26+00', 'name', 'ညောင်ပင်ကြီးစုရွာလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:299400348', 299400348, 10, '2026-07-21 04:18:41+00', 'name', 'ပဒုမ္မာ(၂)လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:306842164', 306842164, 7, '2026-06-08 12:31:30+00', 'name:en', 'Myittar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:306842168', 306842168, 36, '2026-06-08 12:31:30+00', 'name:en', 'Thu Mingalar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:306842169', 306842169, 6, '2026-06-08 12:31:30+00', 'name:en', 'Thu Mingalar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:306842171', 306842171, 3, '2026-06-20 05:00:17+00', 'name:en', 'Kawliya Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:306842171', 306842171, 3, '2026-06-20 05:00:17+00', 'name:my', 'ကောလိယလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:306842185', 306842185, 22, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:309211913', 309211913, 48, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:319500046', 319500046, 7, '2026-07-21 13:27:20+00', 'name:my', 'သပြေလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:327347453', 327347453, 7, '2026-08-20 07:36:44+00', 'name', 'เทพสุวรรณ', 'und', NULL, NULL),
        ('safe_update_source_derived', 'osm:W:335063529', 335063529, 11, '2026-06-11 16:26:28+00', 'name:en', 'Yarzar Dirit Street', 'en', 'Latn', 'Yarzadirit Road'),
        ('safe_insert', 'osm:W:342206243', 342206243, 5, '2026-07-16 04:19:31+00', 'name:my', 'ဧရာ၀တီလမ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:352525403', 352525403, 3, '2026-06-13 10:54:03+00', 'name:en', 'Tan Tine Mhway Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:352525403', 352525403, 3, '2026-06-13 10:54:03+00', 'name:my', 'တံတိုင်မွှေးလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:352525403', 352525403, 3, '2026-06-13 10:54:03+00', 'name', 'တံတိုင်မွှေးလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:358426739', 358426739, 8, '2026-06-30 15:13:57+00', 'name', 'Aung YaZa Road', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:365770028', 365770028, 2, '2026-08-04 03:08:42+00', 'name:en', 'SayarMuangSs', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:365770028', 365770028, 2, '2026-08-04 03:08:42+00', 'name:my', 'ဆရာမွောင်', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:365770028', 365770028, 2, '2026-08-04 03:08:42+00', 'name', 'ဆရာမွောင်', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:373996123', 373996123, 5, '2026-08-07 09:07:12+00', 'name', 'Pagoda Road', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:385932545', 385932545, 3, '2026-07-08 00:54:36+00', 'name', 'Shwe Yadana Street', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:389561797', 389561797, 8, '2026-06-19 12:15:05+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:389561798', 389561798, 17, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391193604', 391193604, 4, '2026-06-20 05:00:17+00', 'name:en', 'Kawliya 21st Street', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:391193614', 391193614, 5, '2026-06-20 05:00:17+00', 'name:en', 'Anawmar 5th Street', 'en', 'Latn', 'Warunar 5th Street'),
        ('safe_insert', 'osm:W:391193614', 391193614, 5, '2026-06-20 05:00:17+00', 'name:my', '၀ရုဏာ ၅ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:391193615', 391193615, 6, '2026-06-20 05:00:17+00', 'name:en', 'Kawliya 32 Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391193615', 391193615, 6, '2026-06-20 05:00:17+00', 'name:my', 'ကောလိယ ၃၂ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:391193617', 391193617, 6, '2026-06-20 05:00:17+00', 'name:en', 'Kawliya 23rd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391193621', 391193621, 6, '2026-06-20 05:00:17+00', 'name:en', 'Kawliya 20th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391193625', 391193625, 8, '2026-06-20 05:00:17+00', 'name:en', 'Kawliya 22nd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391354690', 391354690, 7, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 4th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391354709', 391354709, 9, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 5th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391354717', 391354717, 5, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 6th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391356095', 391356095, 6, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 4th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391356096', 391356096, 7, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 2nd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391356098', 391356098, 6, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 8th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391356100', 391356100, 7, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 3rd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391356105', 391356105, 10, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 6th Street', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:391356105', 391356105, 10, '2026-06-10 14:15:30+00', 'name:my', 'ငမိုးရိပ် ၆ လမ်း', 'my', 'Mymr', 'ငမိုးရိပ် 6 လမ်း'),
        ('safe_insert', 'osm:W:391356106', 391356106, 7, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 7th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391520769', 391520769, 6, '2026-06-20 05:00:17+00', 'name:my', '၀ရုဏာ ၆ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:391520785', 391520785, 6, '2026-06-20 05:00:17+00', 'name:en', 'Anawmar 8th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391521055', 391521055, 10, '2026-06-08 12:39:11+00', 'name:en', 'Yinmar Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391521140', 391521140, 5, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 4th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391521141', 391521141, 4, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 6th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391521144', 391521144, 5, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 2nd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391521145', 391521145, 5, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 3rd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:391521464', 391521464, 4, '2026-06-08 09:40:56+00', 'name:en', 'Karamat Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:392859764', 392859764, 6, '2026-06-10 14:15:30+00', 'name:en', 'San Pya 4th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:392995727', 392995727, 6, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 9th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:393003418', 393003418, 6, '2026-07-13 03:56:50+00', 'name:en', 'Zeyar Thiri street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:393003418', 393003418, 6, '2026-07-13 03:56:50+00', 'name:my', 'ဇေယျာသီရိလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:393003418', 393003418, 6, '2026-07-13 03:56:50+00', 'name', 'ဇေယျာသီရိလမ်း', 'und', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:394292072', 394292072, 21, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_insert', 'osm:W:395048197', 395048197, 9, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:395048198', 395048198, 12, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:395086044', 395086044, 16, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_insert', 'osm:W:395890534', 395890534, 2, '2026-07-09 10:07:35+00', 'name:en', 'Manaw Thuka Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:395890534', 395890534, 2, '2026-07-09 10:07:35+00', 'name:my', 'မနောသုခလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:395890534', 395890534, 2, '2026-07-09 10:07:35+00', 'name', 'မနောသုခလမ်း', 'und', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:397352642', 397352642, 5, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 10th Street', 'en', 'Latn', 'Myin Thar 10 Street'),
        ('safe_insert', 'osm:W:397719690', 397719690, 3, '2026-07-09 12:09:01+00', 'name:en', 'Htun Thisar (4) Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:397719702', 397719702, 3, '2026-07-09 12:09:01+00', 'name:en', 'Htun Thisar (5) Street', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:397719705', 397719705, 6, '2026-07-09 12:12:34+00', 'name:en', 'Thazin Street', 'en', 'Latn', 'Htun Thitsar Shortcut'),
        ('safe_update_source_derived', 'osm:W:397719705', 397719705, 6, '2026-07-09 12:12:34+00', 'name:my', 'သဇသ်လမ်း', 'my', 'Mymr', 'ထွန်းသစ္စာဖြတ်လမ်း'),
        ('safe_insert', 'osm:W:397719706', 397719706, 3, '2026-07-09 12:10:45+00', 'name:en', 'Anawyatar Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:399331886', 399331886, 6, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:401161378', 401161378, 3, '2026-07-21 04:29:25+00', 'name', 'ရွှေတမာ(၂)လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:401161380', 401161380, 3, '2026-07-21 04:29:04+00', 'name', 'ရွှေတမာ(၃)လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:401161382', 401161382, 3, '2026-07-21 04:28:21+00', 'name', 'ရွှေတမာ(၄)လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:401161384', 401161384, 3, '2026-06-20 03:21:05+00', 'name', 'ရွှေတမာ(၅)', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:401161394', 401161394, 3, '2026-06-08 09:02:27+00', 'name:my', 'ဂန္ဓမာ(၉)လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:401161394', 401161394, 3, '2026-06-08 09:02:27+00', 'name', 'Gandama 9th street', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:401161396', 401161396, 4, '2026-06-20 02:46:39+00', 'name', 'ရွှေကသစ်(၂)လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:401161398', 401161398, 3, '2026-07-21 04:27:07+00', 'name', 'ရွှေစံကားလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:401161411', 401161411, 3, '2026-06-20 03:21:23+00', 'name', 'ရွှေတမာလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:401161413', 401161413, 3, '2026-06-20 03:22:09+00', 'name', 'ရွှေကသစ်လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:406281896', 406281896, 3, '2026-07-30 03:05:38+00', 'name', '7 street', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:417627013', 417627013, 4, '2026-06-20 02:43:31+00', 'name', 'ရွှေတမာ(၇)လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:417655622', 417655622, 2, '2026-08-07 04:52:35+00', 'name:en', 'Swel Taw (17) Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:417655622', 417655622, 2, '2026-08-07 04:52:35+00', 'name:my', 'စွယ်တော်(၁၇)လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:417655622', 417655622, 2, '2026-08-07 04:52:35+00', 'name', 'စွယ်တော်(၁၇)လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:417716037', 417716037, 2, '2026-07-21 04:30:32+00', 'name', 'ရွှေသစ္စာလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:418622040', 418622040, 4, '2026-07-21 04:24:22+00', 'name', 'ဇော်ဂျီလမ်း', 'und', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:435277362', 435277362, 4, '2026-06-12 12:17:02+00', 'name:en', 'Nyaung Done- Hta Naung Sub-Road', 'en', 'Latn', 'Nyaung Done- Hta Naung  Sub-Road'),
        ('safe_update_source_derived', 'osm:W:465654594', 465654594, 15, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Merchant Street'),
        ('safe_update_source_derived', 'osm:W:465816327', 465816327, 16, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_update_source_derived', 'osm:W:465870331', 465870331, 8, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_insert', 'osm:W:466324322', 466324322, 20, '2026-07-31 05:57:16+00', 'name', 'ကျေးရွာဆက်လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:466925753', 466925753, 7, '2026-06-08 12:31:30+00', 'name:en', 'Thu Mingalar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:476361773', 476361773, 5, '2026-07-02 16:00:41+00', 'name', 'ကျွန်းရင်း_ရေကေျာ် လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:489257547', 489257547, 10, '2026-06-08 12:31:30+00', 'name:en', 'Thu Mingalar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:490847528', 490847528, 9, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:491268640', 491268640, 6, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_update_source_derived', 'osm:W:495430025', 495430025, 15, '2026-07-30 11:51:51+00', 'name:en', 'Thanlwin Bridge (Chaungzon)', 'en', 'Latn', 'Thanlwin Bridge (Chaungsone)'),
        ('safe_insert', 'osm:W:498155956', 498155956, 7, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:500577264', 500577264, 10, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_update_source_derived', 'osm:W:500577720', 500577720, 7, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_update_source_derived', 'osm:W:505478486', 505478486, 3, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayantar Road'),
        ('safe_update_source_derived', 'osm:W:505489599', 505489599, 3, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayantar Road'),
        ('safe_update_source_derived', 'osm:W:505489606', 505489606, 4, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayantar Road'),
        ('safe_insert', 'osm:W:521728295', 521728295, 5, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:522015956', 522015956, 10, '2026-06-19 12:15:05+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:526720011', 526720011, 12, '2026-06-24 10:42:00+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:526720012', 526720012, 5, '2026-06-08 12:31:30+00', 'name:en', 'Myittar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:526720013', 526720013, 6, '2026-06-08 12:31:30+00', 'name:en', 'Thu Mingalar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:533374065', 533374065, 16, '2026-08-03 08:58:05+00', 'name:en', 'Kwinkauk-Kywethaung Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:533374065', 533374065, 16, '2026-08-03 08:58:05+00', 'name:my', 'ကွင်းကောက်-ကျွဲသောင်တာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:539997600', 539997600, 9, '2026-08-03 08:45:53+00', 'name:my', 'အမြိုင်းဂျမ်းပြင်တာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:540160623', 540160623, 3, '2026-08-03 08:58:05+00', 'name:en', 'Kwinkauk-Kywethaung Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:540160623', 540160623, 3, '2026-08-03 08:58:05+00', 'name:my', 'ကွင်းကောက်-ကျွဲသောင်တာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:540233479', 540233479, 3, '2026-08-03 08:58:05+00', 'name:en', 'Kwinkauk-Kywethaung Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:540233479', 540233479, 3, '2026-08-03 08:58:05+00', 'name:my', 'ကွင်းကောက်-ကျွဲသောင်တာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:540233480', 540233480, 3, '2026-08-03 08:58:05+00', 'name:en', 'Kwinkauk-Kywethaung Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:540233480', 540233480, 3, '2026-08-03 08:58:05+00', 'name:my', 'ကွင်းကောက်-ကျွဲသောင်တာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:540234196', 540234196, 3, '2026-08-03 08:58:05+00', 'name:en', 'Kwinkauk-Kywethaung Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:540234196', 540234196, 3, '2026-08-03 08:58:05+00', 'name:my', 'ကွင်းကောက်-ကျွဲသောင်တာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:540282465', 540282465, 2, '2026-08-03 08:58:05+00', 'name:en', 'Kwinkauk-Kywethaung Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:540284980', 540284980, 3, '2026-08-03 08:58:05+00', 'name:en', 'Kwinkauk-Kywethaung Dyke', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:541254941', 541254941, 5, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', 'Upper Pazundaung Road'),
        ('safe_update_source_derived', 'osm:W:541254941', 541254941, 5, '2026-06-08 12:31:30+00', 'name:my', 'သံသုမာလမ်း', 'my', 'Mymr', 'အထက်ပုစွန်တောင်လမ်းမကြီး'),
        ('safe_insert', 'osm:W:541887207', 541887207, 9, '2026-07-25 09:09:11+00', 'name:en', 'Naungwaanlong Street', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:548065672', 548065672, 3, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_insert', 'osm:W:563226431', 563226431, 7, '2026-07-23 16:34:13+00', 'name', 'Yar Gyi Pyin - Myaung Pyar', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:565734514', 565734514, 6, '2026-06-20 05:00:17+00', 'name:my', 'အနော်မာ ၁ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:565734515', 565734515, 5, '2026-06-20 05:00:17+00', 'name:my', 'အနော်မာ ၃ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:565742512', 565742512, 13, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:565748084', 565748084, 7, '2026-06-20 05:00:17+00', 'name:my', 'ကောလိယ ၂၅ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:565748085', 565748085, 6, '2026-06-20 05:00:17+00', 'name:my', 'ကောလိယ ၂၄ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:569400638', 569400638, 10, '2026-06-03 16:39:38+00', 'name', 'Thiri Mingalar Street', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:575203030', 575203030, 10, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:575203030', 575203030, 10, '2026-06-08 16:46:11+00', 'name:my', 'ငါးမာန်အောင်ဘုရားလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:575203030', 575203030, 10, '2026-06-08 16:46:11+00', 'name', 'ငါးမာန်အောင်ဘုရားလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:575397933', 575397933, 9, '2026-06-09 04:28:01+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:575440930', 575440930, 9, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:583367322', 583367322, 6, '2026-06-20 05:00:17+00', 'name:my', 'ကောလိယ ၂၆ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:610385735', 610385735, 4, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:613529377', 613529377, 2, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayanta Road'),
        ('safe_update_source_derived', 'osm:W:613529378', 613529378, 2, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayantar Road'),
        ('safe_update_source_derived', 'osm:W:613529379', 613529379, 6, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayanta Road'),
        ('safe_insert', 'osm:W:616876217', 616876217, 17, '2026-06-24 10:42:00+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616876221', 616876221, 8, '2026-06-08 09:40:56+00', 'name:en', 'Yinmar 2nd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616876222', 616876222, 6, '2026-06-08 09:40:56+00', 'name:en', 'Yinmar Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616876226', 616876226, 4, '2026-06-08 09:40:56+00', 'name:en', 'Zabu Thapyae Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616886838', 616886838, 7, '2026-06-14 10:02:08+00', 'name:en', 'Byamaso Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616890109', 616890109, 12, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616890325', 616890325, 6, '2026-06-10 14:15:30+00', 'name:en', 'Baho Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616890329', 616890329, 7, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616895577', 616895577, 8, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:616895584', 616895584, 9, '2026-06-13 10:54:03+00', 'name:en', 'Cherry Garden Street', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:617106733', 617106733, 7, '2026-06-08 12:31:30+00', 'name:en', 'Lay Daungkan Road', 'en', 'Latn', 'Lay Daung Kan Road'),
        ('safe_update_source_derived', 'osm:W:617546403', 617546403, 10, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_insert', 'osm:W:618394448', 618394448, 6, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618394449', 618394449, 6, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618394453', 618394453, 8, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618394454', 618394454, 3, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 3th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618394454', 618394454, 3, '2026-06-10 14:15:30+00', 'name:my', 'မြင်သာ ၃ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:618394456', 618394456, 3, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 4th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618394456', 618394456, 3, '2026-06-10 14:15:30+00', 'name:my', 'မြင်သာ ၄ လမ်း', 'my', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:618395638', 618395638, 5, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', 'Than Thumar Street'),
        ('safe_insert', 'osm:W:618395639', 618395639, 3, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 5th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618395639', 618395639, 3, '2026-06-10 14:15:30+00', 'name:my', 'မြင်သာ ၅ လမ်း', 'my', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:618395644', 618395644, 5, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', 'Thanthumar Street'),
        ('safe_insert', 'osm:W:618395646', 618395646, 8, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618395647', 618395647, 5, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 10th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618395649', 618395649, 8, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618396936', 618396936, 7, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618396945', 618396945, 4, '2026-06-10 14:15:30+00', 'name:en', 'San Pya 6th Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618396946', 618396946, 8, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618396948', 618396948, 6, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618396951', 618396951, 5, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618396953', 618396953, 5, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:618423541', 618423541, 9, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_update_source_derived', 'osm:W:618445403', 618445403, 7, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_insert', 'osm:W:618450418', 618450418, 11, '2026-06-24 10:42:00+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618450422', 618450422, 3, '2026-06-10 14:15:30+00', 'name:en', 'Myin Thar 2nd Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618450422', 618450422, 3, '2026-06-10 14:15:30+00', 'name:my', 'မြင်သာ ၂ လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:618451821', 618451821, 6, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618451824', 618451824, 7, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618451826', 618451826, 9, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618451828', 618451828, 8, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618451830', 618451830, 7, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:618465598', 618465598, 5, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', 'Than Thu Mar Street'),
        ('safe_insert', 'osm:W:618471856', 618471856, 4, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:618499390', 618499390, 7, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:620558680', 620558680, 6, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Konthe Road'),
        ('safe_insert', 'osm:W:654533424', 654533424, 9, '2026-08-01 12:09:22+00', 'name', '7th street', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:655530481', 655530481, 9, '2026-06-24 10:42:00+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:663129651', 663129651, 5, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', 'Upper Pazundaung Road'),
        ('safe_update_source_derived', 'osm:W:663129651', 663129651, 5, '2026-06-08 12:31:30+00', 'name:my', 'သံသုမာလမ်း', 'my', 'Mymr', 'အထက်ပုစွန်တောင်လမ်းမကြီး'),
        ('safe_insert', 'osm:W:665169288', 665169288, 13, '2026-07-21 03:32:26+00', 'name', 'Pathein - Monywa Rd', 'und', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:667762606', 667762606, 4, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', 'Than Thu Mar Street'),
        ('safe_update_source_derived', 'osm:W:667762607', 667762607, 3, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', 'Than Thu Mar Street'),
        ('safe_insert', 'osm:W:674645204', 674645204, 8, '2026-06-29 02:54:48+00', 'name', 'ถนนแม่สอด-มุกดาหาร', 'und', NULL, NULL),
        ('safe_insert', 'osm:W:678974649', 678974649, 3, '2026-06-07 00:37:15+00', 'name:my', 'မန်းချောင်းတံတား', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:678974649', 678974649, 3, '2026-06-07 00:37:15+00', 'name', 'MAN Chaung Bridge', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:678974650', 678974650, 4, '2026-06-07 00:37:15+00', 'name', 'Pathein - Monywa Rd', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:681072180', 681072180, 4, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:685924213', 685924213, 8, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:685924214', 685924214, 9, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:702832577', 702832577, 2, '2026-06-20 03:25:26+00', 'name', 'ရွှေဘုံသာလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:702832578', 702832578, 2, '2026-06-20 03:24:31+00', 'name', 'ရွှေနဒီလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:702832580', 702832580, 2, '2026-06-20 03:24:14+00', 'name', 'ရွှေသိင်္ဂီလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:730331130', 730331130, 2, '2026-07-23 06:51:30+00', 'name', 'Sapal Road', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:738353752', 738353752, 3, '2026-06-11 14:53:29+00', 'name', 'Yan Naing Aye 3 Street', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:758286216', 758286216, 5, '2026-07-28 13:16:54+00', 'name', '金东路', 'und', NULL, NULL),
        ('safe_update_source_derived', 'osm:W:768072352', 768072352, 6, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayanta Road'),
        ('safe_insert', 'osm:W:768073535', 768073535, 4, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:768073537', 768073537, 6, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:768073539', 768073539, 2, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayanta Road'),
        ('safe_insert', 'osm:W:768073542', 768073542, 3, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:768073543', 768073543, 6, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:768073545', 768073545, 5, '2026-06-08 12:31:30+00', 'name:en', 'Lay Daungkan Road', 'en', 'Latn', 'Lay Daung Kan Road'),
        ('safe_update_source_derived', 'osm:W:900719422', 900719422, 10, '2026-07-27 06:03:56+00', 'name:en', 'Brotherhood Bridge', 'en', 'Latn', 'Brother Bridge'),
        ('safe_update_source_derived', 'osm:W:900719422', 900719422, 10, '2026-07-27 06:03:56+00', 'name:my', 'ညီအစ်ကိုတံတား', 'my', 'Mymr', 'ညီကိုတံတား'),
        ('safe_insert', 'osm:W:903640039', 903640039, 2, '2026-07-21 04:30:12+00', 'name', 'ရွှေတမာလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:917404196', 917404196, 3, '2026-08-06 19:56:45+00', 'name', 'India Border Road', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:917404202', 917404202, 3, '2026-08-06 19:56:45+00', 'name', 'India Border Road', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:917404203', 917404203, 4, '2026-08-06 19:56:45+00', 'name', 'India Border Road', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:933708974', 933708974, 2, '2026-08-05 06:14:37+00', 'name:my', 'ယင်းမာလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:933708974', 933708974, 2, '2026-08-05 06:14:37+00', 'name', 'Yinma Road', 'und', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:1007193151', 1007193151, 3, '2026-06-11 16:26:28+00', 'name:en', 'Yarzar Dirit Street', 'en', 'Latn', 'Yazadirit Road'),
        ('safe_update_source_derived', 'osm:W:1007193152', 1007193152, 2, '2026-06-11 16:26:28+00', 'name:en', 'Yarzar Dirit Street', 'en', 'Latn', 'Rarjardhirarj Road'),
        ('safe_insert', 'osm:W:1028452801', 1028452801, 5, '2026-07-21 12:05:48+00', 'name', 'ဆရာမွောင်လမ်း', 'und', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:1081939283', 1081939283, 4, '2026-06-14 12:58:09+00', 'name:en', 'Lower 94th Street', 'en', 'Latn', '94th Street'),
        ('safe_update_source_derived', 'osm:W:1081939283', 1081939283, 4, '2026-06-14 12:58:09+00', 'name:my', 'အောက် ၉၄ လမ်း', 'my', 'Mymr', '၉၄ လမ်း'),
        ('safe_update_source_derived', 'osm:W:1117629615', 1117629615, 3, '2026-06-19 12:15:05+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', 'Ngr Mang Aung Bhurarr Street'),
        ('safe_insert', 'osm:W:1185463813', 1185463813, 5, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1185466993', 1185466993, 7, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1190114093', 1190114093, 4, '2026-06-10 14:15:30+00', 'name:en', 'Nga Moe Yeik 5th Street', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:1190140572', 1190140572, 5, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayantar Road'),
        ('safe_update_source_derived', 'osm:W:1190140578', 1190140578, 2, '2026-06-08 12:31:30+00', 'name:en', 'Waizayandar Road', 'en', 'Latn', 'Waizayanta Road'),
        ('safe_insert', 'osm:W:1190141115', 1190141115, 7, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1190141821', 1190141821, 4, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:1190523805', 1190523805, 4, '2026-06-08 12:31:30+00', 'name:en', 'Lay Daungkan Road', 'en', 'Latn', 'Lay Daung Kan Road'),
        ('safe_insert', 'osm:W:1190523814', 1190523814, 3, '2026-06-08 12:31:30+00', 'name:my', 'သံသုမာလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1208958395', 1208958395, 2, '2026-06-20 03:30:44+00', 'name', 'တော်ဝင်ရတနာလမ်း', 'und', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:1214999552', 1214999552, 3, '2026-07-08 12:45:14+00', 'name:en', 'Aung Thu Kha Street 24', 'en', 'Latn', 'Aung Thu Kha Street 26'),
        ('safe_update_source_derived', 'osm:W:1214999552', 1214999552, 3, '2026-07-08 12:45:14+00', 'name:my', 'အောင်သုခ ၂၄ လမ်း', 'my', 'Mymr', 'အောင်သုခ ၂၆ လမ်း'),
        ('safe_insert', 'osm:W:1219935185', 1219935185, 14, '2026-06-15 12:05:37+00', 'name:en', 'Yangon-Dala Bridge', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1238864827', 1238864827, 6, '2026-06-08 12:31:30+00', 'name:en', 'Thitsar Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1238864827', 1238864827, 6, '2026-06-08 12:31:30+00', 'name:my', 'သစ္စာလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1316633561', 1316633561, 7, '2026-06-24 10:42:00+00', 'name:en', 'Thitsar Road', 'en', 'Latn', NULL),
        ('safe_update_source_derived', 'osm:W:1316633562', 1316633562, 3, '2026-06-08 12:31:30+00', 'name:en', 'Than Thu Mar Road', 'en', 'Latn', 'Thanthuma Street'),
        ('safe_update_source_derived', 'osm:W:1316633562', 1316633562, 3, '2026-06-08 12:31:30+00', 'name:my', 'သံသုမာလမ်း', 'my', 'Mymr', 'သံသုမာ လမ်း'),
        ('safe_insert', 'osm:W:1332601175', 1332601175, 6, '2026-08-03 08:45:53+00', 'name:en', 'A Myaing-Gyanbyin Dyke', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1332601175', 1332601175, 6, '2026-08-03 08:45:53+00', 'name:my', 'အမြိုင်းဂျမ်းပြင်တာ', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1335027883', 1335027883, 2, '2026-08-17 03:52:39+00', 'name', 'گلزار 2', 'und', NULL, NULL),
        ('safe_insert', 'osm:W:1336019417', 1336019417, 9, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1336019417', 1336019417, 9, '2026-06-08 16:46:11+00', 'name:my', 'ငါးမာန်အောင်ဘုရားလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1336019417', 1336019417, 9, '2026-06-08 16:46:11+00', 'name', 'ငါးမာန်အောင်ဘုရားလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1342361242', 1342361242, 5, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1342361242', 1342361242, 5, '2026-06-08 16:46:11+00', 'name:my', 'ငါးမာန်အောင်ဘုရားလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1342361242', 1342361242, 5, '2026-06-08 16:46:11+00', 'name', 'ငါးမာန်အောင်ဘုရားလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1375476802', 1375476802, 2, '2026-07-05 07:36:02+00', 'name', 'school', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389033326', 1389033326, 2, '2026-08-20 07:37:58+00', 'name:en', 'Siangsawn Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389033326', 1389033326, 2, '2026-08-20 07:37:58+00', 'name:my', 'ရှောင်စောန်းလမ်းကြား', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033326', 1389033326, 2, '2026-08-20 07:37:58+00', 'name', 'ရှောင်စောန်းလမ်းကြား', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033330', 1389033330, 3, '2026-07-21 12:18:40+00', 'name:en', 'SayarMuang Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389033330', 1389033330, 3, '2026-07-21 12:18:40+00', 'name:my', 'ဆရာမွောင်လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033330', 1389033330, 3, '2026-07-21 12:18:40+00', 'name', 'ဆရာမွောင်လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033331', 1389033331, 2, '2026-08-20 07:39:07+00', 'name:en', 'Moelin Siangsawn Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389033331', 1389033331, 2, '2026-08-20 07:39:07+00', 'name:my', 'မိုးလင်းရှောင်စောန်းလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033331', 1389033331, 2, '2026-08-20 07:39:07+00', 'name', 'မိုးလင်းရှောင်စောန်းလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033332', 1389033332, 2, '2026-08-20 07:41:43+00', 'name:en', 'Siangsawn Sayadaw Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389033332', 1389033332, 2, '2026-08-20 07:41:43+00', 'name:my', 'ရှောင်စောန်းဆရာ‌တော်လမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033332', 1389033332, 2, '2026-08-20 07:41:43+00', 'name', 'ရှောင်စောန်းဆရာ‌တော်လမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033333', 1389033333, 2, '2026-07-21 12:11:12+00', 'name', 'ရှောင်စောန်းလမ်းသွယ်၁', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033341', 1389033341, 2, '2026-07-28 04:12:55+00', 'name:en', 'Siangsawn Street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389033341', 1389033341, 2, '2026-07-28 04:12:55+00', 'name:my', 'ရှောင်စောန်းလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389033341', 1389033341, 2, '2026-07-28 04:12:55+00', 'name', 'ရှောင်စောန်းလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060003', 1389060003, 2, '2026-07-21 12:14:11+00', 'name:en', 'Siangsawn Church Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389060003', 1389060003, 2, '2026-07-21 12:14:11+00', 'name:my', 'ရှောင်စောန်းဘုရားကျောင်းဝင်းလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060003', 1389060003, 2, '2026-07-21 12:14:11+00', 'name', 'ရှောင်စောန်းဘုရားကျောင်းဝင်းလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060005', 1389060005, 2, '2026-07-21 12:16:18+00', 'name', 'ရှောင်စောန်းပါရှန်းဘုရားကျောင်းဝင်းဘေးလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060007', 1389060007, 2, '2026-08-20 07:37:20+00', 'name:en', 'Siangsawn Church Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389060007', 1389060007, 2, '2026-08-20 07:37:20+00', 'name:my', 'ရှောင်စောန်းဘုရားကျောင်းလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060007', 1389060007, 2, '2026-08-20 07:37:20+00', 'name', 'ရှောင်စောန်းဘုရားကျောင်းလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060008', 1389060008, 2, '2026-07-21 12:13:21+00', 'name:en', 'Siangsawn Church Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389060008', 1389060008, 2, '2026-07-21 12:13:21+00', 'name:my', 'ရှောင်စောန်းဘုရားကျောင်းဝင်းလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060008', 1389060008, 2, '2026-07-21 12:13:21+00', 'name', 'ရှောင်စောန်းဘုရားကျောင်းဝင်းလမ်း', 'und', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060013', 1389060013, 2, '2026-07-28 04:15:19+00', 'name:en', 'Siangsawn Pasian Church Quarter street', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1389060013', 1389060013, 2, '2026-07-28 04:15:19+00', 'name:my', 'ရှောင်စောန်းပါရှန်းဘုရားကျောင်းဝင်းလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1389060013', 1389060013, 2, '2026-07-28 04:15:19+00', 'name', 'ရှောင်စောန်းပါရှန်းဘုရားကျောင်းဝင်းလမ်း', 'und', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:1416317721', 1416317721, 3, '2026-06-19 12:32:11+00', 'name:en', 'Merchant Road', 'en', 'Latn', 'Merchant Street'),
        ('safe_insert', 'osm:W:1419990868', 1419990868, 3, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1420118798', 1420118798, 2, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', NULL),
        ('safe_insert', 'osm:W:1420118798', 1420118798, 2, '2026-06-08 16:46:11+00', 'name:my', 'ငါးမာန်အောင်ဘုရားလမ်း', 'my', 'Mymr', NULL),
        ('safe_insert', 'osm:W:1420118798', 1420118798, 2, '2026-06-08 16:46:11+00', 'name', 'ငါးမာန်အောင်ဘုရားလမ်း', 'und', 'Mymr', NULL),
        ('safe_update_source_derived', 'osm:W:1420124143', 1420124143, 4, '2026-06-08 16:46:11+00', 'name:en', 'Ngar Man Aung Pagoda Road', 'en', 'Latn', 'Ngr Mar Aung Pagoda Road'),
        ('safe_insert', 'osm:W:1465209169', 1465209169, 2, '2026-06-24 14:16:45+00', 'name', 'Anlangh Highway', 'und', 'Latn', NULL),
        ('safe_insert', 'osm:W:1488766975', 1488766975, 4, '2026-06-08 12:39:11+00', 'name:en', 'Yinmar Street', 'en', 'Latn', NULL);

DO $$
BEGIN
    IF (SELECT count(*) FROM temp_source_fresh_safe_names WHERE action = 'safe_insert') <> 287
       OR (SELECT count(*) FROM temp_source_fresh_safe_names WHERE action = 'safe_update_source_derived') <> 62 THEN
        RAISE EXCEPTION 'generated safe-action payload is incomplete';
    END IF;
END
$$;

CREATE TEMP TABLE temp_source_fresh_updated ON COMMIT DROP AS
WITH updated AS (
    UPDATE core.core_street_names AS existing
    SET
        name = candidate.candidate_name,
        script_code = candidate.script_code,
        source_refs = existing.source_refs || jsonb_build_object(
            'source', 'osm',
            'source_field', 'osm.pbf.tags',
            'source_tag', candidate.source_tag,
            'source_snapshot_version', 'osm_myanmar_2026_08_23_street_names_v1',
            'source_snapshot_sha256', 'e64c3e2f2a67ca4d7b8b61aa0883e6414db27539b435b3ea895bcde9e18c1dfb',
            'osm_way_id', candidate.osm_way_id,
            'osm_version', candidate.osm_version,
            'osm_timestamp', candidate.osm_timestamp,
            'previous_name', existing.name,
            'migration', '194_source_fresh_street_name_refresh'
        )
    FROM temp_source_fresh_safe_names AS candidate
    JOIN core.core_streets AS street
      ON street.external_id = candidate.external_id
     AND street.external_id = 'osm:W:' || candidate.osm_way_id::text
     AND street.is_active IS TRUE
     AND street.deleted_at IS NULL
    WHERE candidate.action = 'safe_update_source_derived'
      AND existing.street_id = street.id
      AND coalesce(nullif(lower(btrim(existing.language_code)), ''), 'und') = candidate.language_code
      AND existing.is_primary IS TRUE
      AND lower(btrim(existing.name_type)) IN ('official', 'primary')
      AND existing.name = candidate.expected_existing_name
      AND lower(coalesce(existing.source_refs ->> 'source', '')) = 'osm'
      AND existing.source_refs ->> 'source_tag' = candidate.source_tag
      AND lower(coalesce(existing.source_refs ->> 'source_field', ''))
            IN ('normalized_data.tags', 'osm.pbf.tags')
      AND street.manual_override IS NOT TRUE
      AND street.is_verified IS NOT TRUE
      AND lower(coalesce(street.source_refs ->> 'source', '')) NOT IN ('dashboard', 'manual')
      AND lower(coalesce(street.source_refs ->> 'origin', '')) NOT IN ('dashboard', 'manual')
      AND NOT EXISTS (
          SELECT 1
          FROM core.core_street_names AS other
          WHERE other.street_id = existing.street_id
            AND other.id <> existing.id
            AND coalesce(nullif(lower(btrim(other.language_code)), ''), 'und') = candidate.language_code
            AND other.is_primary IS TRUE
            AND lower(btrim(other.name_type)) IN ('official', 'primary')
            AND nullif(btrim(other.name), '') IS NOT NULL
            AND btrim(other.name) !~* '^(road|street)[_-][0-9]+$'
            AND btrim(other.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
            AND btrim(other.name) !~* '^osm([_:/-]|$)'
            AND btrim(other.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
      )
    RETURNING existing.id
)
SELECT id FROM updated;

DO $$
BEGIN
    IF (SELECT count(*) FROM temp_source_fresh_updated) <> 62 THEN
        RAISE EXCEPTION 'database drift: expected 62 safe OSM-managed updates, got %',
            (SELECT count(*) FROM temp_source_fresh_updated);
    END IF;
END
$$;

CREATE TEMP TABLE temp_source_fresh_inserted ON COMMIT DROP AS
WITH inserted AS (
    INSERT INTO core.core_street_names (
        street_id, name, language_code, script_code,
        name_type, is_primary, source_refs
    )
    SELECT
        street.id,
        candidate.candidate_name,
        candidate.language_code,
        candidate.script_code,
        'primary',
        true,
        jsonb_build_object(
            'source', 'osm',
            'source_field', 'osm.pbf.tags',
            'source_tag', candidate.source_tag,
            'source_snapshot_version', 'osm_myanmar_2026_08_23_street_names_v1',
            'source_snapshot_sha256', 'e64c3e2f2a67ca4d7b8b61aa0883e6414db27539b435b3ea895bcde9e18c1dfb',
            'osm_way_id', candidate.osm_way_id,
            'osm_version', candidate.osm_version,
            'osm_timestamp', candidate.osm_timestamp,
            'migration', '194_source_fresh_street_name_refresh'
        )
    FROM temp_source_fresh_safe_names AS candidate
    JOIN core.core_streets AS street
      ON street.external_id = candidate.external_id
     AND street.external_id = 'osm:W:' || candidate.osm_way_id::text
     AND street.is_active IS TRUE
     AND street.deleted_at IS NULL
    WHERE candidate.action = 'safe_insert'
      AND street.manual_override IS NOT TRUE
      AND street.is_verified IS NOT TRUE
      AND lower(coalesce(street.source_refs ->> 'source', '')) NOT IN ('dashboard', 'manual')
      AND lower(coalesce(street.source_refs ->> 'origin', '')) NOT IN ('dashboard', 'manual')
      AND NOT EXISTS (
          SELECT 1
          FROM core.core_street_names AS existing
          WHERE existing.street_id = street.id
            AND coalesce(nullif(lower(btrim(existing.language_code)), ''), 'und') = candidate.language_code
            AND existing.is_primary IS TRUE
            AND lower(btrim(existing.name_type)) IN ('official', 'primary')
            AND nullif(btrim(existing.name), '') IS NOT NULL
            AND btrim(existing.name) !~* '^(road|street)[_-][0-9]+$'
            AND btrim(existing.name) !~* '^unnamed(?:[[:space:]_-].*)?$'
            AND btrim(existing.name) !~* '^osm([_:/-]|$)'
            AND btrim(existing.name) !~* '^(node|way|relation)[/:[:space:]_-]*[0-9]+$'
      )
    RETURNING id
)
SELECT id FROM inserted;

DO $$
BEGIN
    IF (SELECT count(*) FROM temp_source_fresh_inserted) <> 287 THEN
        RAISE EXCEPTION 'database drift: expected 287 safe inserts, got %',
            (SELECT count(*) FROM temp_source_fresh_inserted);
    END IF;
END
$$;

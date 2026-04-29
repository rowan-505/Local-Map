erDiagram

    %% =========================================================
    %% REFERENCE
    %% =========================================================

    ref_admin_levels {
        bigint id PK
        text code UK
        text name
        int rank
    }

    ref_poi_categories {
        bigint id PK
        bigint parent_id FK
        text code UK
        text name
        text name_local
        text icon_key
        boolean is_searchable
        boolean is_public
        int sort_order
    }

    ref_source_types {
        bigint id PK
        text code UK
        text name
    }

    ref_report_types {
        bigint id PK
        text code UK
        text name
    }

    ref_report_statuses {
        bigint id PK
        text code UK
        text name
    }

    ref_validation_task_types {
        bigint id PK
        text code UK
        text name
    }

    ref_validation_statuses {
        bigint id PK
        text code UK
        text name
    }

    ref_publish_statuses {
        bigint id PK
        text code UK
        text name
    }

    ref_address_component_types {
        bigint id PK
        text code UK
        text name
        int rank
    }

    ref_offline_package_types {
        bigint id PK
        text code UK
        text name
    }

    ref_place_classes {
        bigint id PK
        text code UK
        text name
    }

    ref_road_classes {
        bigint id PK
        text code UK
        text name
    }

    %% =========================================================
    %% AUTH
    %% =========================================================

    auth_users {
        bigint id PK
        uuid public_id UK
        text email UK
        text display_name
        text password_hash
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
        timestamptz last_login_at
    }

    auth_roles {
        bigint id PK
        text code UK
        text name
        text description
    }

    auth_user_roles {
        bigint user_id PK, FK
        bigint role_id PK, FK
        timestamptz assigned_at
        bigint assigned_by FK
    }

    auth_user_devices {
        bigint id PK
        bigint user_id FK
        text device_type
        text platform
        text app_version
        text push_token
        text device_label
        boolean is_active
        timestamptz last_seen_at
        timestamptz created_at
        timestamptz updated_at
    }

    %% =========================================================
    %% APP USER FOUNDATION
    %% =========================================================

    app_user_profiles {
        bigint user_id PK, FK
        text username UK
        text display_name
        text avatar_url
        text preferred_language
        bigint home_admin_area_id FK
        text timezone
        timestamptz created_at
        timestamptz updated_at
    }

    app_user_preferences {
        bigint user_id PK, FK
        text preferred_map_language
        text distance_unit
        text theme
        double default_lat
        double default_lng
        numeric default_zoom
        boolean allow_location_access
        boolean allow_background_location
        boolean allow_push_notifications
        boolean allow_arrival_notifications
        boolean allow_low_battery_alerts
        text default_location_precision_mode
        int history_retention_days
        timestamptz created_at
        timestamptz updated_at
    }

    app_user_saved_places {
        bigint id PK
        bigint user_id FK
        bigint place_id FK
        text save_type
        text label
        text note
        timestamptz created_at
        timestamptz updated_at
    }

    %% =========================================================
    %% SOCIAL / FAMILY LIVE SHARING
    %% =========================================================

    social_family_groups {
        bigint id PK
        uuid public_id UK
        text name
        text group_type
        bigint created_by FK
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    social_family_group_members {
        bigint group_id PK, FK
        bigint user_id PK, FK
        text role_in_group
        text membership_status
        bigint invited_by FK
        timestamptz joined_at
        timestamptz created_at
    }

    social_location_share_rules {
        bigint id PK
        bigint owner_user_id FK
        bigint viewer_user_id FK
        bigint group_id FK
        text share_mode
        text precision_mode
        text time_scope
        timestamptz starts_at
        timestamptz expires_at
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    social_safety_places {
        bigint id PK
        bigint user_id FK
        bigint place_id FK
        bigint address_id FK
        text label
        geometry geom
        numeric radius_m
        text place_type
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    social_location_events {
        bigint id PK
        bigint user_id FK
        bigint group_id FK
        text event_type
        bigint related_place_id FK
        bigint related_address_id FK
        geometry geom
        timestamptz occurred_at
        jsonb metadata
    }

    %% =========================================================
    %% REALTIME LOCATION
    %% =========================================================

    realtime_user_presence_locations {
        bigint user_id PK, FK
        geometry geom
        double lat
        double lng
        numeric accuracy_m
        numeric heading
        numeric speed_mps
        numeric altitude_m
        int battery_level
        boolean is_moving
        text visibility_status
        text sharing_status
        timestamptz captured_at
        timestamptz received_at
        timestamptz updated_at
    }

    realtime_location_sessions {
        bigint id PK
        bigint user_id FK
        bigint group_id FK
        text session_type
        text status
        geometry start_geom
        geometry end_geom
        timestamptz started_at
        timestamptz ended_at
        timestamptz created_at
    }

    realtime_user_location_history {
        bigint id PK
        bigint user_id FK
        bigint session_id FK
        geometry geom
        double lat
        double lng
        numeric accuracy_m
        numeric heading
        numeric speed_mps
        numeric altitude_m
        int battery_level
        timestamptz captured_at
        timestamptz received_at
    }

    %% =========================================================
    %% CORE ADMIN GEOGRAPHY
    %% =========================================================

    core_admin_areas {
        bigint id PK
        bigint parent_id FK
        bigint admin_level_id FK
        text canonical_name
        text slug UK
        geometry geom
        geometry centroid
        bigint source_type_id FK
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    core_admin_area_names {
        bigint id PK
        bigint admin_area_id FK
        text name
        text language_code
        text script_code
        text name_type
        boolean is_primary
        int search_weight
    }

    %% =========================================================
    %% CORE PLACES
    %% =========================================================

    core_places {
        bigint id PK
        uuid public_id UK
        text primary_name
        text secondary_name
        text name_local
        text display_name
        bigint category_id FK
        bigint admin_area_id FK
        geometry point_geom
        geometry entry_geom
        geometry footprint_geom
        double lat
        double lng
        text plus_code
        numeric importance_score
        numeric popularity_score
        numeric confidence_score
        boolean is_public
        boolean is_verified
        bigint source_type_id FK
        bigint publish_status_id FK
        bigint current_version_id FK
        timestamptz created_at
        timestamptz updated_at
        timestamptz deleted_at
    }

    core_place_names {
        bigint id PK
        bigint place_id FK
        text name
        text language_code
        text script_code
        text name_type
        boolean is_primary
        int search_weight
    }

    core_place_contacts {
        bigint id PK
        bigint place_id FK
        text phone
        text website
        text facebook_url
        text opening_hours
        text email
    }

    core_place_sources {
        bigint id PK
        bigint place_id FK
        bigint source_type_id FK
        text external_id
        text source_name
        text source_url
        int source_priority
        timestamptz captured_at
        jsonb raw_payload
    }

    core_place_versions {
        bigint id PK
        bigint place_id FK
        int version_no
        jsonb snapshot_data
        bigint publish_status_id FK
        bigint created_by FK
        timestamptz created_at
        timestamptz published_at
        bigint approved_by FK
    }

    core_place_media {
        bigint id PK
        bigint place_id FK
        text media_type
        text storage_url
        text caption
        bigint uploaded_by FK
        timestamptz created_at
    }

    %% =========================================================
    %% ADDRESS SYSTEM
    %% =========================================================

    core_streets {
        bigint id PK
        uuid public_id UK
        text canonical_name
        geometry geom
        bigint admin_area_id FK
        bigint source_type_id FK
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    core_street_names {
        bigint id PK
        bigint street_id FK
        text name
        text language_code
        text script_code
        text name_type
        boolean is_primary
    }

    core_addresses {
        bigint id PK
        uuid public_id UK
        text full_address
        text house_number
        text unit_number
        bigint street_id FK
        bigint admin_area_id FK
        geometry point_geom
        geometry entrance_geom
        text postal_code
        bigint source_type_id FK
        boolean is_public
        boolean is_verified
        timestamptz created_at
        timestamptz updated_at
    }

    core_address_components {
        bigint id PK
        bigint address_id FK
        bigint component_type_id FK
        text component_value
        int sort_order
    }

    core_address_ranges {
        bigint id PK
        bigint street_id FK
        text side
        text from_number
        text to_number
        geometry geom
        bigint admin_area_id FK
    }

    core_place_addresses {
        bigint place_id PK, FK
        bigint address_id PK, FK
        text relation_type
        boolean is_primary
    }

    %% =========================================================
    %% TRANSIT
    %% =========================================================

    core_bus_routes {
        bigint id PK
        text route_code UK
        text public_name
        text operator_name
        text route_type
        text directionality
        boolean is_active
        bigint source_type_id FK
        timestamptz created_at
        timestamptz updated_at
    }

    core_bus_route_names {
        bigint id PK
        bigint route_id FK
        text name
        text language_code
        text name_type
        boolean is_primary
    }

    core_bus_route_variants {
        bigint id PK
        bigint route_id FK
        text variant_code
        text direction_name
        text origin_name
        text destination_name
        geometry geom
        numeric distance_m
        boolean is_active
    }

    core_bus_stops {
        bigint id PK
        uuid public_id UK
        text name
        text name_local
        text stop_code
        geometry geom
        bigint admin_area_id FK
        bigint source_type_id FK
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    core_bus_stop_names {
        bigint id PK
        bigint stop_id FK
        text name
        text language_code
        text name_type
        boolean is_primary
    }

    core_bus_route_stops {
        bigint route_variant_id PK, FK
        bigint stop_id PK, FK
        int stop_sequence PK
        numeric distance_from_start_m
        boolean is_timing_point
    }

    %% =========================================================
    %% ROUTING GRAPH
    %% =========================================================

    routing_road_nodes {
        bigint id PK
        geometry geom
        bigint admin_area_id FK
    }

    routing_road_edges {
        bigint id PK
        bigint from_node_id FK
        bigint to_node_id FK
        geometry geom
        text road_class
        boolean is_oneway
        numeric length_m
        numeric cost_forward
        numeric cost_reverse
        bigint source_type_id FK
        boolean is_active
    }

    routing_turn_restrictions {
        bigint id PK
        bigint via_node_id FK
        bigint from_edge_id FK
        bigint to_edge_id FK
        text restriction_type
        boolean is_active
    }

    routing_edge_names {
        bigint id PK
        bigint edge_id FK
        text name
        text language_code
        boolean is_primary
    }

    %% =========================================================
    %% RAW LAYER
    %% =========================================================

    raw_osm_points {
        bigint id PK
        bigint source_snapshot_id FK
        text osm_feature_type
        text osm_id
        geometry geom
        jsonb tags
        jsonb raw_payload
        timestamptz ingested_at
    }

    raw_osm_lines {
        bigint id PK
        bigint source_snapshot_id FK
        text osm_feature_type
        text osm_id
        geometry geom
        jsonb tags
        jsonb raw_payload
        timestamptz ingested_at
    }

    raw_osm_polygons {
        bigint id PK
        bigint source_snapshot_id FK
        text osm_feature_type
        text osm_id
        geometry geom
        jsonb tags
        jsonb raw_payload
        timestamptz ingested_at
    }

    %% =========================================================
    %% STAGING LAYER
    %% =========================================================

    staging_place_candidates {
        bigint id PK
        bigint source_snapshot_id FK
        text source_entity_type
        text external_id
        text canonical_name
        bigint place_class_id FK
        bigint poi_category_id FK
        bigint admin_area_candidate_id FK
        geometry point_geom
        numeric confidence_score
        text match_status
        bigint matched_core_place_id FK
        jsonb normalized_data
        jsonb source_refs
        timestamptz created_at
        timestamptz updated_at
    }

    staging_place_name_candidates {
        bigint id PK
        bigint place_candidate_id FK
        text name
        text language_code
        text script_code
        text name_type
        boolean is_primary
        int search_weight
    }

    staging_admin_area_candidates {
        bigint id PK
        bigint source_snapshot_id FK
        text external_id
        text canonical_name
        bigint admin_level_id FK
        bigint parent_candidate_id FK
        geometry geom
        geometry centroid
        numeric confidence_score
        text match_status
        bigint matched_core_admin_area_id FK
        jsonb normalized_data
        jsonb source_refs
        timestamptz created_at
        timestamptz updated_at
    }

    staging_road_candidates {
        bigint id PK
        bigint source_snapshot_id FK
        text external_id
        text canonical_name
        bigint road_class_id FK
        geometry geom
        boolean is_oneway
        numeric length_m
        numeric confidence_score
        text match_status
        bigint matched_core_edge_id FK
        jsonb normalized_data
        jsonb source_refs
        timestamptz created_at
        timestamptz updated_at
    }

    staging_bus_stop_candidates {
        bigint id PK
        bigint source_snapshot_id FK
        text external_id
        text canonical_name
        geometry point_geom
        bigint admin_area_candidate_id FK
        numeric confidence_score
        text match_status
        bigint matched_core_bus_stop_id FK
        jsonb normalized_data
        jsonb source_refs
        timestamptz created_at
        timestamptz updated_at
    }

    staging_bus_route_candidates {
        bigint id PK
        bigint source_snapshot_id FK
        text external_id
        text route_code
        text public_name
        geometry geom
        numeric confidence_score
        text match_status
        bigint matched_core_bus_route_id FK
        jsonb normalized_data
        jsonb source_refs
        timestamptz created_at
        timestamptz updated_at
    }

    %% =========================================================
    %% SYSTEM LAYER
    %% =========================================================

    system_source_registry {
        bigint id PK
        text source_code UK
        text source_name
        text source_type
        text source_uri
        boolean is_active
        jsonb config
        timestamptz created_at
        timestamptz updated_at
    }

    system_import_batches {
        bigint id PK
        bigint source_registry_id FK
        text batch_name
        text trigger_type
        text status
        bigint started_by FK
        timestamptz started_at
        timestamptz finished_at
        text note
    }

    system_source_snapshots {
        bigint id PK
        bigint source_registry_id FK
        bigint import_batch_id FK
        text snapshot_ref
        text snapshot_version
        text region_code
        text checksum
        timestamptz captured_at
        timestamptz created_at
    }

    system_diff_runs {
        bigint id PK
        bigint previous_snapshot_id FK
        bigint current_snapshot_id FK
        text entity_family
        text status
        timestamptz started_at
        timestamptz finished_at
        jsonb summary
    }

    system_diff_items {
        bigint id PK
        bigint diff_run_id FK
        text entity_family
        text diff_type
        text external_id
        bigint local_entity_id
        jsonb before_data
        jsonb after_data
        numeric confidence_score
        text auto_action
        text review_status
        timestamptz created_at
    }

    system_conflict_queue {
        bigint id PK
        bigint diff_item_id FK
        text conflict_type
        text resolution_status
        bigint assigned_to FK
        text resolution_note
        timestamptz created_at
        timestamptz resolved_at
    }

    system_review_tasks {
        bigint id PK
        text entity_family
        bigint entity_id
        bigint task_type_id FK
        bigint status_id FK
        bigint assigned_to FK
        int priority
        text note
        timestamptz created_at
        timestamptz resolved_at
    }

    system_review_logs {
        bigint id PK
        text entity_family
        bigint entity_id
        bigint reviewer_user_id FK
        text action_type
        jsonb before_snapshot
        jsonb after_snapshot
        text reason
        timestamptz created_at
    }

    system_publish_batches {
        bigint id PK
        text batch_name
        bigint created_by FK
        bigint approved_by FK
        text status
        timestamptz created_at
        timestamptz published_at
        text note
    }

    system_publish_items {
        bigint id PK
        bigint publish_batch_id FK
        text entity_family
        bigint entity_id
        bigint version_id
        text publish_action
        text publish_status
        timestamptz created_at
    }

    %% =========================================================
    %% USER REPORTS / FEEDBACK
    %% =========================================================

    feedback_user_reports {
        bigint id PK
        uuid public_id UK
        bigint report_type_id FK
        bigint status_id FK
        bigint reported_by_user_id FK
        text entity_type
        bigint entity_id
        geometry report_geom
        text title
        text description
        timestamptz created_at
        timestamptz resolved_at
        bigint resolved_by FK
    }

    feedback_user_report_comments {
        bigint id PK
        bigint report_id FK
        bigint user_id FK
        text comment_body
        timestamptz created_at
    }

    feedback_user_report_media {
        bigint id PK
        bigint report_id FK
        text storage_url
        text media_type
        timestamptz created_at
    }

    %% =========================================================
    %% SEARCH LAYER
    %% =========================================================

    search_place_search {
        bigint place_id PK, FK
        text display_name
        text all_names
        text category_name
        text admin_path
        tsvector search_document
        numeric search_rank_base
        geometry point_geom
    }

    search_address_search {
        bigint address_id PK, FK
        text full_address
        text all_tokens
        tsvector search_document
        geometry point_geom
    }

    %% =========================================================
    %% TILES / DELIVERY
    %% =========================================================

    tiles_poi_public_v {
        bigint id PK
        text name
        text category
        numeric importance_score
        geometry geom
    }

    tiles_bus_stops_public_v {
        bigint id PK
        text name
        text stop_code
        geometry geom
    }

    tiles_bus_routes_public_v {
        bigint id PK
        text route_code
        text public_name
        geometry geom
    }

    %% =========================================================
    %% OFFLINE
    %% =========================================================

    core_offline_regions {
        bigint id PK
        uuid public_id UK
        text code UK
        text name
        geometry geom
        bigint admin_area_id FK
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
    }

    core_offline_packages {
        bigint id PK
        uuid public_id UK
        bigint region_id FK
        bigint package_type_id FK
        text version_code
        text manifest_url
        text checksum
        bigint size_bytes
        timestamptz built_at
        boolean is_active
    }

    core_offline_package_items {
        bigint id PK
        bigint package_id FK
        text item_type
        text item_ref
        bigint size_bytes
    }

    %% =========================================================
    %% RELATIONSHIPS
    %% =========================================================

    ref_admin_levels ||--o{ core_admin_areas : defines
    ref_source_types ||--o{ core_admin_areas : source
    core_admin_areas ||--o{ core_admin_areas : parent_of
    core_admin_areas ||--o{ core_admin_area_names : has_names

    ref_poi_categories ||--o{ core_places : categorizes
    ref_source_types ||--o{ core_places : source
    ref_publish_statuses ||--o{ core_places : publish_status
    core_admin_areas ||--o{ core_places : contains

    core_places ||--o{ core_place_names : has
    core_places ||--o{ core_place_contacts : has
    core_places ||--o{ core_place_sources : has
    core_places ||--o{ core_place_versions : versioned_as
    core_places ||--o{ core_place_media : has_media
    ref_source_types ||--o{ core_place_sources : typed_by
    ref_publish_statuses ||--o{ core_place_versions : status

    auth_users ||--o{ auth_user_roles : has
    auth_roles ||--o{ auth_user_roles : assigned
    auth_users ||--o{ auth_user_devices : uses
    auth_users ||--|| app_user_profiles : has_profile
    auth_users ||--|| app_user_preferences : has_preferences
    auth_users ||--o{ app_user_saved_places : saves_places
    core_places ||--o{ app_user_saved_places : saved_by_users

    auth_users ||--o{ core_place_versions : created_by

    auth_users ||--o{ social_family_groups : creates
    social_family_groups ||--o{ social_family_group_members : has_members
    auth_users ||--o{ social_family_group_members : joins
    auth_users ||--o{ social_location_share_rules : owns_share_rules
    auth_users ||--o{ social_location_share_rules : views_shared_locations
    social_family_groups ||--o{ social_location_share_rules : group_scope
    auth_users ||--o{ social_safety_places : defines_safety_places
    core_places ||--o{ social_safety_places : used_as_safety_place
    core_addresses ||--o{ social_safety_places : used_as_safety_address
    auth_users ||--o{ social_location_events : triggers_events
    social_family_groups ||--o{ social_location_events : receives_events
    core_places ||--o{ social_location_events : related_place
    core_addresses ||--o{ social_location_events : related_address

    auth_users ||--|| realtime_user_presence_locations : has_latest_location
    auth_users ||--o{ realtime_location_sessions : has_sessions
    social_family_groups ||--o{ realtime_location_sessions : shared_in_group
    auth_users ||--o{ realtime_user_location_history : generates_history
    realtime_location_sessions ||--o{ realtime_user_location_history : contains_points

    core_admin_areas ||--o{ app_user_profiles : home_area

    core_admin_areas ||--o{ core_streets : contains
    ref_source_types ||--o{ core_streets : source
    core_streets ||--o{ core_street_names : has_names

    core_streets ||--o{ core_addresses : on_street
    core_admin_areas ||--o{ core_addresses : contains
    ref_source_types ||--o{ core_addresses : source
    core_addresses ||--o{ core_address_components : has_parts
    ref_address_component_types ||--o{ core_address_components : typed_by
    core_streets ||--o{ core_address_ranges : has_ranges
    core_admin_areas ||--o{ core_address_ranges : contains
    core_places ||--o{ core_place_addresses : linked_to
    core_addresses ||--o{ core_place_addresses : linked_to

    ref_source_types ||--o{ core_bus_routes : source
    core_bus_routes ||--o{ core_bus_route_names : has_names
    core_bus_routes ||--o{ core_bus_route_variants : has
    core_admin_areas ||--o{ core_bus_stops : contains
    ref_source_types ||--o{ core_bus_stops : source
    core_bus_stops ||--o{ core_bus_stop_names : has_names
    core_bus_route_variants ||--o{ core_bus_route_stops : ordered_stops
    core_bus_stops ||--o{ core_bus_route_stops : included_in

    core_admin_areas ||--o{ routing_road_nodes : contains
    routing_road_nodes ||--o{ routing_road_edges : from_node
    routing_road_nodes ||--o{ routing_road_edges : to_node
    routing_road_edges ||--o{ routing_turn_restrictions : from_edge
    routing_road_edges ||--o{ routing_turn_restrictions : to_edge
    routing_road_nodes ||--o{ routing_turn_restrictions : via_node
    routing_road_edges ||--o{ routing_edge_names : has_names
    ref_source_types ||--o{ routing_road_edges : source

    ref_place_classes ||--o{ staging_place_candidates : classifies
    ref_poi_categories ||--o{ staging_place_candidates : categorizes
    ref_admin_levels ||--o{ staging_admin_area_candidates : level
    ref_road_classes ||--o{ staging_road_candidates : classifies

    system_source_registry ||--o{ system_import_batches : has_batches
    system_source_registry ||--o{ system_source_snapshots : has_snapshots
    system_import_batches ||--o{ system_source_snapshots : creates
    system_source_snapshots ||--o{ raw_osm_points : contains
    system_source_snapshots ||--o{ raw_osm_lines : contains
    system_source_snapshots ||--o{ raw_osm_polygons : contains

    system_source_snapshots ||--o{ staging_place_candidates : derives
    system_source_snapshots ||--o{ staging_admin_area_candidates : derives
    system_source_snapshots ||--o{ staging_road_candidates : derives
    system_source_snapshots ||--o{ staging_bus_stop_candidates : derives
    system_source_snapshots ||--o{ staging_bus_route_candidates : derives

    staging_place_candidates ||--o{ staging_place_name_candidates : has_names
    staging_admin_area_candidates ||--o{ staging_admin_area_candidates : parent_of

    core_places ||--o{ staging_place_candidates : matched_from
    core_admin_areas ||--o{ staging_admin_area_candidates : matched_from
    routing_road_edges ||--o{ staging_road_candidates : matched_from
    core_bus_stops ||--o{ staging_bus_stop_candidates : matched_from
    core_bus_routes ||--o{ staging_bus_route_candidates : matched_from
    staging_admin_area_candidates ||--o{ staging_place_candidates : contains
    staging_admin_area_candidates ||--o{ staging_bus_stop_candidates : contains

    auth_users ||--o{ system_import_batches : starts
    auth_users ||--o{ system_conflict_queue : assigned
    auth_users ||--o{ system_review_tasks : assigned
    auth_users ||--o{ system_review_logs : reviews
    auth_users ||--o{ system_publish_batches : creates

    system_source_snapshots ||--o{ system_diff_runs : previous
    system_source_snapshots ||--o{ system_diff_runs : current
    system_diff_runs ||--o{ system_diff_items : produces
    system_diff_items ||--o{ system_conflict_queue : conflicts

    ref_validation_task_types ||--o{ system_review_tasks : task_type
    ref_validation_statuses ||--o{ system_review_tasks : status

    system_publish_batches ||--o{ system_publish_items : includes

    ref_report_types ||--o{ feedback_user_reports : type
    ref_report_statuses ||--o{ feedback_user_reports : status
    auth_users ||--o{ feedback_user_reports : reports
    auth_users ||--o{ feedback_user_report_comments : comments
    feedback_user_reports ||--o{ feedback_user_report_comments : has_comments
    feedback_user_reports ||--o{ feedback_user_report_media : has_media

    core_places ||--o| search_place_search : indexed_as
    core_addresses ||--o| search_address_search : indexed_as

    core_places ||--o| tiles_poi_public_v : exposed_as
    core_bus_stops ||--o| tiles_bus_stops_public_v : exposed_as
    core_bus_route_variants ||--o| tiles_bus_routes_public_v : exposed_as

    core_admin_areas ||--o{ core_offline_regions : defines
    ref_offline_package_types ||--o{ core_offline_packages : type
    core_offline_regions ||--o{ core_offline_packages : has
    core_offline_packages ||--o{ core_offline_package_items : contains
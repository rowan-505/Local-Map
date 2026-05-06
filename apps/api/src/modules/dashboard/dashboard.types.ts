/** GET /dashboard/stats — aggregated table row counts + health splits. */

export type DashboardStatsMainCounts = {
    places: number;
    map_buildings: number;
    streets: number;
    admin_areas: number;
    addresses: number;
};

export type DashboardStatsMetadataCounts = {
    place_names: number;
    street_names: number;
    admin_area_names: number;
    place_contacts: number;
    place_sources: number;
    place_media: number;
    place_versions: number;
};

export type DashboardStatsTransitCounts = {
    bus_routes: number;
    bus_route_variants: number;
    bus_stops: number;
    bus_route_stops: number;
};

export type DashboardStatsHealthCounts = {
    places_active: number;
    places_deleted: number;
    places_verified: number;
    places_unverified: number;
    buildings_active: number;
    buildings_deleted: number;
    streets_active: number;
    streets_inactive: number;
};

export type DashboardStatsOverview = {
    /** Sum of rows in {@link DashboardStatsMainCounts}. */
    total_main_rows: number;
    /** Sum of rows across metadata tables. */
    total_metadata_rows: number;
    /** Sum of rows across transit tables. */
    total_transit_rows: number;
};

export type DashboardStatsResponse = {
    overview: DashboardStatsOverview;
    main: DashboardStatsMainCounts;
    metadata: DashboardStatsMetadataCounts;
    transit: DashboardStatsTransitCounts;
    health: DashboardStatsHealthCounts;
};

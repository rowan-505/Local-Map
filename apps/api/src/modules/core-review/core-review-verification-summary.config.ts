import type { VerificationSummaryEntityConfig } from "../../lib/verification-summary/verification-summary.types.js";

/** Core Review overview verification counts — core schema. */
export const CORE_REVIEW_VERIFICATION_SUMMARY_CONFIGS: readonly VerificationSummaryEntityConfig[] = [
    {
        family: "buildings",
        label: "Buildings",
        table: "core.core_buildings",
        path: "buildings",
        idColumns: ["id"],
    },
    {
        family: "places",
        label: "Places",
        table: "core.core_places",
        path: "places",
        idColumns: ["id"],
    },
    {
        family: "roads",
        label: "Roads",
        table: "core.core_streets",
        path: "roads",
        idColumns: ["id"],
    },
    {
        family: "land-areas",
        label: "Land areas",
        table: "core.core_land_areas",
        path: "land-areas",
        idColumns: ["id"],
    },
    {
        family: "water_lines",
        label: "Water lines",
        table: "core.core_water_lines",
        path: "water-lines",
        idColumns: ["id"],
    },
    {
        family: "water_polygons",
        label: "Water polygons",
        table: "core.core_water_polygons",
        path: "water-polygons",
        idColumns: ["id"],
    },
    {
        family: "addresses",
        label: "Addresses",
        table: "core.core_addresses",
        path: "addresses",
        idColumns: ["id"],
    },
    {
        family: "admin_areas",
        label: "Admin areas",
        table: "core.core_admin_areas",
        path: "admin-areas",
        idColumns: ["id"],
    },
];

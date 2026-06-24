import { coreReviewPath } from "@/src/lib/dashboardNavigation";

export type CoreReviewOverviewSourceSchema = "core";

export type CoreReviewOverviewAccess = "editable" | "read-only";

export type CoreReviewOverviewModule = {
    segment: string;
    title: string;
    description: string;
    href: string;
    sourceTable: string;
    sourceSchema: CoreReviewOverviewSourceSchema;
    access: CoreReviewOverviewAccess;
};

export const CORE_REVIEW_OVERVIEW_MODULES: readonly CoreReviewOverviewModule[] = [
    {
        segment: "buildings",
        title: "Buildings",
        description: "Building footprints with verification status and geometry review.",
        href: coreReviewPath("buildings"),
        sourceTable: "core.core_map_buildings",
        sourceSchema: "core",
        access: "editable",
    },
    {
        segment: "places",
        title: "Places",
        description: "Points of interest linked to categories and admin areas.",
        href: coreReviewPath("places"),
        sourceTable: "core.core_places",
        sourceSchema: "core",
        access: "editable",
    },
    {
        segment: "roads",
        title: "Roads",
        description: "Street centerlines, road classes, and routing geometry.",
        href: coreReviewPath("roads"),
        sourceTable: "core.core_streets",
        sourceSchema: "core",
        access: "read-only",
    },
    {
        segment: "landuse",
        title: "Landuse",
        description: "Land-use polygons from the core schema.",
        href: coreReviewPath("landuse"),
        sourceTable: "core.core_map_landuse",
        sourceSchema: "core",
        access: "read-only",
    },
    {
        segment: "water-lines",
        title: "Water lines",
        description: "Linear water features.",
        href: coreReviewPath("water-lines"),
        sourceTable: "core.core_map_water_lines",
        sourceSchema: "core",
        access: "read-only",
    },
    {
        segment: "water-polygons",
        title: "Water polygons",
        description: "Water body polygons.",
        href: coreReviewPath("water-polygons"),
        sourceTable: "core.core_map_water_polygons",
        sourceSchema: "core",
        access: "read-only",
    },
    {
        segment: "addresses",
        title: "Addresses",
        description: "Structured addresses and address components.",
        href: coreReviewPath("addresses"),
        sourceTable: "core.core_addresses",
        sourceSchema: "core",
        access: "editable",
    },
    {
        segment: "admin-areas",
        title: "Admin areas",
        description: "Administrative boundary hierarchy.",
        href: coreReviewPath("admin-areas"),
        sourceTable: "core.core_admin_areas",
        sourceSchema: "core",
        access: "read-only",
    },
];

const moduleByPath = new Map(CORE_REVIEW_OVERVIEW_MODULES.map((module) => [module.segment, module]));

export function getCoreReviewOverviewModuleByPath(path: string) {
    return moduleByPath.get(path.replace(/^\/+|\/+$/g, ""));
}

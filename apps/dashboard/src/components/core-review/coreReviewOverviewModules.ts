import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import type { CoreReviewOverviewStatus } from "@/src/features/core-review/config/entity-config-types";

export type CoreReviewOverviewModule = {
    segment: string;
    title: string;
    description: string;
    status: CoreReviewOverviewStatus;
    href: string;
};

export const CORE_REVIEW_OVERVIEW_MODULES: readonly CoreReviewOverviewModule[] = [
    {
        segment: "buildings",
        title: "Buildings",
        description: "Dashboard-sourced and promoted building footprints with verification status.",
        status: "ready",
        href: coreReviewPath("buildings"),
    },
    {
        segment: "places",
        title: "Places",
        description: "Points of interest and place records linked to categories and admin areas.",
        status: "ready",
        href: coreReviewPath("places"),
    },
    {
        segment: "roads",
        title: "Roads",
        description: "Street centerlines, road classes, and geometry for the core routing graph.",
        status: "partial",
        href: coreReviewPath("roads"),
    },
    {
        segment: "bus-stops",
        title: "Bus stops",
        description: "Transit stop locations and metadata.",
        status: "partial",
        href: coreReviewPath("bus-stops"),
    },
    {
        segment: "bus-routes",
        title: "Bus routes",
        description: "Route definitions and service patterns.",
        status: "partial",
        href: coreReviewPath("bus-routes"),
    },
    {
        segment: "bus-route-variants",
        title: "Bus route variants",
        description: "Directional or scheduled variants of bus routes.",
        status: "partial",
        href: coreReviewPath("bus-route-variants"),
    },
    {
        segment: "landuse",
        title: "Landuse",
        description: "Land-use polygons from core schema.",
        status: "partial",
        href: coreReviewPath("landuse"),
    },
    {
        segment: "water-lines",
        title: "Water lines",
        description: "Linear water features.",
        status: "partial",
        href: coreReviewPath("water-lines"),
    },
    {
        segment: "water-polygons",
        title: "Water polygons",
        description: "Water body polygons.",
        status: "partial",
        href: coreReviewPath("water-polygons"),
    },
    {
        segment: "addresses",
        title: "Addresses",
        description: "Structured addresses and components.",
        status: "ready",
        href: coreReviewPath("addresses"),
    },
    {
        segment: "admin-areas",
        title: "Admin areas",
        description: "Administrative boundary hierarchy.",
        status: "partial",
        href: coreReviewPath("admin-areas"),
    },
];

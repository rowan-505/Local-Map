import {
    BarChart3,
    Bus,
    ClipboardList,
    Coins,
    Library,
    LineChart,
    Route,
    ScanSearch,
    Users,
    type LucideIcon,
} from "lucide-react";

import { listImportReviewNavEntityConfigs } from "@/src/features/import-review/config";

import {
    coreReviewPath,
    importReviewPath,
    pointManagementPath,
    referencesPath,
    routingAdminPath,
    statsPath,
    transportPath,
    userAnalyticsPath,
    usersPath,
} from "@/src/lib/dashboardPaths";

export {
    CORE_REVIEW_PATH,
    DASHBOARD_PATH,
    IMPORT_REVIEW_PATH,
    POINT_MANAGEMENT_PATH,
    REFERENCES_PATH,
    STATS_PATH,
    TRANSPORT_PATH,
    USERS_PATH,
    USER_ANALYTICS_PATH,
    coreReviewPath,
    importReviewPath,
    pointManagementPath,
    referencesPath,
    statsPath,
    transportPath,
    userAnalyticsPath,
    usersPath,
} from "@/src/lib/dashboardPaths";

export type DashboardSidebarModuleKey =
    | "core-review"
    | "import-review"
    | "references"
    | "routing"
    | "stats"
    | "transport"
    | "users"
    | "user-analytics"
    | "point-management";

export type FamilyNavTab = {
    label: string;
    segment: string;
    match?: "exact" | "prefix";
};

export type DashboardSidebarItem = {
    moduleKey: DashboardSidebarModuleKey;
    href: string;
    label: string;
    Icon: LucideIcon;
};

export function sidebarModuleFromPathname(pathname: string): DashboardSidebarModuleKey | null {
    const match = pathname.match(/^\/dashboard\/([^/]+)/);
    const key = match?.[1];
    if (key === "core-verification") {
        return "core-review";
    }
    if (
        key === "core-review" ||
        key === "import-review" ||
        key === "references" ||
        key === "routing" ||
        key === "stats" ||
        key === "transport" ||
        key === "users" ||
        key === "user-analytics" ||
        key === "point-management"
    ) {
        return key;
    }
    return null;
}

export const dashboardSidebarItems: readonly DashboardSidebarItem[] = [
    {
        moduleKey: "core-review",
        href: coreReviewPath(),
        label: "Core review",
        Icon: ScanSearch,
    },
    {
        moduleKey: "import-review",
        href: importReviewPath(),
        label: "Import review",
        Icon: ClipboardList,
    },
    {
        moduleKey: "references",
        href: referencesPath(),
        label: "References",
        Icon: Library,
    },
    {
        moduleKey: "routing",
        href: routingAdminPath(),
        label: "Routing",
        Icon: Route,
    },
    {
        moduleKey: "stats",
        href: statsPath(),
        label: "Stats",
        Icon: BarChart3,
    },
    {
        moduleKey: "transport",
        href: transportPath(),
        label: "Transport",
        Icon: Bus,
    },
];

/** "User Management" sidebar section (auth users, analytics, manual points). */
export const userManagementSidebarItems: readonly DashboardSidebarItem[] = [
    {
        moduleKey: "users",
        href: usersPath(),
        label: "Users",
        Icon: Users,
    },
    {
        moduleKey: "user-analytics",
        href: userAnalyticsPath(),
        label: "Analytics",
        Icon: LineChart,
    },
    {
        moduleKey: "point-management",
        href: pointManagementPath(),
        label: "Point Management",
        Icon: Coins,
    },
];

/** Core review top nav. */
export const coreReviewTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
    { label: "Buildings", segment: "buildings" },
    { label: "Places", segment: "places" },
    { label: "Roads", segment: "roads" },
    { label: "Landuse", segment: "landuse" },
    { label: "Water lines", segment: "water-lines" },
    { label: "Water polygons", segment: "water-polygons" },
    { label: "Addresses", segment: "addresses" },
    { label: "Admin areas", segment: "admin-areas" },
];

/** Entity slugs/labels for import review top nav (order from entity configs). */
export function importReviewEntityNavTabs(): readonly FamilyNavTab[] {
    return listImportReviewNavEntityConfigs().map((config) => ({
        label: config.pluralLabel,
        segment: config.slug,
    }));
}

export const importReviewTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
    ...importReviewEntityNavTabs(),
    { label: "Promotion", segment: "promotion" },
    { label: "History", segment: "history" },
];

export const referencesTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
    { label: "POI categories", segment: "poi-categories" },
    { label: "Road classes", segment: "road-classes" },
    { label: "Place classes", segment: "place-classes" },
    { label: "Building types", segment: "building-types" },
    { label: "Admin levels", segment: "admin-levels" },
    { label: "Source types", segment: "source-types" },
    { label: "Address component types", segment: "address-component-types" },
    { label: "Languages", segment: "languages" },
    { label: "Publish statuses", segment: "publish-statuses" },
    { label: "Report statuses", segment: "report-statuses" },
    { label: "Report types", segment: "report-types" },
    { label: "Validation statuses", segment: "validation-statuses" },
    { label: "Validation task types", segment: "validation-task-types" },
];

export const statsTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
    { label: "Core stats", segment: "core" },
    { label: "Import stats", segment: "import" },
    { label: "Promotion stats", segment: "promotion" },
    { label: "Data quality", segment: "data-quality" },
];

export const transportTabs: readonly FamilyNavTab[] = [
    { label: "Overview", segment: "", match: "exact" },
    { label: "Routes", segment: "routes" },
    { label: "Stops", segment: "stops" },
    { label: "Infrastructure", segment: "infrastructure" },
    { label: "Imports", segment: "imports" },
];

function joinPath(base: string, segment?: string): string {
    const seg = segment?.replace(/^\/+|\/+$/g, "") ?? "";
    return seg ? `${base}/${seg}` : base;
}

export function familyTabsToHref(
    basePath: string,
    tabs: readonly FamilyNavTab[]
): { label: string; href: string; match?: "exact" | "prefix" }[] {
    return tabs.map((tab) => ({
        label: tab.label,
        href: joinPath(basePath, tab.segment || undefined),
        match: tab.match ?? (tab.segment === "" ? "exact" : "prefix"),
    }));
}

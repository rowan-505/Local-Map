/**
 * Shared types for GTFS export CLI tools.
 */

export const PLANNED_GTFS_FILES = [
    "agency.txt",
    "stops.txt",
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
    "frequencies.txt",
    "shapes.txt",
    "feed_info.txt",
] as const;

export type PlannedGtfsFile = (typeof PLANNED_GTFS_FILES)[number];

export type ScheduleMode = "frequencies" | "synthetic" | "hybrid";

export type ExportGtfsOptions = {
    scope: string;
    outputDir: string;
    buildCode: string;
    createBuild: boolean;
    scheduleMode: ScheduleMode;
};

export type ValidateGtfsOptions = {
    inputDir: string;
};

export type DatabaseHealth = {
    database: string;
    serverTime: string;
    coreTransportSchema: boolean;
    gtfsExportSchema: boolean;
};

export type CoreTransportTableStatus = {
    tableName: string;
    exists: boolean;
};

export type ExportBuildSummary = {
    id: number;
    buildCode: string;
    scope: string;
    status: string;
};

export type GtfsReadinessSummary = {
    activeRoutes: number;
    activeVariants: number;
    activeStops: number;
    variantsTooFewStops: number;
    duplicateSequences: number;
    stopsWithoutNames: number;
    variantsWithoutFrequency: number;
    variantsWithoutPath: number;
};

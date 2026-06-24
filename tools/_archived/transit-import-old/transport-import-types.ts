/**
 * Shared types for YBS / transport import CLI tools.
 */

export const TRANSPORT_MODES = [
    "local_bus",
    "express_bus",
    "train",
    "ferry",
    "airport_access",
] as const;

export type TransportMode = (typeof TRANSPORT_MODES)[number];

export type ImportYbsDatasetOptions = {
    sourceCode: string;
    sourceName: string;
    inputDir: string;
    batchCode: string;
    scope: TransportMode;
};

export type ValidateYbsImportOptions = {
    batchCode: string;
};

export type PromoteYbsToCoreOptions = {
    batchCode: string;
    confirmWarnings: boolean;
};

export type DatabaseHealth = {
    database: string;
    serverTime: string;
    importTransportSchema: boolean;
    coreTransportSchema: boolean;
    gtfsExportSchema: boolean;
};

export type ImportBatchSummary = {
    id: number;
    batchName: string;
    importStatus: string;
    validationStatus: string;
};

export type RoutingAdminListQuery = {
    limit: number;
    offset: number;
    engineCode?: string;
    status?: string;
    severity?: string;
    routingBuildId?: bigint;
};

export type RoutingAdminBuildSummary = {
    id: string;
    publicId: string;
    engineCode: string;
    regionCode: string | null;
    buildVersion: string;
    buildLabel: string | null;
    status: string;
    isActive: boolean;
    isPublic: boolean;
    profileCodes: readonly string[];
    warningCount: number;
    errorCount: number;
    startedAt: string | null;
    finishedAt: string | null;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
};

export type RoutingAdminBuildDetail = RoutingAdminBuildSummary & {
    sourceDescription: string | null;
    summary: Record<string, unknown>;
    smokeTestSummary: Record<string, unknown>;
    artifactCount: number;
    sourceCount: number;
};

export type RoutingAdminServiceHealthRow = {
    id: string;
    engineCode: string;
    regionCode: string | null;
    status: string;
    lastCheckAt: string | null;
    lastSuccessAt: string | null;
    latencyMs: number | null;
    message: string | null;
    details: Record<string, unknown>;
    updatedAt: string;
};

export type RoutingAdminHealthResponse = {
    configuration: {
        routingEnabled: boolean;
        defaultEngine: string;
        configuredPublicProfiles: readonly string[];
        valhallaBaseUrl: string;
    };
    live: {
        routingEnabled: boolean;
        defaultEngine: string;
        configuredPublicProfiles: readonly string[];
        activeEngine: string;
        engineHealth: {
            engine: string;
            status: string;
            latencyMs?: number;
            message?: string;
            checkedAt: string;
        } | null;
    };
    persistedServiceHealth: readonly RoutingAdminServiceHealthRow[];
    activeBuilds: readonly RoutingAdminBuildSummary[];
    schemaAvailable: boolean;
};

export type RoutingAdminFeedbackRow = {
    id: string;
    publicId: string;
    routingRequestPublicId: string | null;
    problemType: string;
    status: string;
    comment: string | null;
    metadata: Record<string, unknown>;
    userId: string | null;
    createdAt: string;
    updatedAt: string;
};

export type RoutingAdminValidationReportRow = {
    id: string;
    routingBuildId: string | null;
    buildJobId: string | null;
    reportScope: string;
    severity: string;
    code: string;
    message: string;
    coreStreetId: string | null;
    routingEdgeId: string | null;
    createdAt: string;
    updatedAt: string;
};

export type RoutingAdminPaginated<T> = {
    items: readonly T[];
    total: number;
    limit: number;
    offset: number;
};

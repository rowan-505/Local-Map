import { isRoutingEnabled } from "../../config/env.js";
import {
    getRoutingDefaultEngine,
    getRoutingPublicProfiles,
    getValhallaBaseUrl,
} from "./routing.config.js";
import { RoutingAdminRepository } from "./routing-admin.repo.js";
import { RoutingAdminSchemaUnavailableError } from "./routing-admin.errors.js";
import type {
    ListRoutingBuildsQuery,
    ListRoutingFeedbackQuery,
    ListRoutingValidationReportsQuery,
    PatchRoutingFeedbackStatusBody,
} from "./routing-admin.schema.js";
import type {
    RoutingAdminBuildDetail,
    RoutingAdminFeedbackRow,
    RoutingAdminHealthResponse,
    RoutingAdminPaginated,
    RoutingAdminBuildSummary,
    RoutingAdminValidationReportRow,
} from "./routing-admin.types.js";
import { createRoutingService } from "./routing.service.js";
import { RoutingRepository } from "./routing.repo.js";
import type { PrismaClient } from "@prisma/client";

export class RoutingAdminService {
    private readonly repo: RoutingAdminRepository;
    private readonly routingService;

    constructor(prisma: PrismaClient) {
        this.repo = new RoutingAdminRepository(prisma);
        this.routingService = createRoutingService(new RoutingRepository(prisma));
    }

    async getAdminHealth(): Promise<RoutingAdminHealthResponse> {
        let schemaAvailable = true;
        let persistedServiceHealth: RoutingAdminHealthResponse["persistedServiceHealth"] = [];
        let activeBuilds: readonly RoutingAdminBuildSummary[] = [];

        try {
            await this.repo.assertSchemaAvailable();
            persistedServiceHealth = await this.repo.listServiceHealth();
            activeBuilds = await this.repo.listActiveBuilds();
        } catch (error) {
            if (error instanceof RoutingAdminSchemaUnavailableError) {
                schemaAvailable = false;
            } else {
                throw error;
            }
        }

        const live = await this.routingService.getHealth();

        return {
            configuration: {
                routingEnabled: isRoutingEnabled(),
                defaultEngine: getRoutingDefaultEngine(),
                configuredPublicProfiles: [...getRoutingPublicProfiles()],
                valhallaBaseUrl: getValhallaBaseUrl(),
            },
            live,
            persistedServiceHealth,
            activeBuilds,
            schemaAvailable,
        };
    }

    listBuilds(query: ListRoutingBuildsQuery): Promise<RoutingAdminPaginated<RoutingAdminBuildSummary>> {
        return this.repo.listBuilds(query);
    }

    getBuild(id: string): Promise<RoutingAdminBuildDetail> {
        return this.repo.getBuildById(id);
    }

    listFeedback(query: ListRoutingFeedbackQuery): Promise<RoutingAdminPaginated<RoutingAdminFeedbackRow>> {
        return this.repo.listFeedback(query);
    }

    updateFeedbackStatus(
        id: string,
        body: PatchRoutingFeedbackStatusBody
    ): Promise<RoutingAdminFeedbackRow> {
        return this.repo.updateFeedbackStatus(id, body);
    }

    listValidationReports(
        query: ListRoutingValidationReportsQuery
    ): Promise<RoutingAdminPaginated<RoutingAdminValidationReportRow>> {
        return this.repo.listValidationReports(query);
    }
}

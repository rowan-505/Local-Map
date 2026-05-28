import {
    assertRoutingServiceEnabled,
    isRoutingEnabled,
    isRoutingProfilePublic,
} from "../../config/env.js";
import { createRoutingDirectionsService } from "./routing.directions.service.js";
import {
    getRoutingDefaultEngine,
    getRoutingPublicProfiles,
} from "./routing.config.js";
import { RoutingProfileDisabledError, RoutingProfileUnsupportedError } from "./routing.errors.js";
import type { PostRoutingFeedbackBody } from "./routing-feedback.schema.js";
import {
    toRouteRequestLogCompletion,
    toRouteRequestLogFailure,
} from "./routing-request-log.js";
import { parsePostRouteRequestBody } from "./routing.schema.js";
import { RoutingRepository } from "./routing.repo.js";
import type {
    NormalizedRouteResponse,
    RoutingEngineHealth,
    RoutingEngineName,
    RoutingHealthResponse,
    RoutingProfilesResponse,
    RoutingRouteRequestContext,
} from "./routing.types.js";
import type { PostRouteRequestBodyParsed } from "./routing.schema.js";

export class RoutingService {
    private readonly directions = createRoutingDirectionsService();
    private readonly repo: RoutingRepository;

    constructor(repo: RoutingRepository) {
        this.repo = repo;
    }

    async getHealth(): Promise<RoutingHealthResponse> {
        const routingEnabled = isRoutingEnabled();
        const configuredProfiles = getRoutingPublicProfiles();
        const defaultEngine = getRoutingDefaultEngine();

        let engineHealth: RoutingEngineHealth | null = null;
        if (defaultEngine === "valhalla") {
            try {
                engineHealth = await this.directions.getHealth();
            } catch (error) {
                engineHealth = {
                    engine: "valhalla",
                    status: "down",
                    message: error instanceof Error ? error.message : "Health probe failed",
                    checkedAt: new Date().toISOString(),
                };
            }
        }

        return {
            routingEnabled,
            defaultEngine,
            configuredPublicProfiles: [...configuredProfiles],
            activeEngine: this.directions.activeEngine,
            engineHealth,
        };
    }

    async listProfiles(): Promise<RoutingProfilesResponse> {
        const profiles = await this.repo.listPublicProfiles();
        const publicEnabled = profiles.filter(
            (profile) => profile.isPublicEnabled && profile.isRoutingEnabled
        );

        return {
            profiles: publicEnabled,
            source: publicEnabled[0]?.source ?? "env",
        };
    }

    async route(
        body: unknown,
        context?: RoutingRouteRequestContext
    ): Promise<NormalizedRouteResponse> {
        assertRoutingServiceEnabled();

        const parsed = parsePostRouteRequestBody(body);
        this.assertProfileAllowedForPublicApi(parsed);

        const engineCode = getRoutingDefaultEngine() as RoutingEngineName;
        const requestedAt = new Date().toISOString();
        const startedMs = Date.now();

        let requestPublicId: string | null = null;
        let activeBuild: Awaited<ReturnType<RoutingRepository["findActiveRoutingBuild"]>> = null;

        try {
            activeBuild = await this.repo.findActiveRoutingBuild(engineCode);
        } catch (error) {
            this.warnRouteRequestLog(context, "Failed to load active routing build for request log", {
                err: error,
            });
        }

        try {
            const started = await this.repo.insertRouteRequestStart(parsed, {
                engineCode,
                requestedAt,
                userId: context?.userId ?? null,
                activeBuild,
            });
            requestPublicId = started?.publicId ?? null;
        } catch (error) {
            this.warnRouteRequestLog(context, "Failed to insert routing request log row", { err: error });
        }

        try {
            const response = await this.directions.route(parsed);
            await this.completeRouteRequestLog(requestPublicId, response, startedMs, {
                context,
                activeBuild,
                engineCode,
            });
            return this.withRequestDebug(response, requestPublicId, activeBuild?.buildCode);
        } catch (error) {
            await this.failRouteRequestLog(requestPublicId, error, startedMs, {
                context,
                activeBuild,
                engineCode,
            });
            throw error;
        }
    }

    async submitFeedback(
        body: PostRoutingFeedbackBody,
        options?: { userId?: bigint | null }
    ): Promise<{ publicId: string; status: string; stored: boolean }> {
        return this.repo.insertFeedback(body, options);
    }

    private async completeRouteRequestLog(
        requestPublicId: string | null,
        response: NormalizedRouteResponse,
        startedMs: number,
        options: {
            context?: RoutingRouteRequestContext;
            activeBuild: Awaited<ReturnType<RoutingRepository["findActiveRoutingBuild"]>>;
            engineCode: RoutingEngineName;
        }
    ): Promise<void> {
        if (!requestPublicId) {
            return;
        }

        const durationMs = Date.now() - startedMs;
        const completion = toRouteRequestLogCompletion(response, durationMs, {
            buildCode: options.activeBuild?.buildCode ?? response.debug?.buildCode ?? null,
        });

        try {
            await this.repo.finalizeRouteRequest(requestPublicId, completion, {
                routingBuildId: options.activeBuild?.routingBuildId ?? null,
            });
        } catch (error) {
            this.warnRouteRequestLog(options.context, "Failed to finalize routing request log row", {
                err: error,
                requestPublicId,
            });
        }
    }

    private async failRouteRequestLog(
        requestPublicId: string | null,
        error: unknown,
        startedMs: number,
        options: {
            context?: RoutingRouteRequestContext;
            activeBuild: Awaited<ReturnType<RoutingRepository["findActiveRoutingBuild"]>>;
            engineCode: RoutingEngineName;
        }
    ): Promise<void> {
        if (!requestPublicId) {
            return;
        }

        const durationMs = Date.now() - startedMs;
        const completion = toRouteRequestLogFailure(error, durationMs, {
            buildCode: options.activeBuild?.buildCode ?? null,
            engine: options.engineCode,
        });

        try {
            await this.repo.finalizeRouteRequest(requestPublicId, completion, {
                routingBuildId: options.activeBuild?.routingBuildId ?? null,
            });
        } catch (finalizeError) {
            this.warnRouteRequestLog(options.context, "Failed to finalize routing request log after error", {
                err: finalizeError,
                requestPublicId,
                routeError: error,
            });
        }
    }

    private withRequestDebug(
        response: NormalizedRouteResponse,
        requestPublicId: string | null,
        buildCode?: string | null
    ): NormalizedRouteResponse {
        if (!requestPublicId && !buildCode && !response.debug) {
            return response;
        }

        return {
            ...response,
            debug: {
                ...response.debug,
                ...(buildCode ? { buildCode } : {}),
                ...(requestPublicId ? { requestId: requestPublicId } : {}),
            },
        };
    }

    private warnRouteRequestLog(
        context: RoutingRouteRequestContext | undefined,
        message: string,
        meta?: Record<string, unknown>
    ): void {
        if (context?.warn) {
            context.warn(message, meta);
            return;
        }
        console.warn(`[routing] ${message}`, meta);
    }

    private assertProfileAllowedForPublicApi(body: PostRouteRequestBodyParsed): void {
        if (!isRoutingProfilePublic(body.profile)) {
            throw new RoutingProfileDisabledError(body.profile);
        }

        const configured = new Set(getRoutingPublicProfiles());
        if (!configured.has(body.profile)) {
            throw new RoutingProfileUnsupportedError(body.profile);
        }
    }
}

export function createRoutingService(repo: RoutingRepository): RoutingService {
    return new RoutingService(repo);
}

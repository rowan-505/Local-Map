import { Prisma, type PrismaClient } from "@prisma/client";

import { getRoutingPublicProfiles } from "./routing.config.js";
import type { PostRoutingFeedbackBody, RoutingFeedbackProblemType } from "./routing-feedback.schema.js";
import { buildRouteRequestStartSummary } from "./routing-request-log.js";
import type { PostRouteRequestBodyParsed } from "./routing.schema.js";
import type {
    RouteRequestLogStartResult,
    RoutingActiveBuildRef,
    RoutingPublicProfile,
    RoutingRequestLogCompletion,
} from "./routing.types.js";

type RoutingProfileRow = {
    code: string;
    name: string;
    description: string | null;
    is_public_enabled: boolean;
    is_routing_enabled: boolean;
    sort_order: number;
    primary_physical_mode_code: string | null;
};

function isMissingRoutingRelationError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return (
        message.includes("routing.routing_profiles") ||
        message.includes("routing.routing_feedback") ||
        message.includes("routing.routing_requests") ||
        message.includes("routing.routing_builds") ||
        message.includes('schema "routing" does not exist') ||
        (message.includes("relation") && message.includes("does not exist"))
    );
}

function isRouteRequestLogSkippableError(error: unknown): boolean {
    if (isMissingRoutingRelationError(error)) {
        return true;
    }
    if (!(error instanceof Error)) {
        return false;
    }
    const message = error.message.toLowerCase();
    return (
        message.includes("foreign key") ||
        message.includes("routing_requests_profile_code_fkey") ||
        message.includes("violates foreign key constraint")
    );
}

/** Maps public API problemType values to routing.routing_feedback CHECK constraint codes. */
export function mapFeedbackProblemTypeToDb(problemType: RoutingFeedbackProblemType): string {
    switch (problemType) {
        case "road_closed":
            return "blocked_road";
        case "bad_oneway":
        case "bad_motorbike_route":
        case "bad_walk_route":
            return "wrong_mode";
        case "dangerous_route":
            return "unsafe_path";
        case "bad_eta":
            return "wrong_duration";
        case "cannot_route":
            return "other";
        default:
            return problemType;
    }
}

function envFallbackPublicProfiles(): RoutingPublicProfile[] {
    return getRoutingPublicProfiles().map((code, index) => ({
        code,
        name: code.charAt(0).toUpperCase() + code.slice(1),
        description: null,
        isPublicEnabled: true,
        isRoutingEnabled: true,
        sortOrder: (index + 1) * 10,
        primaryPhysicalModeCode: code === "car" ? "car" : code,
        source: "env" as const,
    }));
}

export class RoutingRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listPublicProfiles(): Promise<RoutingPublicProfile[]> {
        try {
            const rows = await this.prisma.$queryRaw<RoutingProfileRow[]>`
                SELECT
                    code,
                    name,
                    description,
                    is_public_enabled,
                    is_routing_enabled,
                    sort_order,
                    primary_physical_mode_code
                FROM routing.routing_profiles
                WHERE is_public_enabled = true
                  AND is_routing_enabled = true
                ORDER BY sort_order ASC, code ASC
            `;

            if (rows.length === 0) {
                return envFallbackPublicProfiles();
            }

            return rows.map((row) => ({
                code: row.code,
                name: row.name,
                description: row.description,
                isPublicEnabled: row.is_public_enabled,
                isRoutingEnabled: row.is_routing_enabled,
                sortOrder: row.sort_order,
                primaryPhysicalModeCode: row.primary_physical_mode_code,
                source: "database" as const,
            }));
        } catch (error) {
            if (isMissingRoutingRelationError(error)) {
                return envFallbackPublicProfiles();
            }
            throw error;
        }
    }

    async findActiveRoutingBuild(engineCode: string): Promise<RoutingActiveBuildRef | null> {
        try {
            const rows = await this.prisma.$queryRaw<{ id: bigint; build_version: string }[]>`
                SELECT id, build_version
                FROM routing.routing_builds
                WHERE engine_code = ${engineCode}
                  AND is_active = true
                  AND status = 'published'
                ORDER BY published_at DESC NULLS LAST, id DESC
                LIMIT 1
            `;
            const row = rows[0];
            if (!row) {
                return null;
            }
            return {
                routingBuildId: row.id,
                buildCode: row.build_version,
            };
        } catch (error) {
            if (isMissingRoutingRelationError(error)) {
                return null;
            }
            throw error;
        }
    }

    async insertRouteRequestStart(
        parsed: PostRouteRequestBodyParsed,
        options: {
            engineCode: string;
            requestedAt: string;
            userId?: bigint | null;
            activeBuild?: RoutingActiveBuildRef | null;
        }
    ): Promise<RouteRequestLogStartResult | null> {
        const requestSummary = buildRouteRequestStartSummary(parsed, options.requestedAt);

        try {
            const rows = await this.prisma.$queryRaw<{ id: bigint; public_id: string }[]>`
                INSERT INTO routing.routing_requests (
                    profile_code,
                    engine_code,
                    routing_build_id,
                    status,
                    from_lon,
                    from_lat,
                    to_lon,
                    to_lat,
                    request_summary,
                    response_summary,
                    user_id
                )
                VALUES (
                    ${parsed.profile},
                    ${options.engineCode},
                    ${options.activeBuild?.routingBuildId ?? null},
                    'success',
                    ${parsed.origin.lng},
                    ${parsed.origin.lat},
                    ${parsed.destination.lng},
                    ${parsed.destination.lat},
                    ${JSON.stringify(requestSummary)}::jsonb,
                    '{}'::jsonb,
                    ${options.userId ?? null}
                )
                RETURNING id, public_id::text
            `;

            const row = rows[0];
            if (!row) {
                return null;
            }

            return {
                internalId: row.id,
                publicId: row.public_id,
            };
        } catch (error) {
            if (isRouteRequestLogSkippableError(error)) {
                return null;
            }
            throw error;
        }
    }

    async finalizeRouteRequest(
        publicId: string,
        completion: RoutingRequestLogCompletion,
        options?: { routingBuildId?: bigint | null }
    ): Promise<void> {
        try {
            await this.prisma.$executeRaw`
                UPDATE routing.routing_requests
                SET
                    status = ${completion.status},
                    distance_m = ${completion.distanceM},
                    duration_s = ${completion.durationS},
                    duration_ms = ${completion.durationMs},
                    request_summary = request_summary || ${JSON.stringify(completion.requestSummaryPatch)}::jsonb,
                    response_summary = ${JSON.stringify(completion.responseSummary)}::jsonb,
                    error_code = ${completion.errorCode},
                    error_message = ${completion.errorMessage},
                    routing_build_id = COALESCE(
                        ${options?.routingBuildId ?? null},
                        routing_build_id
                    )
                WHERE public_id = ${publicId}::uuid
            `;
        } catch (error) {
            if (isRouteRequestLogSkippableError(error)) {
                return;
            }
            throw error;
        }
    }

    async findRoutingRequestIdByPublicId(publicId: string): Promise<bigint | null> {
        try {
            const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
                SELECT id
                FROM routing.routing_requests
                WHERE public_id = ${publicId}::uuid
                LIMIT 1
            `;
            return rows[0]?.id ?? null;
        } catch (error) {
            if (isMissingRoutingRelationError(error)) {
                return null;
            }
            throw error;
        }
    }

    async insertFeedback(
        body: PostRoutingFeedbackBody,
        options?: { userId?: bigint | null }
    ): Promise<{ publicId: string; status: string; stored: boolean }> {
        const dbProblemType = mapFeedbackProblemTypeToDb(body.problemType);
        const routingRequestId = body.requestId
            ? await this.findRoutingRequestIdByPublicId(body.requestId)
            : null;

        const metadata: Prisma.InputJsonValue = {
            apiProblemType: body.problemType,
            origin: body.origin,
            destination: body.destination,
            profile: body.profile,
            requestPublicId: body.requestId ?? null,
        };

        try {
            const rows = await this.prisma.$queryRaw<{ public_id: string; status: string }[]>`
                INSERT INTO routing.routing_feedback (
                    routing_request_id,
                    problem_type,
                    status,
                    comment,
                    metadata,
                    user_id
                )
                VALUES (
                    ${routingRequestId},
                    ${dbProblemType},
                    'open',
                    ${body.message ?? null},
                    ${JSON.stringify(metadata)}::jsonb,
                    ${options?.userId ?? null}
                )
                RETURNING public_id::text, status
            `;

            const row = rows[0];
            if (!row) {
                throw new Error("Failed to insert routing feedback.");
            }

            return {
                publicId: row.public_id,
                status: row.status,
                stored: true,
            };
        } catch (error) {
            if (isMissingRoutingRelationError(error)) {
                return {
                    publicId: crypto.randomUUID(),
                    status: "accepted",
                    stored: false,
                };
            }
            throw error;
        }
    }
}

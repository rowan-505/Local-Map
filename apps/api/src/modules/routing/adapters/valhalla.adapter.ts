import { getRoutingRequestTimeoutMs, getValhallaBaseUrl } from "../routing.config.js";
import {
    RoutingEngineInvalidResponseError,
    RoutingEngineTimeoutError,
    RoutingEngineUnavailableError,
    RoutingEngineUpstreamError,
} from "../routing.errors.js";
import {
    buildValhallaRouteRequest,
    isValhallaNoRouteErrorCode,
    mapValhallaRouteResponse,
    type ValhallaRouteRequestPayload,
} from "../mappers/valhalla-route.mapper.js";
import { isMotorcycleCostingRetryableError } from "../mappers/profile-to-valhalla-costing.js";
import type {
    NormalizedRouteRequest,
    NormalizedRouteResponse,
    RoutingEngineHealth,
    RoutingEngineHealthStatus,
    RoutingEngineName,
} from "../routing.types.js";
import type { RoutingEngineAdapter } from "./routing-engine-adapter.js";

export type ValhallaAdapterOptions = {
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
};

function isTimeoutError(error: unknown): boolean {
    if (error instanceof DOMException && error.name === "TimeoutError") {
        return true;
    }
    if (error instanceof Error) {
        return error.name === "AbortError" || error.name === "TimeoutError";
    }
    return false;
}

function isConnectionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }
    const code = (error as NodeJS.ErrnoException).code;
    return (
        code === "ECONNREFUSED" ||
        code === "ENOTFOUND" ||
        code === "ECONNRESET" ||
        code === "EHOSTUNREACH" ||
        error.message.includes("fetch failed")
    );
}

function mapHttpRouteFailure(
    status: number,
    raw: unknown
): RoutingEngineUpstreamError | RoutingEngineUnavailableError {
    const message =
        raw &&
        typeof raw === "object" &&
        "error" in raw &&
        typeof (raw as { error: unknown }).error === "string"
            ? (raw as { error: string }).error
            : `Valhalla /route returned HTTP ${status}`;

    if (status === 504 || status === 408) {
        return new RoutingEngineTimeoutError("valhalla", message);
    }
    if (status === 503 || status === 502 || status >= 500) {
        return new RoutingEngineUnavailableError("valhalla", message, status);
    }
    if (status === 429) {
        return new RoutingEngineUnavailableError("valhalla", message, status);
    }

    return new RoutingEngineUpstreamError("valhalla", message, {
        statusCode: 502,
        upstreamStatus: status,
    });
}

export class ValhallaRoutingEngineAdapter implements RoutingEngineAdapter {
    readonly name: RoutingEngineName = "valhalla";

    private readonly baseUrl: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;

    constructor(options: ValhallaAdapterOptions = {}) {
        this.baseUrl = (options.baseUrl ?? getValhallaBaseUrl()).replace(/\/+$/, "");
        this.timeoutMs = options.timeoutMs ?? getRoutingRequestTimeoutMs();
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async getHealth(): Promise<RoutingEngineHealth> {
        const started = Date.now();
        const checkedAt = new Date().toISOString();

        try {
            const response = await this.fetchImpl(`${this.baseUrl}/status`, {
                method: "GET",
                signal: AbortSignal.timeout(this.timeoutMs),
            });

            const latencyMs = Date.now() - started;
            const status: RoutingEngineHealthStatus = response.ok ? "healthy" : "degraded";

            return {
                engine: this.name,
                status,
                latencyMs,
                message: response.ok ? "Valhalla status OK" : `HTTP ${response.status}`,
                checkedAt,
            };
        } catch (error) {
            return {
                engine: this.name,
                status: "down",
                latencyMs: Date.now() - started,
                message: error instanceof Error ? error.message : "Valhalla health check failed",
                checkedAt,
            };
        }
    }

    async route(request: NormalizedRouteRequest): Promise<NormalizedRouteResponse> {
        const initial = buildValhallaRouteRequest(request);

        try {
            return await this.fetchRoute(initial.payload, request, initial.profileWarnings);
        } catch (error) {
            if (
                request.profile === "motorcycle" &&
                !initial.profileWarnings.length &&
                isMotorcycleCostingRetryableError(error)
            ) {
                const fallback = buildValhallaRouteRequest(request, { forceAutoForMotorcycle: true });
                return this.fetchRoute(fallback.payload, request, [
                    ...fallback.profileWarnings,
                    "TODO: enable Valhalla motorcycle costing in tile build; retried with auto.",
                ]);
            }
            throw error;
        }
    }

    private async fetchRoute(
        payload: ValhallaRouteRequestPayload,
        request: NormalizedRouteRequest,
        profileWarnings: string[]
    ): Promise<NormalizedRouteResponse> {
        let response: Response;

        try {
            response = await this.fetchImpl(`${this.baseUrl}/route`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        } catch (error) {
            if (isTimeoutError(error)) {
                throw new RoutingEngineTimeoutError(
                    "valhalla",
                    `Valhalla /route timed out after ${this.timeoutMs}ms.`
                );
            }
            if (isConnectionError(error)) {
                throw new RoutingEngineUnavailableError(
                    "valhalla",
                    "Cannot reach Valhalla. Is the local service running?"
                );
            }
            throw new RoutingEngineUnavailableError(
                "valhalla",
                error instanceof Error ? error.message : "Valhalla request failed."
            );
        }

        let raw: unknown = null;
        try {
            raw = await response.json();
        } catch {
            throw new RoutingEngineInvalidResponseError(
                "valhalla",
                "Valhalla /route returned invalid JSON."
            );
        }

        if (!response.ok) {
            const errorCode =
                raw && typeof raw === "object" && "error_code" in raw
                    ? (raw as { error_code?: number }).error_code
                    : undefined;
            if (isValhallaNoRouteErrorCode(errorCode)) {
                return mapValhallaRouteResponse(raw, request, { extraWarnings: profileWarnings });
            }
            throw mapHttpRouteFailure(response.status, raw);
        }

        return mapValhallaRouteResponse(raw, request, { extraWarnings: profileWarnings });
    }
}

export function createValhallaRoutingEngineAdapter(
    options?: ValhallaAdapterOptions
): ValhallaRoutingEngineAdapter {
    return new ValhallaRoutingEngineAdapter(options);
}

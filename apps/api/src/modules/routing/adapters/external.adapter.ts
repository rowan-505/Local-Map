import { RoutingEngineNotImplementedError } from "../routing.errors.js";
import type {
    NormalizedRouteRequest,
    NormalizedRouteResponse,
    RoutingEngineHealth,
    RoutingEngineName,
} from "../routing.types.js";
import type { RoutingEngineAdapter } from "./routing-engine-adapter.js";

/** Placeholder for a third-party routing provider adapter. */
export class ExternalRoutingEngineAdapter implements RoutingEngineAdapter {
    readonly name: RoutingEngineName = "external";

    async getHealth(): Promise<RoutingEngineHealth> {
        throw new RoutingEngineNotImplementedError(this.name);
    }

    async route(_request: NormalizedRouteRequest): Promise<NormalizedRouteResponse> {
        throw new RoutingEngineNotImplementedError(this.name);
    }
}

export function createExternalRoutingEngineAdapter(): ExternalRoutingEngineAdapter {
    return new ExternalRoutingEngineAdapter();
}

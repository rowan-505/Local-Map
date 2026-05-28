import type { RoutingEngineAdapter } from "./adapters/routing-engine-adapter.js";
import { resolveRoutingEngineAdapter } from "./adapters/index.js";
import type {
    NormalizedRouteRequest,
    NormalizedRouteResponse,
    RoutingEngineHealth,
    RoutingEngineName,
} from "./routing.types.js";

/**
 * Directions orchestration — depends on {@link RoutingEngineAdapter} only, not Valhalla/OTP concrete types.
 */
export class RoutingDirectionsService {
    constructor(private readonly engine: RoutingEngineAdapter) {}

    get activeEngine(): RoutingEngineName {
        return this.engine.name;
    }

    getHealth(): Promise<RoutingEngineHealth> {
        return this.engine.getHealth();
    }

    route(request: NormalizedRouteRequest): Promise<NormalizedRouteResponse> {
        return this.engine.route(request);
    }
}

export function createRoutingDirectionsService(engine?: RoutingEngineName): RoutingDirectionsService {
    return new RoutingDirectionsService(resolveRoutingEngineAdapter(engine));
}

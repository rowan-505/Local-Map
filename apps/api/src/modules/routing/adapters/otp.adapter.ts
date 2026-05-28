import { RoutingEngineNotImplementedError } from "../routing.errors.js";
import type {
    NormalizedRouteRequest,
    NormalizedRouteResponse,
    RoutingEngineHealth,
    RoutingEngineName,
} from "../routing.types.js";
import type { RoutingEngineAdapter } from "./routing-engine-adapter.js";

/**
 * Placeholder for future OpenTripPlanner integration (`infrastructure/routing/otp/`).
 * Multimodal / transit routing will implement this adapter without changing the public API contract.
 */
export class OtpRoutingEngineAdapter implements RoutingEngineAdapter {
    readonly name: RoutingEngineName = "otp";

    async getHealth(): Promise<RoutingEngineHealth> {
        throw new RoutingEngineNotImplementedError(this.name);
    }

    async route(_request: NormalizedRouteRequest): Promise<NormalizedRouteResponse> {
        throw new RoutingEngineNotImplementedError(this.name);
    }
}

export function createOtpRoutingEngineAdapter(): OtpRoutingEngineAdapter {
    return new OtpRoutingEngineAdapter();
}

import { getRoutingDefaultEngine } from "../routing.config.js";
import type { RoutingEngineName } from "../routing.types.js";
import { createExternalRoutingEngineAdapter } from "./external.adapter.js";
import { createOtpRoutingEngineAdapter } from "./otp.adapter.js";
import type { RoutingEngineAdapter } from "./routing-engine-adapter.js";
import { createValhallaRoutingEngineAdapter } from "./valhalla.adapter.js";

export type { RoutingEngineAdapter } from "./routing-engine-adapter.js";
export { ValhallaRoutingEngineAdapter, createValhallaRoutingEngineAdapter } from "./valhalla.adapter.js";
export { OtpRoutingEngineAdapter, createOtpRoutingEngineAdapter } from "./otp.adapter.js";
export { ExternalRoutingEngineAdapter, createExternalRoutingEngineAdapter } from "./external.adapter.js";

export function createRoutingEngineAdapter(engine: RoutingEngineName): RoutingEngineAdapter {
    switch (engine) {
        case "valhalla":
            return createValhallaRoutingEngineAdapter();
        case "otp":
            return createOtpRoutingEngineAdapter();
        case "external":
            return createExternalRoutingEngineAdapter();
        default: {
            const exhaustive: never = engine;
            throw new Error(`Unknown routing engine: ${exhaustive as string}`);
        }
    }
}

export function resolveRoutingEngineAdapter(engine?: RoutingEngineName): RoutingEngineAdapter {
    return createRoutingEngineAdapter(engine ?? getRoutingDefaultEngine());
}

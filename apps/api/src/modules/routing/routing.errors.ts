export class RoutingGraphBuildDisabledError extends Error {
    constructor() {
        super("Routing graph build is disabled. Set ENABLE_ROUTING_GRAPH_BUILD=true.");
        this.name = "RoutingGraphBuildDisabledError";
    }
}

export class RoutingGraphBuildInputError extends Error {
    readonly details?: Record<string, unknown>;

    constructor(message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "RoutingGraphBuildInputError";
        this.details = details;
    }
}

export class RoutingGraphBuildMaxRoadsError extends Error {
    readonly maxRoads: number;
    readonly requestedMaxRoads: number;

    constructor(requestedMaxRoads: number, maxRoads: number) {
        super(`max_roads ${requestedMaxRoads} exceeds allowed limit ${maxRoads}.`);
        this.name = "RoutingGraphBuildMaxRoadsError";
        this.maxRoads = maxRoads;
        this.requestedMaxRoads = requestedMaxRoads;
    }
}

export class RoutingGraphBuildJobNotFoundError extends Error {
    constructor(public readonly buildJobId: string) {
        super(`Routing build job not found: ${buildJobId}`);
        this.name = "RoutingGraphBuildJobNotFoundError";
    }
}

export class RoutingAdminSchemaUnavailableError extends Error {
    constructor() {
        super("Routing metadata schema is not available. Apply migration 060.");
        this.name = "RoutingAdminSchemaUnavailableError";
    }
}

export class RoutingAdminBuildNotFoundError extends Error {
    constructor(public readonly id: string) {
        super(`Routing build not found: ${id}`);
        this.name = "RoutingAdminBuildNotFoundError";
    }
}

export class RoutingAdminFeedbackNotFoundError extends Error {
    constructor(public readonly id: string) {
        super(`Routing feedback not found: ${id}`);
        this.name = "RoutingAdminFeedbackNotFoundError";
    }
}

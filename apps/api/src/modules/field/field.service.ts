import {
    sortRouteStops,
    toFieldRoute,
    toFieldRoutePath,
    toFieldRouteStop,
    toFieldStop,
    toFieldVariant,
} from "./field-dto.js";
import { snapshotRevisionFromParts } from "./field-revision.js";
import type { FieldRepository } from "./field.repo.js";
import type { FieldBootstrapResponse } from "./field.schema.js";

export class FieldService {
    constructor(private readonly repo: FieldRepository) {}

    async bootstrap(clientRevision?: string): Promise<FieldBootstrapResponse> {
        const parts = await this.repo.loadRevisionParts();
        const snapshotRevision = snapshotRevisionFromParts(parts);

        if (clientRevision && clientRevision === snapshotRevision) {
            return { snapshotRevision, unchanged: true };
        }

        const rows = await this.repo.loadSnapshot();
        return {
            snapshotRevision,
            unchanged: false,
            routes: rows.routes.map(toFieldRoute),
            variants: rows.variants
                .map(toFieldVariant)
                .filter((row): row is NonNullable<typeof row> => row !== null),
            stops: rows.stops
                .map(toFieldStop)
                .filter((row): row is NonNullable<typeof row> => row !== null),
            routeStops: sortRouteStops(
                rows.routeStops
                    .map(toFieldRouteStop)
                    .filter((row): row is NonNullable<typeof row> => row !== null)
            ),
            routePaths: rows.routePaths
                .map(toFieldRoutePath)
                .filter((row): row is NonNullable<typeof row> => row !== null),
        };
    }
}

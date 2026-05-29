import { importTransportRoutePath } from "./constants";
import type { ImportTransportEntityConfig, ImportTransportEntityConfigInput } from "./types";

export function createImportTransportEntityConfig(
    input: ImportTransportEntityConfigInput
): ImportTransportEntityConfig {
    return {
        ...input,
        routePath: input.routePath ?? importTransportRoutePath(input.slug),
    };
}

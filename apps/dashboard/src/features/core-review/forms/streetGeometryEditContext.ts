import type { UseFormWatch } from "react-hook-form";

import type { CoreEntityFormValues, CoreEntityKey } from "@/src/lib/core-review/entityConfigs/types";

import type { StreetSplitMapProps } from "./StreetEditExtras";

/** Map/validation props required by standalone and drawer street (road) edit. */
export type StreetGeometryEditContext = {
    roadClassId: string | undefined;
    snapExcludePublicId: string | null;
    selectedStreetName: string | null;
    streetSplitMapProps: StreetSplitMapProps | null;
};

function snapExcludeFromDetail(detail: unknown | null): string | null {
    if (!detail || typeof detail !== "object") {
        return null;
    }
    if ("public_id" in detail && detail.public_id) {
        return String(detail.public_id);
    }
    if ("publicId" in detail && detail.publicId) {
        return String(detail.publicId);
    }
    return null;
}

function selectedStreetNameFromDetail(detail: unknown | null): string | null {
    if (!detail || typeof detail !== "object") {
        return null;
    }
    if ("canonical_name" in detail && detail.canonical_name) {
        return String(detail.canonical_name);
    }
    return null;
}

/**
 * Resolves road/street-specific map editor props shared by {@link CoreEntityFormPage}
 * and {@link CoreEntityDrawerEditForm}.
 *
 * `validateWithApi` remains on `STREETS_ENTITY_CONFIG.geometry` — not computed here.
 */
export function resolveStreetGeometryEditContext({
    entityKey,
    watch,
    externalId,
    recordId,
    detail,
    streetSplitMapProps = null,
}: {
    entityKey: CoreEntityKey;
    watch: UseFormWatch<CoreEntityFormValues>;
    externalId: string | null;
    recordId?: string | null;
    detail: unknown | null;
    streetSplitMapProps?: StreetSplitMapProps | null;
}): StreetGeometryEditContext | null {
    if (entityKey !== "streets") {
        return null;
    }

    return {
        roadClassId: watch("road_class_id") as string | undefined,
        snapExcludePublicId: externalId ?? snapExcludeFromDetail(detail) ?? recordId ?? null,
        selectedStreetName: selectedStreetNameFromDetail(detail),
        streetSplitMapProps,
    };
}

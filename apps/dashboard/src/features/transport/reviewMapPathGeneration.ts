import { hasSavedRoutePathGeometry } from "./routePathDisplay";
import type {
    GeneratePathFromStopsResult,
    TransportRoutePath,
    TransportRouteStopItem,
    TransportVariantSummary,
} from "./types";

export type GeneratePathFromStopsReadiness = {
    eligible: boolean;
    reasons: string[];
};

export type GeneratePathFromStopsCopy = {
    buttonLabel: string;
    dialogTitle: string;
    dialogBody: string;
    confirmLabel: string;
    busyLabel: string;
    enabledTitle: string;
};

function stopHasGeometry(stop: TransportRouteStopItem): boolean {
    const g = stop.stop.geometry;
    if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) {
        return false;
    }
    const lng = Number(g.coordinates[0]);
    const lat = Number(g.coordinates[1]);
    return Number.isFinite(lng) && Number.isFinite(lat);
}

/** True when stop_sequence is 1..N with no gaps (list is already ordered). */
export function isStopSequenceContinuous(stops: readonly TransportRouteStopItem[]): boolean {
    if (stops.length < 2) {
        return false;
    }
    for (let i = 0; i < stops.length; i++) {
        if (stops[i]?.stop_sequence !== i + 1) {
            return false;
        }
    }
    return true;
}

export function evaluateGeneratePathFromStopsReadiness(
    stops: readonly TransportRouteStopItem[],
    hasUnsavedStopMoves: boolean,
): GeneratePathFromStopsReadiness {
    const reasons: string[] = [];

    if (stops.length < 2) {
        reasons.push("Select a variant with at least 2 stops.");
    }
    if (stops.length >= 2 && stops.some((s) => !stopHasGeometry(s))) {
        reasons.push("Every stop must have a saved location.");
    }
    if (stops.length >= 2 && !isStopSequenceContinuous(stops)) {
        reasons.push("Stop sequence must be continuous (1, 2, 3, …).");
    }
    if (hasUnsavedStopMoves) {
        reasons.push("Save or revert stop changes first.");
    }

    return { eligible: reasons.length === 0, reasons };
}

/** Button, dialog, and tooltip copy. Same API is used for first generate and regenerate. */
export function generatePathFromStopsCopy(hasSavedPath: boolean): GeneratePathFromStopsCopy {
    if (hasSavedPath) {
        return {
            buttonLabel: "Regenerate from stops",
            dialogTitle: "Regenerate path from stops",
            dialogBody:
                "This will replace the current route path using the current saved stop locations. Stop locations will not be changed.",
            confirmLabel: "Regenerate",
            busyLabel: "Generating…",
            enabledTitle: "Replace the current path using current saved stop locations",
        };
    }
    return {
        buttonLabel: "Generate path from stops",
        dialogTitle: "Generate path from stops",
        dialogBody: "This will generate a road-following path from the current saved stop locations.",
        confirmLabel: "Generate path",
        busyLabel: "Generating…",
        enabledTitle: "Generate a road-following path from ordered stops",
    };
}

export function generatePathSuccessToastMessage(warnings: readonly string[]): string {
    if (warnings.length === 0) {
        return "Auto-generated path saved";
    }
    const n = warnings.length;
    return `Path generated with ${n} routing warning${n === 1 ? "" : "s"}`;
}

export function applyGeneratedPathToLocalPath(
    result: GeneratePathFromStopsResult,
): TransportRoutePath {
    return {
        id: result.route_path_id,
        path_kind: result.path_kind,
        review_status: result.review_status,
        distance_m: result.distance_m,
        geometry: result.geometry,
    };
}

export function applyGeneratedPathToVariantSummary(
    variant: TransportVariantSummary,
    result: Pick<GeneratePathFromStopsResult, "distance_m">,
): TransportVariantSummary {
    return {
        ...variant,
        path_status: "has_path",
        path_count: Math.max(variant.path_count, 1),
        distance_m: result.distance_m,
    };
}

export type GeneratePathSuccessUi = {
    path: TransportRoutePath;
    variants: TransportVariantSummary[];
    stops: readonly TransportRouteStopItem[];
    reloadStopQuality: true;
    closeDialog: true;
    toastMessage: string;
    warnings: string[];
    canEditPath: boolean;
};

/** Local UI updates after a successful generate/regenerate. Does not mutate stop rows. */
export function buildGeneratePathSuccessUi(input: {
    stops: readonly TransportRouteStopItem[];
    variants: readonly TransportVariantSummary[];
    selectedVariantId: string;
    result: GeneratePathFromStopsResult;
}): GeneratePathSuccessUi {
    const path = applyGeneratedPathToLocalPath(input.result);
    return {
        path,
        variants: input.variants.map((variant) =>
            variant.public_id === input.selectedVariantId
                ? applyGeneratedPathToVariantSummary(variant, input.result)
                : variant,
        ),
        stops: input.stops,
        reloadStopQuality: true,
        closeDialog: true,
        toastMessage: generatePathSuccessToastMessage(input.result.warnings),
        warnings: [...input.result.warnings],
        canEditPath: hasSavedRoutePathGeometry(path),
    };
}

export type GeneratePathFailureUi = {
    closeDialog: false;
    retryable: true;
    error: string;
};

/** Keep the confirm dialog open so the admin can retry after Valhalla is back. */
export function buildGeneratePathFailureUi(error: unknown): GeneratePathFailureUi {
    const message =
        error instanceof Error ? error.message : "Failed to generate path from stops.";
    return {
        closeDialog: false,
        retryable: true,
        error: message,
    };
}

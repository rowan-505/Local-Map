export type SearchIndexHealthLoadPhase = "initial" | "loaded" | "refreshing" | "error";

export function phaseAtSearchIndexHealthLoadStart(
    hasData: boolean,
    isRefresh: boolean,
): SearchIndexHealthLoadPhase {
    if (isRefresh && hasData) {
        return "refreshing";
    }
    if (!hasData) {
        return "initial";
    }
    return "loaded";
}

export function resolveSearchIndexHealthLoadPhase(input: {
    hasData: boolean;
    isRefresh: boolean;
    success: boolean;
}): SearchIndexHealthLoadPhase {
    if (input.success) {
        return "loaded";
    }
    if (input.isRefresh && input.hasData) {
        return "loaded";
    }
    return "error";
}

export function shouldShowSearchIndexHealthSkeleton(
    phase: SearchIndexHealthLoadPhase,
    hasData: boolean,
): boolean {
    return !hasData && (phase === "initial" || phase === "refreshing");
}

export function shouldShowSearchIndexHealthContent(
    phase: SearchIndexHealthLoadPhase,
    hasData: boolean,
): boolean {
    return hasData && phase !== "initial";
}

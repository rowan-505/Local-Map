import type { ReviewMapNearbyCandidateSearchCenterSource } from "./reviewMapNearbyCandidatesSearch";

/** Default debounce for map-click / preview reposition nearby searches. */
export const REVIEW_MAP_NEARBY_SEARCH_DEBOUNCE_MS = 300;

/**
 * Initial selected-stop (saved) and explicit retry/revert stay immediate.
 * Map-click preview movement is debounced.
 */
export function shouldSearchNearbyImmediately(
    source: ReviewMapNearbyCandidateSearchCenterSource | null | undefined,
    options?: { readonly forceImmediate?: boolean },
): boolean {
    if (options?.forceImmediate === true) {
        return true;
    }
    return source === "saved";
}

export type DebouncedNearbySearchScheduler = {
    /** Schedule work; rapid calls collapse to one final execute after debounce. */
    schedule: (options: { readonly immediate: boolean }, execute: () => void) => void;
    /** Cancel pending timer without running execute. */
    clear: () => void;
    /** Generation counter — bump on clear/abort so stale work can be ignored. */
    readonly generation: () => number;
    /** Advance generation (e.g. on abort / unmount). */
    bumpGeneration: () => void;
};

/**
 * Pure debounce scheduler for nearby candidate searches (testable without React).
 * Immediate bypasses debounce. Only the latest scheduled execute runs.
 */
export function createDebouncedNearbySearchScheduler(options?: {
    readonly debounceMs?: number;
    readonly setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    readonly clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
}): DebouncedNearbySearchScheduler {
    const debounceMs = options?.debounceMs ?? REVIEW_MAP_NEARBY_SEARCH_DEBOUNCE_MS;
    const setTimeoutFn = options?.setTimeoutFn ?? setTimeout;
    const clearTimeoutFn = options?.clearTimeoutFn ?? clearTimeout;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let generation = 0;

    const clear = () => {
        if (timer !== null) {
            clearTimeoutFn(timer);
            timer = null;
        }
    };

    return {
        schedule(scheduleOptions, execute) {
            clear();
            if (scheduleOptions.immediate) {
                generation += 1;
                const gen = generation;
                execute();
                // Caller may check generation() after async work.
                void gen;
                return;
            }
            generation += 1;
            const gen = generation;
            timer = setTimeoutFn(() => {
                timer = null;
                if (gen !== generation) {
                    return;
                }
                execute();
            }, debounceMs);
        },
        clear: () => {
            clear();
        },
        generation: () => generation,
        bumpGeneration: () => {
            clear();
            generation += 1;
        },
    };
}

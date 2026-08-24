export type StopFocusItem = { readonly id?: string | null };

/**
 * Returns at most three consecutive stops centered on the selected occurrence.
 * At route ends, the window shifts so three stops remain visible when available.
 */
export function selectedStopFocusWindow<T extends StopFocusItem>(
    stops: readonly T[],
    selectedStopId: string,
): readonly T[] {
    const selectedIndex = stops.findIndex((stop) => stop.id === selectedStopId);
    if (selectedIndex < 0) {
        return [];
    }

    const windowSize = Math.min(3, stops.length);
    const maxStart = stops.length - windowSize;
    const start = Math.min(Math.max(selectedIndex - 1, 0), maxStart);
    return stops.slice(start, start + windowSize);
}

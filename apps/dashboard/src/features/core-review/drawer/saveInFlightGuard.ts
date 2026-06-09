/** Synchronous save mutex for core-review edit submit (ref survives re-renders). */
export function tryAcquireInFlightRef(inFlightRef: { current: boolean }): boolean {
    if (inFlightRef.current) {
        return false;
    }
    inFlightRef.current = true;
    return true;
}

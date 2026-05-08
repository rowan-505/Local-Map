/** Client-only debug logging (no-op in production builds). */
export function dashDevLog(scope: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV === "production") {
        return;
    }
    console.info(`[dashboard:${scope}]`, ...args);
}

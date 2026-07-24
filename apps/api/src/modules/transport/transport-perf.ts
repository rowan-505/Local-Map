/**
 * Gated transport request performance logging (`TRANSPORT_PERF_LOG=1`).
 * Never log JWTs, secrets, DATABASE_URL, or full private payloads.
 */

export function isTransportPerfLogEnabled(): boolean {
    return process.env.TRANSPORT_PERF_LOG === "1";
}

export type TransportRequestPerfLog = {
    readonly requestId: string | null;
    readonly endpoint: string;
    readonly totalDurationMs: number;
    readonly repositoryDurationMs?: number;
    readonly transactionDurationMs?: number;
    readonly resultCount?: number;
    readonly statusCode: number;
    readonly duplicateCheckDurationMs?: number;
};

type FastifyLikeLogger = {
    info: (obj: Record<string, unknown>, msg?: string) => void;
};

export function logTransportRequestPerf(
    log: FastifyLikeLogger,
    fields: TransportRequestPerfLog,
): void {
    if (!isTransportPerfLogEnabled()) {
        return;
    }
    log.info({ ...fields }, "[transport.perf] request");
}

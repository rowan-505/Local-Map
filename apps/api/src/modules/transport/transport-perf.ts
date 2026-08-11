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
    readonly action?: string;
    readonly totalDurationMs: number;
    readonly authDurationMs?: number;
    readonly validationDurationMs?: number;
    readonly serviceDurationMs?: number;
    readonly repositoryDurationMs?: number;
    readonly connectionAcquireDurationMs?: number;
    readonly transactionDurationMs?: number;
    readonly queryCount?: number;
    readonly totalDbDurationMs?: number;
    readonly serializationDurationMs?: number;
    readonly responseSizeBytes?: number;
    readonly resultCount?: number;
    readonly statusCode: number;
    readonly success?: boolean;
    readonly duplicateCheckDurationMs?: number;
    readonly stages?: Readonly<Record<string, number>>;
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

/**
 * Named stage timer for mutation transactions. No-op when TRANSPORT_PERF_LOG is off.
 * Records wall time between consecutive `mark` calls.
 */
export type MutationStageTimer = {
    mark: (stage: string) => void;
    /** Time from construction until now (or last mark if already finalized). */
    elapsedMs: () => number;
    stages: () => Readonly<Record<string, number>>;
    queryCount: () => number;
    incrementQuery: (by?: number) => void;
    done: (label?: string) => Readonly<Record<string, number>>;
};

export function createMutationStageTimer(label: string): MutationStageTimer {
    if (!isTransportPerfLogEnabled()) {
        const empty = {} as Record<string, number>;
        return {
            mark: () => undefined,
            elapsedMs: () => 0,
            stages: () => empty,
            queryCount: () => 0,
            incrementQuery: () => undefined,
            done: () => empty,
        };
    }

    const started = performance.now();
    let last = started;
    let queries = 0;
    const stageMs: Record<string, number> = {};

    return {
        mark(stage: string) {
            const now = performance.now();
            stageMs[stage] = Number((now - last).toFixed(1));
            last = now;
            // eslint-disable-next-line no-console
            console.log(
                `[transport.perf] ${label} | ${stage}: +${stageMs[stage]}ms (elapsed ${(now - started).toFixed(1)}ms)`,
            );
        },
        elapsedMs() {
            return Number((performance.now() - started).toFixed(1));
        },
        stages() {
            return stageMs;
        },
        queryCount() {
            return queries;
        },
        incrementQuery(by = 1) {
            queries += by;
        },
        done(doneLabel?: string) {
            const total = Number((performance.now() - started).toFixed(1));
            stageMs._totalMs = total;
            stageMs._queryCount = queries;
            // eslint-disable-next-line no-console
            console.log(
                `[transport.perf] ${doneLabel ?? label} | done total=${total}ms queries=${queries}`,
            );
            return stageMs;
        },
    };
}

/** Approximate JSON response size without logging the body. */
export function estimateJsonResponseBytes(value: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
        return 0;
    }
}

/**
 * Case recorder + SQL helpers for transport review regression tests.
 * Never logs JWTs or secrets.
 */

export type RegressionCaseResult = {
    feature: string;
    caseName: string;
    endpoint: string;
    expectedStatus: number | string;
    actualStatus: number | string;
    result: "PASS" | "FAIL" | "SKIP";
    errorCode: string | null;
    prismaCode: string | null;
    sqlState: string | null;
    constraint: string | null;
    dataChanged: boolean | "n/a" | "rolled_back";
    notes?: string;
};

const cases: RegressionCaseResult[] = [];

export function recordCase(entry: RegressionCaseResult): void {
    cases.push(entry);
}

export function getRecordedCases(): readonly RegressionCaseResult[] {
    return cases;
}

export function clearRecordedCases(): void {
    cases.length = 0;
}

export function extractSql(arg: unknown): string {
    if (Array.isArray(arg)) {
        return arg.join("?");
    }
    if (arg && typeof arg === "object") {
        const obj = arg as Record<string, unknown>;
        if (typeof obj.sql === "string") return obj.sql;
        if (typeof obj.text === "string") return obj.text;
        if (Array.isArray(obj.strings)) return (obj.strings as string[]).join("?");
    }
    return String(arg);
}

export function extractValues(arg: unknown): unknown[] {
    if (arg && typeof arg === "object") {
        const obj = arg as Record<string, unknown>;
        if (Array.isArray(obj.values)) return obj.values;
    }
    return [];
}

/** True when a value tree still contains native bigint (unsafe for JSON). */
export function containsBigInt(value: unknown, seen = new Set<unknown>()): boolean {
    if (typeof value === "bigint") {
        return true;
    }
    if (value === null || value === undefined) {
        return false;
    }
    if (typeof value !== "object") {
        return false;
    }
    if (seen.has(value)) {
        return false;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.some((item) => containsBigInt(item, seen));
    }
    return Object.values(value as Record<string, unknown>).some((item) =>
        containsBigInt(item, seen),
    );
}

export function assertJsonSafe(value: unknown): void {
    if (containsBigInt(value)) {
        throw new Error("Response contains bigint values (not JSON-safe).");
    }
    JSON.stringify(value);
}

/**
 * Runs work inside a mock transaction that rolls back on throw by restoring
 * a deep-cloned snapshot via `restore()`.
 */
export async function withRollbackSnapshot<T>(options: {
    snapshot: () => void;
    restore: () => void;
    run: () => Promise<T>;
}): Promise<{ ok: true; value: T } | { ok: false; error: unknown; rolledBack: true }> {
    options.snapshot();
    try {
        const value = await options.run();
        return { ok: true, value };
    } catch (error) {
        options.restore();
        return { ok: false, error, rolledBack: true };
    }
}

export function domainErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object") {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
}

export function domainStatusCode(error: unknown): number | null {
    if (!error || typeof error !== "object") {
        return null;
    }
    const status = (error as { statusCode?: unknown }).statusCode;
    return typeof status === "number" ? status : null;
}

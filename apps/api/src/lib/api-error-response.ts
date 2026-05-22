/** JSON-safe values allowed in API error `details`. */
export type JsonSafeValue =
    | null
    | string
    | number
    | boolean
    | JsonSafeValue[]
    | { [key: string]: JsonSafeValue };

export type ApiErrorResponseBody = {
    ok: false;
    error: string;
    message: string;
    details: JsonSafeValue;
};

/** OpenAPI / fast-json-stringify schema for JSON-safe `details` payloads. */
export const apiErrorDetailsSchema = {
    anyOf: [
        { type: "null" },
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "array", items: {} },
        { type: "object", additionalProperties: true },
    ],
} as const;

export const apiErrorResponseSchema = {
    type: "object",
    required: ["ok", "error", "message", "details"],
    properties: {
        ok: { type: "boolean", const: false },
        error: { type: "string" },
        message: { type: "string" },
        details: apiErrorDetailsSchema,
    },
    additionalProperties: false,
} as const;

export function toJsonSafeValue(value: unknown): JsonSafeValue {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toJsonSafeValue(entry));
    }
    if (typeof value === "object") {
        if (value instanceof Error) {
            return { message: value.message };
        }
        const out: Record<string, JsonSafeValue> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") {
                continue;
            }
            out[key] = toJsonSafeValue(entry);
        }
        return out;
    }
    return null;
}

export function buildApiErrorResponse(
    errorCode: string,
    message: string,
    details?: unknown
): ApiErrorResponseBody {
    return {
        ok: false,
        error: errorCode,
        message,
        details: details === undefined ? null : toJsonSafeValue(details),
    };
}

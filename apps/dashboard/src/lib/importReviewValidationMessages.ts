/** Parse validation_errors / validation_warnings JSONB from import-review API (strings or {code,message}). */
export function validationMessagesFromReviewJson(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry === "string") {
            const t = entry.trim();
            if (t.length > 0) {
                out.push(t);
            }
            continue;
        }
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            const o = entry as Record<string, unknown>;
            const code = typeof o.code === "string" ? o.code.trim() : "";
            const message = typeof o.message === "string" ? o.message.trim() : "";
            if (message.length > 0) {
                out.push(code.length > 0 ? `[${code}] ${message}` : message);
            }
        }
    }
    return out;
}

export function validationIssuesFromReviewJson(
    raw: unknown,
    severity: "error" | "warning" | "info",
): { code: string; message: string; severity: typeof severity }[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: { code: string; message: string; severity: typeof severity }[] = [];
    for (const entry of raw) {
        if (typeof entry === "string") {
            const t = entry.trim();
            if (t.length > 0) {
                out.push({ code: "", message: t, severity });
            }
            continue;
        }
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
            const o = entry as Record<string, unknown>;
            const message = typeof o.message === "string" ? o.message.trim() : "";
            if (message.length > 0) {
                out.push({
                    code: typeof o.code === "string" ? o.code.trim() : "",
                    message,
                    severity:
                        o.severity === "error" || o.severity === "warning" || o.severity === "info"
                            ? o.severity
                            : severity,
                });
            }
        }
    }
    return out;
}

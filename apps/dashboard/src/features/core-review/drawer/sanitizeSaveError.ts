export function sanitizeSaveError(err: unknown): string {
    const raw = err instanceof Error ? err.message : "Request failed";
    if (/\n/.test(raw)) {
        return raw;
    }
    const looksTechnical =
        raw.length > 400 ||
        /\b(pg_|postgresql|prisma|P1012|syntax error at|permission denied for relation|syntax error\b)/i.test(
            raw,
        );
    if (looksTechnical) {
        return "Saving failed. Please try again.";
    }
    return raw;
}

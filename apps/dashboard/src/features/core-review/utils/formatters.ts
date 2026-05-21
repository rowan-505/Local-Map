export function dash(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
        return "-";
    }
    if (typeof value === "string" && value.trim() === "") {
        return "-";
    }
    return String(value);
}

export function formatDate(value: string | null | undefined): string {
    if (value === null || value === undefined || value.trim() === "") {
        return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString();
}

export function formatArea(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) {
        return "-";
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function yesNo(value: boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return "-";
    }
    return value ? "Yes" : "No";
}

export function safeTechnicalClientMessage(raw: string, readableFallback: string): string {
    if (
        raw.length > 400 ||
        /\b(pg_|postgresql|prisma|P1012|syntax error at|violates|duplicate key value|permission denied for relation)\b/i.test(
            raw
        )
    ) {
        return readableFallback;
    }
    return raw;
}

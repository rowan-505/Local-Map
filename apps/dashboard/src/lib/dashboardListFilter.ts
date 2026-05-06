/** Trimmed lowercase needle; empty means “match all”. */
export function listSearchNeedle(raw: string): string {
    return raw.trim().toLowerCase();
}

/** Case-insensitive substring match. */
export function haystackMatchesNeedle(haystack: unknown, needle: string): boolean {
    if (needle.length === 0) {
        return true;
    }

    return String(haystack ?? "")
        .toLowerCase()
        .includes(needle);
}

/** Row matches if any rendered cell value contains the needle. */
export function rowMatchesListSearch(needle: string, cells: unknown[]): boolean {
    if (needle.length === 0) {
        return true;
    }

    return cells.some((cell) => haystackMatchesNeedle(cell, needle));
}

export function compareStringsLocale(a: unknown, b: unknown, ascending: boolean): number {
    const sa = String(a ?? "")
        .trim()
        .toLocaleLowerCase();
    const sb = String(b ?? "")
        .trim()
        .toLocaleLowerCase();
    const c = sa.localeCompare(sb, undefined, { sensitivity: "base" });

    return ascending ? c : -c;
}

/** `newestFirst` true = descending by time. */
export function compareIsoDates(a: unknown, b: unknown, newestFirst: boolean): number {
    const ta = typeof a === "string" && a ? new Date(a).getTime() : NaN;
    const tb = typeof b === "string" && b ? new Date(b).getTime() : NaN;
    const va = Number.isFinite(ta) ? ta : 0;
    const vb = Number.isFinite(tb) ? tb : 0;
    const cmp = va - vb;

    return newestFirst ? -cmp : cmp;
}

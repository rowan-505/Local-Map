/** Minimal class merger for component variants (no extra deps). */
export function cn(...parts: Array<string | undefined | null | false>): string {
    return parts.filter(Boolean).join(" ");
}

"use client";

export type HighlightMatchProps = {
    /** Supports string, number, null, undefined — coerced safely. */
    text: unknown;
    /** Search string — non-strings coerced safely; trims for matching only. */
    query: unknown;
    className?: string;
};

const defaultMarkClass = "rounded-sm bg-yellow-200 px-0.5 text-inherit";

type Chunk = { t: string; hit: boolean };

function toSafeString(value: unknown): string {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value);
}

function toTrimmedQuery(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }

    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}

function buildChunks(safeText: string, query: string): Chunk[] {
    if (safeText.length === 0) {
        return [];
    }

    if (query.length === 0) {
        return [{ t: safeText, hit: false }];
    }

    const lowerHay = safeText.toLowerCase();
    const lowerNeedle = query.toLowerCase();
    const chunks: Chunk[] = [];
    let i = 0;

    while (i < safeText.length) {
        const idx = lowerHay.indexOf(lowerNeedle, i);

        if (idx === -1) {
            chunks.push({ t: safeText.slice(i), hit: false });
            break;
        }

        if (idx > i) {
            chunks.push({ t: safeText.slice(i, idx), hit: false });
        }

        chunks.push({ t: safeText.slice(idx, idx + query.length), hit: true });
        i = idx + query.length;
    }

    return chunks;
}

/**
 * Renders `text` with every case-insensitive `query` match wrapped in a yellow `<mark />`.
 * Preserves original casing; safe for null/undefined/number inputs.
 */
export default function HighlightMatch({
    text,
    query,
    className = defaultMarkClass,
}: HighlightMatchProps) {
    const safeText = toSafeString(text);
    const q = toTrimmedQuery(query);
    const chunks = buildChunks(safeText, q);

    if (chunks.length === 0) {
        return null;
    }

    if (!q) {
        return <>{safeText}</>;
    }

    return (
        <>
            {chunks.map((chunk, index) =>
                chunk.hit ? (
                    <mark key={`m-${index}`} className={className}>
                        {chunk.t}
                    </mark>
                ) : (
                    <span key={`s-${index}`}>{chunk.t}</span>
                )
            )}
        </>
    );
}

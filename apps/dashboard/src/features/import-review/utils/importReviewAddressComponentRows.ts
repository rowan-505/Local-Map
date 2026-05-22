import type {
    ImportReviewAddressComponentDto,
    PatchImportReviewAddressComponentsBody,
} from "@/src/lib/api";

export type AddressComponentEditorRow = {
    rowKey: string;
    component_type_code: string;
    en: string;
    my: string;
    und: string;
    match_type: string;
    confidence_score: string;
    source_summary: string;
    component_ids: { en?: string; my?: string; und?: string };
    is_reviewed: boolean;
};

let rowKeyCounter = 0;
function newRowKey(type: string): string {
    rowKeyCounter += 1;
    return `${type}::${rowKeyCounter}`;
}

export function flatComponentsToEditorRows(
    flat: readonly ImportReviewAddressComponentDto[] | undefined
): AddressComponentEditorRow[] {
    if (!flat?.length) {
        return [];
    }
    const byType = new Map<string, AddressComponentEditorRow>();

    for (const c of flat) {
        let row = byType.get(c.component_type_code);
        if (!row) {
            row = {
                rowKey: newRowKey(c.component_type_code),
                component_type_code: c.component_type_code,
                en: "",
                my: "",
                und: "",
                match_type: c.match_type ?? "",
                confidence_score:
                    c.confidence_score !== null && c.confidence_score !== undefined
                        ? String(c.confidence_score)
                        : "",
                source_summary: summarizeSource(c),
                component_ids: {},
                is_reviewed: c.is_reviewed,
            };
            byType.set(c.component_type_code, row);
        }
        if (c.language_code === "en") {
            row.en = c.component_value;
            row.component_ids.en = c.id;
        } else if (c.language_code === "my") {
            row.my = c.component_value;
            row.component_ids.my = c.id;
        } else {
            row.und = c.component_value;
            row.component_ids.und = c.id;
        }
        if (c.is_reviewed) {
            row.is_reviewed = true;
        }
        if (!row.match_type && c.match_type) {
            row.match_type = c.match_type;
        }
        if (!row.confidence_score && c.confidence_score !== null) {
            row.confidence_score = String(c.confidence_score);
        }
        row.source_summary = summarizeSource(c);
    }

    return [...byType.values()].sort((a, b) => a.component_type_code.localeCompare(b.component_type_code));
}

function summarizeSource(c: ImportReviewAddressComponentDto): string {
    const parts: string[] = [];
    if (c.match_type) {
        parts.push(c.match_type);
    }
    if (c.source_tag) {
        parts.push(c.source_tag);
    }
    if (c.is_inferred) {
        parts.push("inferred");
    }
    if (c.is_reviewed) {
        parts.push("reviewed");
    }
    return parts.join(" · ") || "—";
}

export function editorRowsToPatchBody(
    rows: readonly AddressComponentEditorRow[],
    deletedIds: readonly string[]
): PatchImportReviewAddressComponentsBody {
    const upsert: PatchImportReviewAddressComponentsBody["upsert"] = [];

    for (const row of rows) {
        const confidence =
            row.confidence_score.trim() === "" ? null : Number(row.confidence_score);
        const matchType = row.match_type.trim() || null;
        const langs: Array<{ key: "en" | "my" | "und"; value: string; id?: string }> = [
            { key: "en", value: row.en.trim(), id: row.component_ids.en },
            { key: "my", value: row.my.trim(), id: row.component_ids.my },
            { key: "und", value: row.und.trim(), id: row.component_ids.und },
        ];
        for (const lang of langs) {
            if (lang.value === "") {
                continue;
            }
            upsert.push({
                ...(lang.id ? { id: lang.id } : {}),
                component_type_code: row.component_type_code.trim(),
                component_value: lang.value,
                language_code: lang.key,
                confidence_score: Number.isFinite(confidence as number) ? confidence : null,
                match_type: matchType,
                is_reviewed: row.is_reviewed || undefined,
            });
        }
    }

    return {
        upsert,
        delete_ids: deletedIds.length > 0 ? [...deletedIds] : undefined,
    };
}

export function collectDeleteIdsForRemovedRows(
    previous: readonly AddressComponentEditorRow[],
    next: readonly AddressComponentEditorRow[]
): string[] {
    const nextIds = new Set(next.map((r) => r.rowKey));
    const out: string[] = [];
    for (const row of previous) {
        if (nextIds.has(row.rowKey)) {
            continue;
        }
        for (const id of Object.values(row.component_ids)) {
            if (id) {
                out.push(id);
            }
        }
    }
    return out;
}

export function collectDeleteIdsForClearedLanguages(
    previous: AddressComponentEditorRow,
    next: AddressComponentEditorRow
): string[] {
    const out: string[] = [];
    if (previous.component_ids.en && !next.en.trim()) {
        out.push(previous.component_ids.en);
    }
    if (previous.component_ids.my && !next.my.trim()) {
        out.push(previous.component_ids.my);
    }
    if (previous.component_ids.und && !next.und.trim()) {
        out.push(previous.component_ids.und);
    }
    return out;
}

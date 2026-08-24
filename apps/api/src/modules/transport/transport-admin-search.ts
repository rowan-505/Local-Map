const MYANMAR_DIGITS: Record<string, string> = {
    "၀": "0",
    "၁": "1",
    "၂": "2",
    "၃": "3",
    "၄": "4",
    "၅": "5",
    "၆": "6",
    "၇": "7",
    "၈": "8",
    "၉": "9",
};

function replaceMyanmarDigits(value: string): string {
    return value.replace(/[၀-၉]/g, (digit) => MYANMAR_DIGITS[digit] ?? digit);
}

const ASCII_TO_MYANMAR_DIGITS = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"] as const;

function replaceAsciiDigits(value: string): string {
    return value.replace(/\d/g, (digit) => ASCII_TO_MYANMAR_DIGITS[Number(digit)] ?? digit);
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (part) => `\\${part}`);
}

export type TransportAdminSearch = {
    readonly exact: string;
    readonly original: string;
    readonly containsLike: string;
    readonly originalContainsLike: string;
    readonly myanmarContainsLike: string;
    readonly prefixLike: string;
    readonly compactCode: string;
    readonly numericCode: string | null;
};

/** Normalizes Myanmar digits and code separators while retaining native-name search. */
export function buildTransportAdminSearch(search: string | undefined): TransportAdminSearch | null {
    const original = search?.normalize("NFKC").trim().replace(/\s+/g, " ") ?? "";
    if (!original) return null;

    const exact = replaceMyanmarDigits(original).toLocaleLowerCase("en-US");
    const compactCode = exact.replace(/[^a-z0-9]+/g, "");
    const numericCode = /^\d+$/.test(compactCode) ? compactCode : null;
    return {
        exact,
        original: original.toLocaleLowerCase("en-US"),
        containsLike: `%${escapeLike(exact)}%`,
        originalContainsLike: `%${escapeLike(original)}%`,
        myanmarContainsLike: `%${escapeLike(replaceAsciiDigits(exact))}%`,
        prefixLike: `${escapeLike(exact)}%`,
        compactCode,
        numericCode,
    };
}

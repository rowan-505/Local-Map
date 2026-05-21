"use client";

import type { ReactNode } from "react";

import HighlightMatch from "@/src/components/dashboard/HighlightMatch";
import { VerifiedBadge } from "@/src/components/review/ReviewStatusBadge";

import { dash } from "../utils/formatters";
import type { CoreReviewColumnDef } from "./entity-config-types";

export function hl(text: string, q: string): ReactNode {
    return q ? <HighlightMatch text={text} query={q} /> : text;
}

export function myanmarNameColumn<T>(
    getValue: (row: T) => string | null | undefined
): CoreReviewColumnDef<T> {
    return {
        id: "myanmar_name",
        header: "Myanmar name",
        cell: (r, q) => hl(dash(getValue(r)), q),
    };
}

export function englishNameColumn<T>(
    getValue: (row: T) => string | null | undefined
): CoreReviewColumnDef<T> {
    return {
        id: "english_name",
        header: "English name",
        cell: (r, q) => hl(dash(getValue(r)), q),
    };
}

export function verifiedColumn<T>(getValue: (row: T) => boolean): CoreReviewColumnDef<T> {
    return {
        id: "verified",
        header: "Verified",
        cell: (r) => <VerifiedBadge verified={getValue(r)} />,
    };
}

/** Myanmar, English, and Verified columns in a consistent order (append entity-specific columns before these). */
export function standardNameAndVerifiedColumns<T extends { isVerified: boolean }>(options: {
    myanmar: (row: T) => string | null | undefined;
    english: (row: T) => string | null | undefined;
}): CoreReviewColumnDef<T>[] {
    return [
        myanmarNameColumn(options.myanmar),
        englishNameColumn(options.english),
        verifiedColumn((r) => r.isVerified),
    ];
}

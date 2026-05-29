"use client";

import type { ReactNode } from "react";

import HighlightMatch from "@/src/components/dashboard/HighlightMatch";

import CoreReviewVerificationStatusCell from "../components/CoreReviewVerificationStatusCell";
import { dash } from "../utils/formatters";
import type { CoreReviewColumnDef } from "./entity-config-types";

export type CoreReviewVerificationColumnRow = {
    verificationStatus?: string | null;
    isVerified: boolean;
};

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

export function verificationStatusColumn<T extends CoreReviewVerificationColumnRow>(
    options?: {
        header?: string;
        getStatus?: (row: T) => string | null | undefined;
        getIsVerifiedFallback?: (row: T) => boolean | null | undefined;
    },
): CoreReviewColumnDef<T> {
    const header = options?.header ?? "Verification";
    const getStatus = options?.getStatus ?? ((row: T) => row.verificationStatus);
    const getIsVerifiedFallback =
        options?.getIsVerifiedFallback ?? ((row: T) => row.isVerified);

    return {
        id: "verification",
        header,
        cell: (r) => (
            <CoreReviewVerificationStatusCell
                status={getStatus(r)}
                isVerifiedFallback={getIsVerifiedFallback(r)}
            />
        ),
    };
}

/** Myanmar, English, and verification columns in a consistent order. */
export function standardNameAndVerificationColumns<T extends CoreReviewVerificationColumnRow>(options: {
    myanmar: (row: T) => string | null | undefined;
    english: (row: T) => string | null | undefined;
}): CoreReviewColumnDef<T>[] {
    return [
        myanmarNameColumn(options.myanmar),
        englishNameColumn(options.english),
        verificationStatusColumn<T>(),
    ];
}

/** @deprecated Use standardNameAndVerificationColumns */
export const standardNameAndVerifiedColumns = standardNameAndVerificationColumns;

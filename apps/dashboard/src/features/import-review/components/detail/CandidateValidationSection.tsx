"use client";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import { validationMessagesFromReviewJson } from "@/src/lib/importReviewValidationMessages";

import { jsonishSignalsPresent, safeJson } from "../../utils/detailDrawerUtils";

import ImportReviewInlineSpinner from "../ImportReviewInlineSpinner";
import { IMPORT_REVIEW_LOADING } from "../../utils/loadingMessages";

export default function CandidateValidationSection({
    row,
    isLoadingDetail = false,
}: {
    row: ImportReviewBuildingListItem;
    isLoadingDetail?: boolean;
}) {
    const errors = validationMessagesFromReviewJson(row.validation_errors);
    const warnings = validationMessagesFromReviewJson(row.validation_warnings);
    const hasErrors = errors.length > 0 || jsonishSignalsPresent(row.validation_errors);
    const hasWarnings = warnings.length > 0 || jsonishSignalsPresent(row.validation_warnings);

    if (isLoadingDetail) {
        return (
            <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Validation</h3>
                <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingValidationDetails} />
            </section>
        );
    }

    if (!hasErrors && !hasWarnings) {
        return null;
    }

    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Validation</h3>
            {hasWarnings ? (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    <span className="font-semibold uppercase tracking-wide">Warnings</span>
                    {warnings.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4 font-normal">
                            {warnings.map((w) => (
                                <li key={w}>{w}</li>
                            ))}
                        </ul>
                    ) : (
                        <pre className="mt-1 whitespace-pre-wrap font-normal">{safeJson(row.validation_warnings)}</pre>
                    )}
                </div>
            ) : null}
            {hasErrors ? (
                <div className="rounded-lg border border-red-400 bg-red-50 px-3 py-2 text-xs text-red-950">
                    <span className="font-semibold uppercase tracking-wide">Errors</span>
                    {errors.length > 0 ? (
                        <ul className="mt-2 list-disc space-y-1 pl-4 font-normal">
                            {errors.map((e) => (
                                <li key={e}>{e}</li>
                            ))}
                        </ul>
                    ) : (
                        <pre className="mt-1 whitespace-pre-wrap font-normal">{safeJson(row.validation_errors)}</pre>
                    )}
                </div>
            ) : null}
        </section>
    );
}

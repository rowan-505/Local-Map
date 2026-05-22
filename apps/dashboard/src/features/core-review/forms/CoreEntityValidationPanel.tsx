"use client";

import type { FieldErrors } from "react-hook-form";

import type { CoreGeometryValidationResult } from "@/src/components/core-review/geometry";
import StreetGeometryValidationFeedback from "@/src/components/streets/StreetGeometryValidationFeedback";
import type { ValidateStreetGeometryResponse } from "@/src/lib/api";

export type CoreEntityValidationPanelProps = {
    fieldErrors?: FieldErrors<Record<string, unknown>>;
    geometryValidation?: CoreGeometryValidationResult | null;
    apiGeometryValidation?: ValidateStreetGeometryResponse | null;
    formError?: string | null;
};

function fieldErrorMessages(errors: FieldErrors<Record<string, unknown>>): string[] {
    const messages: string[] = [];
    for (const value of Object.values(errors)) {
        if (!value) continue;
        if (typeof value.message === "string") {
            messages.push(value.message);
        }
    }
    return messages;
}

function splitFormErrorLines(formError: string): string[] {
    return formError
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export default function CoreEntityValidationPanel({
    fieldErrors,
    geometryValidation,
    apiGeometryValidation,
    formError,
}: CoreEntityValidationPanelProps) {
    const fieldMsgs = fieldErrors ? fieldErrorMessages(fieldErrors) : [];
    const formErrorLines = formError ? splitFormErrorLines(formError) : [];
    const hasFieldErrors = fieldMsgs.length > 0;
    const hasGeometryIssues =
        geometryValidation &&
        (!geometryValidation.valid ||
            geometryValidation.errors.length > 0 ||
            geometryValidation.warnings.length > 0);
    const hasApiValidation =
        apiGeometryValidation &&
        (apiGeometryValidation.errors.length > 0 ||
            apiGeometryValidation.warnings.length > 0 ||
            apiGeometryValidation.crossings.length > 0 ||
            apiGeometryValidation.duplicates.length > 0);

    if (!formErrorLines.length && !hasFieldErrors && !hasGeometryIssues && !hasApiValidation) {
        return null;
    }

    return (
        <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Validation</h3>

            {formErrorLines.length > 0 ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <div className="font-semibold">Save error</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {formErrorLines.map((line) => (
                            <li key={line}>{line.replace(/^•\s*/, "")}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {hasFieldErrors ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <div className="font-semibold">Form errors</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {fieldMsgs.map((msg) => (
                            <li key={msg}>{msg}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {geometryValidation && hasGeometryIssues ? (
                <div className="space-y-2">
                    {geometryValidation.errors.map((msg) => (
                        <div
                            key={`geo-err-${msg}`}
                            className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                        >
                            {msg}
                        </div>
                    ))}
                    {geometryValidation.warnings.map((msg) => (
                        <div
                            key={`geo-warn-${msg}`}
                            className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
                        >
                            {msg}
                        </div>
                    ))}
                </div>
            ) : null}

            {apiGeometryValidation ? (
                <StreetGeometryValidationFeedback
                    errors={apiGeometryValidation.errors}
                    warnings={apiGeometryValidation.warnings}
                    crossings={apiGeometryValidation.crossings}
                    duplicates={apiGeometryValidation.duplicates}
                    validationSuccess={Boolean(
                        apiGeometryValidation.isValid &&
                            apiGeometryValidation.errors.length === 0 &&
                            apiGeometryValidation.warnings.length === 0,
                    )}
                />
            ) : null}
        </div>
    );
}

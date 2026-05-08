import type {
    StreetGeometryCrossingApi,
    StreetGeometryDuplicateApi,
} from "@/src/lib/api";

type Props = {
    errors: string[];
    warnings: string[];
    crossings?: StreetGeometryCrossingApi[];
    duplicates?: StreetGeometryDuplicateApi[];
    /** When the last validation run passed with no errors or warnings (clean centerline checks). */
    validationSuccess?: boolean;
};

function formatStreetHit(hit: StreetGeometryCrossingApi) {
    const name = hit.streetName?.trim() || "(unnamed)";
    const rc = hit.roadClass ? ` · ${hit.roadClass}` : "";
    return `${name}${rc} (${hit.streetId})`;
}

export default function StreetGeometryValidationFeedback({
    errors,
    warnings,
    crossings = [],
    duplicates = [],
    validationSuccess = false,
}: Props) {
    const hasIssues =
        errors.length > 0 || warnings.length > 0 || crossings.length > 0 || duplicates.length > 0;

    if (!validationSuccess && !hasIssues) {
        return null;
    }

    return (
        <div className="space-y-2">
            {validationSuccess ? (
                <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                    <div className="font-semibold">Geometry validates successfully</div>
                    <p className="mt-1 text-xs text-emerald-900/90">No blocking errors or warnings from the checks.</p>
                </div>
            ) : null}
            {errors.length > 0 ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                    <div className="font-semibold">Validation errors — cannot save until these are resolved</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {errors.map((message, index) => (
                            <li key={`e-${index}-${message}`}>{message}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {warnings.length > 0 ? (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    <div className="font-semibold">Warnings</div>
                    <p className="mt-1 text-xs text-amber-900/90">
                        Saving is allowed, but you will be asked to confirm while these warnings remain.
                    </p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {warnings.map((message, index) => (
                            <li key={`w-${index}-${message}`}>{message}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {crossings.length > 0 ? (
                <div className="rounded border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950">
                    <div className="font-semibold">Crossing streets</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {crossings.map((c) => (
                            <li key={c.streetId}>{formatStreetHit(c)}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
            {duplicates.length > 0 ? (
                <div className="rounded border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-950">
                    <div className="font-semibold">Overlaps / near-duplicates</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-5">
                        {duplicates.map((d) => (
                            <li key={`${d.streetId}-${d.kind}`}>
                                {d.kind === "overlap" ? "Overlap: " : "Near duplicate: "}
                                {formatStreetHit(d)}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
}

import type { ImportReviewBulkDecisionResponse } from "@/src/lib/api";

export default function ImportReviewBulkDecisionResultPanel({
    result,
}: {
    result: ImportReviewBulkDecisionResponse;
}) {
    const isDryRun = result.dry_run;

    return (
        <div
            className={`rounded-lg border p-3 text-sm ${
                isDryRun ? "border-blue-200 bg-blue-50 text-blue-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"
            }`}
            role="status"
        >
            <div className="font-semibold">{isDryRun ? "Dry-run result" : "Bulk approve completed"}</div>
            <dl className="mt-2 space-y-1">
                <div className="flex justify-between gap-4">
                    <dt>{isDryRun ? "Would approve" : "Approved"}</dt>
                    <dd className="tabular-nums font-medium">{result.updated_count.toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt>{isDryRun ? "Would skip" : "Skipped"}</dt>
                    <dd className="tabular-nums font-medium">{result.skipped_count.toLocaleString()}</dd>
                </div>
            </dl>
            <p className="mt-2 text-xs opacity-90">
                {isDryRun ? "No database rows were changed." : "Database rows were updated."}
            </p>
            {result.skipped_reasons.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-xs opacity-90">
                    {result.skipped_reasons.map((r) => (
                        <li key={r.reason}>
                            {r.reason}: {r.count.toLocaleString()}
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

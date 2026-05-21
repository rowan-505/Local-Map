"use client";

export default function CoreEntityWriteApiBanner() {
    return (
        <div
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
            role="status"
        >
            <p className="font-semibold">Write API not implemented yet</p>
            <p className="mt-1 text-amber-900/90">
                This form preview loads existing records for editing review, but create/update endpoints are not
                available. Saving is disabled.
            </p>
            {/* TODO: Enable save when POST/PATCH routes are added for this entity in apps/api. */}
        </div>
    );
}

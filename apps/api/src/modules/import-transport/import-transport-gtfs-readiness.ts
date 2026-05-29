import type { ImportTransportGtfsCoreTransportSnapshot } from "./import-transport-gtfs.types.js";

export type ReadinessCounts = {
    active_routes: bigint;
    active_variants: bigint;
    active_stops: bigint;
    variants_too_few_stops: bigint;
    duplicate_sequences: bigint;
    stops_without_names: bigint;
    variants_without_frequency: bigint;
    variants_without_path: bigint;
};

export function mapReadinessRow(
    row: ReadinessCounts,
    snapshotAt: Date
): ImportTransportGtfsCoreTransportSnapshot {
    return {
        snapshot_at: snapshotAt.toISOString(),
        active_routes: Number(row.active_routes),
        active_variants: Number(row.active_variants),
        active_stops: Number(row.active_stops),
        variants_too_few_stops: Number(row.variants_too_few_stops),
        duplicate_sequences: Number(row.duplicate_sequences),
        stops_without_names: Number(row.stops_without_names),
        variants_without_frequency: Number(row.variants_without_frequency),
        variants_without_path: Number(row.variants_without_path),
    };
}

export function readinessValidationCounts(snapshot: ImportTransportGtfsCoreTransportSnapshot): {
    error_count: number;
    warning_count: number;
    blocking: boolean;
    summary: string;
} {
    let error_count = 0;
    let warning_count = 0;
    const parts: string[] = [];

    if (snapshot.duplicate_sequences > 0) {
        error_count += snapshot.duplicate_sequences;
        parts.push(`${snapshot.duplicate_sequences} duplicate route_stop sequence(s)`);
    }
    if (snapshot.variants_without_path > 0) {
        error_count += snapshot.variants_without_path;
        parts.push(`${snapshot.variants_without_path} variant(s) missing path/shape geometry`);
    }
    if (snapshot.variants_too_few_stops > 0) {
        warning_count += snapshot.variants_too_few_stops;
        parts.push(`${snapshot.variants_too_few_stops} variant(s) with too few stops`);
    }
    if (snapshot.stops_without_names > 0) {
        warning_count += snapshot.stops_without_names;
        parts.push(`${snapshot.stops_without_names} stop(s) without names`);
    }
    if (snapshot.variants_without_frequency > 0) {
        warning_count += snapshot.variants_without_frequency;
        parts.push(`${snapshot.variants_without_frequency} variant(s) without frequency/service`);
    }
    if (snapshot.active_routes === 0 || snapshot.active_stops === 0) {
        error_count += 1;
        parts.push("core_transport has no active routes or stops for export");
    }

    const blocking = error_count > 0;
    const summary =
        parts.length > 0
            ? parts.join("; ")
            : "core_transport readiness checks passed for dry-run export tracking.";

    return { error_count, warning_count, blocking, summary };
}

export function parseNotesSnapshot(notes: string | null): ImportTransportGtfsCoreTransportSnapshot | null {
    if (!notes?.trim()) {
        return null;
    }
    try {
        const parsed = JSON.parse(notes) as {
            core_transport_snapshot?: ImportTransportGtfsCoreTransportSnapshot;
        };
        return parsed.core_transport_snapshot ?? null;
    } catch {
        return null;
    }
}

export function buildExportNotes(input: {
    dry_run: boolean;
    snapshot: ImportTransportGtfsCoreTransportSnapshot;
}): string {
    return JSON.stringify({
        dry_run: input.dry_run,
        core_transport_snapshot: input.snapshot,
        otp_consumption_note:
            "OpenTripPlanner consumes GTFS export files and graph artifacts — not Postgres.",
    });
}

export function buildDryRunBuildCode(scope: string, at: Date): string {
    const safeScope = scope.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const date = at.toISOString().slice(0, 10);
    const time = at.toISOString().slice(11, 19).replace(/:/g, "");
    return `${safeScope || "export"}_dryrun_${date}_${time}`;
}

export type ImportTransportGtfsListResponse<T> = {
    items: T[];
    total: number;
    limit: number;
    offset: number;
};

export type ImportTransportGtfsCoreTransportSnapshot = {
    snapshot_at: string;
    active_routes: number;
    active_variants: number;
    active_stops: number;
    variants_too_few_stops: number;
    duplicate_sequences: number;
    stops_without_names: number;
    variants_without_frequency: number;
    variants_without_path: number;
};

export type ImportTransportGtfsExportFile = {
    id: string;
    file_name: string;
    file_path: string;
    row_count: number | null;
    checksum: string | null;
    created_at: string;
};

export type ImportTransportGtfsValidationReport = {
    id: string;
    validator_name: string;
    validator_version: string | null;
    report_status: string;
    error_count: number;
    warning_count: number;
    info_count: number;
    report_summary: string | null;
    artifact_path: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
};

export type ImportTransportGtfsValidationIssue = {
    id: string;
    gtfs_file: string;
    row_ref: string | null;
    issue_code: string;
    severity: string;
    message: string;
    is_resolved: boolean;
    created_at: string;
};

export type ImportTransportGtfsOtpBuildListItem = {
    id: string;
    public_id: string;
    export_build_id: string | null;
    build_code: string;
    scope: string;
    otp_version: string | null;
    build_status: string;
    gtfs_input_path: string | null;
    graph_artifact_path: string | null;
    error_message: string | null;
    started_at: string | null;
    finished_at: string | null;
    created_at: string;
    updated_at: string;
};

export type ImportTransportGtfsExportListItem = {
    id: string;
    build_code: string;
    scope: string;
    status: string;
    output_path: string | null;
    route_count: number;
    variant_count: number;
    stop_count: number;
    service_count: number;
    warning_count: number;
    error_count: number;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    core_transport_snapshot: ImportTransportGtfsCoreTransportSnapshot | null;
    validation_status: string;
    latest_otp_build_status: string | null;
    file_count: number;
    dry_run: boolean;
};

export type ImportTransportGtfsExportDetail = ImportTransportGtfsExportListItem & {
    checksum: string | null;
    file_size_bytes: number | null;
    notes: string | null;
    files: ImportTransportGtfsExportFile[];
    planned_files: string[];
    validation_report: ImportTransportGtfsValidationReport | null;
    otp_builds: ImportTransportGtfsOtpBuildListItem[];
};

export type ImportTransportGtfsExportValidationResponse = {
    export_build_id: string;
    export_status: string;
    validation_report: ImportTransportGtfsValidationReport | null;
    issues: ImportTransportGtfsValidationIssue[];
    issue_total: number;
    core_transport_snapshot: ImportTransportGtfsCoreTransportSnapshot | null;
    otp_consumption_note: string;
};

export type ImportTransportGtfsCreateExportResult = {
    export: ImportTransportGtfsExportDetail;
    message: string;
    dry_run: boolean;
};

export const PLANNED_GTFS_EXPORT_FILES = [
    "agency.txt",
    "stops.txt",
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
    "frequencies.txt",
    "shapes.txt",
    "feed_info.txt",
] as const;

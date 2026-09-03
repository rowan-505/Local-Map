export type ReportStatusCode =
    | "submitted"
    | "in_review"
    | "needs_more_info"
    | "accepted"
    | "rejected"
    | "duplicate"
    | "resolved";

export type ReportSourceCode = "public" | "field_survey";

export type ReportTypeCode =
    | "wrong_info"
    | "wrong_location"
    | "missing_item"
    | "closed_or_removed"
    | "duplicate_item"
    | "transport_issue"
    | "community_info"
    | "other_map_issue";

export type ReportTargetEntityType =
    | "place"
    | "street"
    | "building"
    | "bus_stop"
    | "bus_route"
    | "map_point"
    | "stop"
    | "route"
    | "variant"
    | "path";

export type RewardReasonCode =
    | "valid_report"
    | "useful_correction"
    | "useful_photo"
    | "admin_adjustment"
    | "reversal"
    | "spam_penalty"
    | "false_report_penalty";

export type CodeName = { code: string; name: string };

export type AdminReport = {
    public_id: string;
    is_anonymous: boolean;
    eligible_for_points: boolean;
    report_type: CodeName;
    status: CodeName;
    reason_code: string | null;
    target_entity_type: string | null;
    target_entity_id: string | null;
    target_public_id: string | null;
    title: string | null;
    description: string;
    latitude: number | null;
    longitude: number | null;
    admin_area_id: string | null;
    priority: string;
    confidence_score: number;
    admin_note: string | null;
    reviewed_at: string | null;
    reward_granted_at: string | null;
    created_at: string;
    updated_at: string;
    anonymous_id: string | null;
    author: { public_id: string; display_name: string | null; email: string } | null;
    source_code: ReportSourceCode;
    observed_at: string | null;
    location_accuracy_m: number | null;
    field: FieldReportContext | null;
    canonical_target: { latitude: number; longitude: number } | null;
    distance_m: number | null;
    media_count: number;
};

export type ReportMediaEvidence = {
    publicId: string;
    mimeType: string;
    byteSize: number;
    width: number | null;
    height: number | null;
    note: string | null;
    sortOrder: number;
    published: boolean;
};

export type MediaAccess = {
    publicId: string;
    mimeType: string;
    byteSize: number;
    method: "GET";
    url: string;
    expiresAt: string;
};

export type FieldReportContext = {
    route_code: string | null;
    route_public_id: string | null;
    variant_code: string | null;
    variant_public_id: string | null;
    stop_public_id: string | null;
    stop_name: string | null;
    stop_sequence: number | null;
    snapshot_revision: string | null;
    canonical_snapshot: unknown | null;
};

export type ReportStatusEvent = {
    old_status_code: string | null;
    new_status_code: string;
    actor_display_name: string | null;
    note: string | null;
    created_at: string;
};

export type ReportFollowup = {
    actor_type: string;
    actor_display_name: string | null;
    message: string;
    created_at: string;
};

export type AdminReportDetail = AdminReport & {
    status_events: ReportStatusEvent[];
    followups: ReportFollowup[];
    media: ReportMediaEvidence[];
};

export type AdminReportList = {
    items: AdminReport[];
    total: number;
    page: number;
    pageSize: number;
};

export type PointSummary = {
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    updated_at: string;
};

export type RewardResult = {
    report: AdminReport;
    summary: PointSummary;
};

export type ReportAnalyticsSummary = {
    total: number;
    submitted: number;
    in_review: number;
    needs_more_info: number;
    accepted: number;
    rejected: number;
    duplicate: number;
    anonymous: number;
    logged_in: number;
    this_week: number;
    this_month: number;
};

export type ReportCodeCount = { code: string; name: string; count: number };
export type ReportRegionCount = {
    region_id: string | null;
    region_name: string | null;
    count: number;
};
export type ReportAnonymousCount = { anonymous: number; logged_in: number };

export type ReportsListFilters = {
    status?: ReportStatusCode;
    type?: ReportTypeCode;
    adminAreaId?: number;
    targetEntityType?: ReportTargetEntityType;
    source?: ReportSourceCode;
    routeCode?: string;
    variantCode?: "D0" | "D1";
    anonymous?: boolean;
    createdFrom?: string;
    createdTo?: string;
    page?: number;
    pageSize?: number;
};

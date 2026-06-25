export type AccountStatus = "active" | "disabled" | "deleted";
export type PointReasonCode =
    | "admin_adjustment"
    | "valid_contribution"
    | "reversal"
    | "spam_penalty";
export type AnalyticsBucket = "day" | "week" | "month";

export type AdminUserListItem = {
    public_id: string;
    email: string;
    display_name: string;
    phone: string | null;
    email_verified: boolean;
    account_status: AccountStatus;
    primary_region_id: string | null;
    roles: string[];
    total_points: number;
    last_seen_at: string | null;
    last_login_at: string | null;
    created_at: string;
};

export type AdminUserDetail = AdminUserListItem & {
    is_active: boolean;
    preferred_language: string;
    admin_note: string | null;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    saved_places_count: number;
    updated_at: string;
    deleted_at: string | null;
};

export type AdminUserList = {
    items: AdminUserListItem[];
    total: number;
    page: number;
    pageSize: number;
};

export type UserAuditEntry = {
    id: string;
    action_type: string;
    actor_display_name: string | null;
    before_snapshot: unknown;
    after_snapshot: unknown;
    created_at: string;
};

export type PointSummary = {
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
    updated_at: string | null;
};

export type PointLedgerItem = {
    id: string;
    points_delta: number;
    reason_code: string;
    note: string | null;
    related_entity_type: string | null;
    related_entity_id: string | null;
    created_at: string;
};

export type UserPointsResponse = {
    summary: PointSummary;
    history: PointLedgerItem[];
};

export type AdminLedgerItem = {
    id: string;
    points_delta: number;
    reason_code: string;
    note: string | null;
    created_at: string;
    user_public_id: string;
    user_display_name: string;
    user_email: string;
    created_by_display_name: string | null;
};

export type AdminLedgerList = {
    items: AdminLedgerItem[];
    total: number;
    page: number;
    pageSize: number;
};

export type TopPointUser = {
    public_id: string;
    display_name: string;
    email: string;
    total_points: number;
    lifetime_points_earned: number;
    lifetime_points_removed: number;
};

export type AnalyticsSummary = {
    total_users: number;
    verified_users: number;
    unverified_users: number;
    new_today: number;
    new_this_week: number;
    new_this_month: number;
    active_this_week: number;
    disabled_users: number;
    admin_count: number;
    super_admin_count: number;
    total_saved_places: number;
    total_points_awarded: number;
};

export type GrowthBucket = { bucket: string; count: number };
export type RoleCount = { role: string; count: number };
export type RegionCount = { region_id: string | null; region_name: string | null; count: number };
export type PointsAnalytics = {
    total_awarded: number;
    total_removed: number;
    net_points: number;
    ledger_entries: number;
    users_with_points: number;
};
export type SavedPlacesAnalytics = {
    total_saved_places: number;
    users_with_saved_places: number;
    distinct_places_saved: number;
};
export type PointsByReason = {
    reason_code: string;
    net_points: number;
    total_awarded: number;
    total_removed: number;
    entries: number;
};

export type AdminPointChangeBody = {
    pointsDelta: number;
    reasonCode: PointReasonCode;
    note?: string;
    relatedEntityType?: string;
    relatedEntityId?: number;
};

export type UsersListFilters = {
    search?: string;
    role?: string;
    emailVerified?: boolean;
    accountStatus?: AccountStatus;
    primaryRegionId?: number;
    createdFrom?: string;
    createdTo?: string;
    page?: number;
    pageSize?: number;
};

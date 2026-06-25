import type { AccountStatus, PointReasonCode } from "./types";

export const ROLE_OPTIONS = [
    { value: "user", label: "User" },
    { value: "editor", label: "Editor" },
    { value: "viewer", label: "Viewer" },
    { value: "admin", label: "Admin" },
    { value: "super_admin", label: "Super admin" },
] as const;

export const PRIVILEGED_ROLES = new Set(["admin", "super_admin"]);

export const ACCOUNT_STATUS_OPTIONS: { value: AccountStatus; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "disabled", label: "Disabled" },
    { value: "deleted", label: "Deleted" },
];

export const POINT_REASON_OPTIONS: { value: PointReasonCode; label: string }[] = [
    { value: "admin_adjustment", label: "Admin adjustment" },
    { value: "valid_contribution", label: "Valid contribution" },
    { value: "reversal", label: "Reversal" },
    { value: "spam_penalty", label: "Spam penalty" },
];

export function roleLabel(code: string): string {
    return ROLE_OPTIONS.find((r) => r.value === code)?.label ?? code;
}

export function reasonLabel(code: string): string {
    return POINT_REASON_OPTIONS.find((r) => r.value === code)?.label ?? code;
}

export function statusLabel(status: string): string {
    return ACCOUNT_STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
}

export function formatDateTime(value: string | null): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function formatDate(value: string | null): string {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

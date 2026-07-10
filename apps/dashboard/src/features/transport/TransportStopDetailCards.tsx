"use client";

import type { ReactNode } from "react";

import { transportModeLabel, transportReviewStatusLabel } from "./constants";
import { DELETE_BLOCKED_MESSAGE } from "./TransportStopUsageDialog";
import type { TransportStopDetail } from "./types";

export const STOP_CARD_CLASS = "rounded-lg border border-gray-200 bg-white p-3 shadow-sm";

function reviewStatusBadgeClass(status: string): string {
    switch (status) {
        case "verified":
            return "bg-emerald-50 text-emerald-800 ring-emerald-100";
        case "reviewed":
            return "bg-blue-50 text-blue-800 ring-blue-100";
        case "needs_review":
            return "bg-amber-50 text-amber-900 ring-amber-100";
        case "rejected":
            return "bg-red-50 text-red-800 ring-red-100";
        case "manual_protected":
            return "bg-purple-50 text-purple-800 ring-purple-100";
        default:
            return "bg-gray-100 text-gray-700 ring-gray-200";
    }
}

export function StopDetailHeader({
    stopDisplayName,
    detail,
    loading,
    editing,
    saving,
    locEditing,
    onEdit,
    onCancelEdit,
    onSaveEdit,
    onClose,
    onDelete,
    deleteLoading = false,
    deleteAllowed = false,
    deleteBlockMessage = null,
}: {
    readonly stopDisplayName: string;
    readonly detail: TransportStopDetail | null;
    readonly loading: boolean;
    readonly editing: boolean;
    readonly saving: boolean;
    readonly locEditing: boolean;
    readonly onEdit: () => void;
    readonly onCancelEdit: () => void;
    readonly onSaveEdit: () => void;
    readonly onClose?: () => void;
    readonly onDelete?: () => void;
    readonly deleteLoading?: boolean;
    readonly deleteAllowed?: boolean;
    readonly deleteBlockMessage?: string | null;
}) {
    const deleteTitle = deleteLoading
        ? "Checking delete eligibility…"
        : deleteBlockMessage
          ? deleteBlockMessage
          : deleteAllowed
            ? "Review route usage before permanent deletion"
            : DELETE_BLOCKED_MESSAGE;
    return (
        <header className="flex flex-col gap-2 border-b border-gray-200 pb-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
                {loading ? (
                    <div className="h-7 w-64 animate-pulse rounded bg-gray-200" />
                ) : detail ? (
                    <>
                        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">{stopDisplayName}</h1>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                            <span>
                                {transportModeLabel(detail.mode)} · {detail.stop_type}
                            </span>
                            <span>·</span>
                            <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${reviewStatusBadgeClass(detail.review_status)}`}
                            >
                                {transportReviewStatusLabel(detail.review_status)}
                            </span>
                            {detail.is_active ? (
                                <span className="text-emerald-700">Active</span>
                            ) : (
                                <span className="text-gray-400">Inactive</span>
                            )}
                        </div>
                    </>
                ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                {detail && !editing ? (
                    <button
                        type="button"
                        onClick={onEdit}
                        disabled={locEditing}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        Edit
                    </button>
                ) : null}
                {detail && !editing && onDelete ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={locEditing || deleteLoading}
                        title={deleteTitle}
                        className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {deleteLoading ? "Checking…" : "Delete"}
                    </button>
                ) : null}
                {editing ? (
                    <>
                        <button
                            type="button"
                            onClick={onCancelEdit}
                            disabled={saving}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={onSaveEdit}
                            disabled={saving}
                            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                        >
                            {saving ? "Saving…" : "Save changes"}
                        </button>
                    </>
                ) : null}
                {onClose ? (
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        Close
                    </button>
                ) : null}
            </div>
        </header>
    );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { usersPath } from "@/src/lib/dashboardPaths";

import {
    adjustUserPoints,
    assignUserRole,
    getUser,
    getUserAudit,
    getUserPoints,
    removeUserRole,
    setUserAdminNote,
    setUserStatus,
} from "./api";
import {
    ACCOUNT_STATUS_OPTIONS,
    POINT_REASON_OPTIONS,
    PRIVILEGED_ROLES,
    ROLE_OPTIONS,
    formatDateTime,
    reasonLabel,
    roleLabel,
} from "./constants";
import {
    INPUT_CLASS,
    PRIMARY_BTN,
    PointsDelta,
    RolePills,
    SECONDARY_BTN,
    SELECT_CLASS,
    StatusBadge,
    VerifiedBadge,
} from "./ui";
import type {
    AccountStatus,
    AdminUserDetail,
    PointReasonCode,
    UserAuditEntry,
    UserPointsResponse,
} from "./types";

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                {action}
            </div>
            {children}
        </section>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="mt-1 text-sm text-gray-900">{children}</dd>
        </div>
    );
}

export default function UserDetailPage({ id }: { id: string }) {
    const [user, setUser] = useState<AdminUserDetail | null>(null);
    const [points, setPoints] = useState<UserPointsResponse | null>(null);
    const [audit, setAudit] = useState<UserAuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState("");
    const [actionMessage, setActionMessage] = useState("");

    const [noteDraft, setNoteDraft] = useState("");
    const [statusDraft, setStatusDraft] = useState<AccountStatus>("active");
    const [newRole, setNewRole] = useState("");
    const [pointsDelta, setPointsDelta] = useState("");
    const [pointsReason, setPointsReason] = useState<PointReasonCode>("admin_adjustment");
    const [pointsNote, setPointsNote] = useState("");

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const [u, p, a] = await Promise.all([
                    getUser(id, signal ? { signal } : undefined),
                    getUserPoints(id, 50, signal ? { signal } : undefined),
                    getUserAudit(id, 50, signal ? { signal } : undefined),
                ]);
                setUser(u);
                setPoints(p);
                setAudit(a);
                setNoteDraft(u.admin_note ?? "");
                setStatusDraft(u.account_status);
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load user.");
            } finally {
                setLoading(false);
            }
        },
        [id]
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const runAction = useCallback(
        async (fn: () => Promise<unknown>, successMessage: string) => {
            setBusy(true);
            setActionError("");
            setActionMessage("");
            try {
                await fn();
                await load();
                setActionMessage(successMessage);
            } catch (err) {
                setActionError(err instanceof Error ? err.message : "Action failed.");
            } finally {
                setBusy(false);
            }
        },
        [load]
    );

    if (loading) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-5xl rounded-lg border border-gray-200 bg-white p-6 text-gray-700 shadow-sm">
                    Loading user…
                </div>
            </main>
        );
    }

    if (error || !user) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-5xl space-y-4">
                    <Link href={usersPath()} className="text-sm text-gray-600 hover:text-gray-900">
                        ← Back to users
                    </Link>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
                        {error || "User not found."}
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-5xl space-y-5">
                <div>
                    <Link href={usersPath()} className="text-sm text-gray-600 hover:text-gray-900">
                        ← Back to users
                    </Link>
                </div>

                <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{user.display_name}</h1>
                        <p className="mt-1 text-sm text-gray-600">{user.email}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <VerifiedBadge verified={user.email_verified} />
                        <StatusBadge status={user.account_status} />
                    </div>
                </header>

                {actionError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        {actionError}
                    </div>
                ) : null}
                {actionMessage ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {actionMessage}
                    </div>
                ) : null}

                <Section title="Profile">
                    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        <Field label="Phone">{user.phone ?? "—"}</Field>
                        <Field label="Region ID">{user.primary_region_id ?? "—"}</Field>
                        <Field label="Language">{user.preferred_language}</Field>
                        <Field label="Roles">
                            <RolePills roles={user.roles} />
                        </Field>
                        <Field label="Saved places">{user.saved_places_count}</Field>
                        <Field label="Point total">
                            <span className="font-semibold tabular-nums">{user.total_points}</span>
                        </Field>
                        <Field label="Joined">{formatDateTime(user.created_at)}</Field>
                        <Field label="Last login">{formatDateTime(user.last_login_at)}</Field>
                        <Field label="Last seen">{formatDateTime(user.last_seen_at)}</Field>
                    </dl>
                </Section>

                <div className="grid gap-5 lg:grid-cols-2">
                    <Section title="Account status">
                        <div className="flex flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                    Status
                                </span>
                                <select
                                    className={SELECT_CLASS}
                                    value={statusDraft}
                                    onChange={(e) => setStatusDraft(e.target.value as AccountStatus)}
                                >
                                    {ACCOUNT_STATUS_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <button
                                type="button"
                                disabled={busy || statusDraft === user.account_status}
                                onClick={() =>
                                    runAction(
                                        () => setUserStatus(id, statusDraft),
                                        `Status set to ${statusDraft}.`
                                    )
                                }
                                className={PRIMARY_BTN}
                            >
                                Apply
                            </button>
                        </div>
                        <p className="mt-3 text-xs text-gray-500">
                            Disabling blocks login. Deleting soft-deletes the account (super_admin
                            only). Admins cannot change admin/super_admin accounts.
                        </p>
                    </Section>

                    <Section title="Roles">
                        <div className="space-y-3">
                            <div className="flex flex-wrap gap-2">
                                {user.roles.length === 0 ? (
                                    <span className="text-sm text-gray-400">No roles</span>
                                ) : (
                                    user.roles.map((role) => (
                                        <span
                                            key={role}
                                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                                                PRIVILEGED_ROLES.has(role)
                                                    ? "bg-indigo-50 text-indigo-800 ring-indigo-100"
                                                    : "bg-gray-100 text-gray-700 ring-gray-200"
                                            }`}
                                        >
                                            {roleLabel(role)}
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() =>
                                                    runAction(
                                                        () => removeUserRole(id, role),
                                                        `Removed role ${role}.`
                                                    )
                                                }
                                                className="ml-0.5 rounded-full px-1 text-gray-500 hover:text-red-700"
                                                aria-label={`Remove ${role}`}
                                            >
                                                ×
                                            </button>
                                        </span>
                                    ))
                                )}
                            </div>
                            <div className="flex flex-wrap items-end gap-2">
                                <select
                                    className={SELECT_CLASS}
                                    value={newRole}
                                    onChange={(e) => setNewRole(e.target.value)}
                                >
                                    <option value="">Add role…</option>
                                    {ROLE_OPTIONS.filter((o) => !user.roles.includes(o.value)).map(
                                        (o) => (
                                            <option key={o.value} value={o.value}>
                                                {o.label}
                                            </option>
                                        )
                                    )}
                                </select>
                                <button
                                    type="button"
                                    disabled={busy || !newRole}
                                    onClick={() =>
                                        runAction(() => assignUserRole(id, newRole), `Assigned role ${newRole}.`).then(
                                            () => setNewRole("")
                                        )
                                    }
                                    className={PRIMARY_BTN}
                                >
                                    Add
                                </button>
                            </div>
                            <p className="text-xs text-gray-500">
                                Assigning/removing admin or super_admin requires super_admin.
                            </p>
                        </div>
                    </Section>
                </div>

                <Section title="Admin note">
                    <textarea
                        value={noteDraft}
                        onChange={(e) => setNoteDraft(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        placeholder="Internal note (not visible to the user)…"
                        className={`w-full ${INPUT_CLASS}`}
                    />
                    <div className="mt-3 flex gap-2">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                                runAction(
                                    () => setUserAdminNote(id, noteDraft.trim() ? noteDraft : null),
                                    "Admin note saved."
                                )
                            }
                            className={PRIMARY_BTN}
                        >
                            Save note
                        </button>
                        {user.admin_note ? (
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                    runAction(() => setUserAdminNote(id, null), "Admin note cleared.").then(
                                        () => setNoteDraft("")
                                    )
                                }
                                className={SECONDARY_BTN}
                            >
                                Clear
                            </button>
                        ) : null}
                    </div>
                </Section>

                <Section title="Points">
                    <div className="mb-4 grid grid-cols-3 gap-4">
                        <Field label="Total">
                            <span className="text-lg font-semibold tabular-nums">
                                {points?.summary.total_points ?? 0}
                            </span>
                        </Field>
                        <Field label="Lifetime earned">
                            {points?.summary.lifetime_points_earned ?? 0}
                        </Field>
                        <Field label="Lifetime removed">
                            {points?.summary.lifetime_points_removed ?? 0}
                        </Field>
                    </div>

                    <form
                        className="mb-5 flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-gray-50 p-3"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const delta = Number(pointsDelta);
                            if (!Number.isInteger(delta) || delta === 0) {
                                setActionError("Enter a non-zero whole number for points.");
                                return;
                            }
                            void runAction(
                                () =>
                                    adjustUserPoints(id, {
                                        pointsDelta: delta,
                                        reasonCode: pointsReason,
                                        note: pointsNote.trim() || undefined,
                                    }),
                                `Applied ${delta > 0 ? "+" : ""}${delta} points.`
                            ).then(() => {
                                setPointsDelta("");
                                setPointsNote("");
                            });
                        }}
                    >
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Points (+/-)
                            </span>
                            <input
                                type="number"
                                value={pointsDelta}
                                onChange={(e) => setPointsDelta(e.target.value)}
                                placeholder="e.g. 10 or -5"
                                className={`w-32 ${SELECT_CLASS}`}
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Reason
                            </span>
                            <select
                                className={SELECT_CLASS}
                                value={pointsReason}
                                onChange={(e) => setPointsReason(e.target.value as PointReasonCode)}
                            >
                                {POINT_REASON_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-1 flex-col gap-1">
                            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                Note (optional)
                            </span>
                            <input
                                type="text"
                                value={pointsNote}
                                onChange={(e) => setPointsNote(e.target.value)}
                                maxLength={1000}
                                className={INPUT_CLASS}
                            />
                        </label>
                        <button type="submit" disabled={busy} className={PRIMARY_BTN}>
                            Apply points
                        </button>
                    </form>

                    <h3 className="mb-2 text-sm font-semibold text-gray-700">Point history</h3>
                    <div className="overflow-x-auto rounded-md border border-gray-200">
                        <table className="min-w-full text-left text-sm">
                            <thead className="border-b text-xs uppercase text-gray-500">
                                <tr>
                                    <th className="px-3 py-2 text-right">Delta</th>
                                    <th className="px-3 py-2">Reason</th>
                                    <th className="px-3 py-2">Note</th>
                                    <th className="px-3 py-2">When</th>
                                </tr>
                            </thead>
                            <tbody>
                                {points && points.history.length > 0 ? (
                                    points.history.map((row) => (
                                        <tr key={row.id} className="border-b border-gray-100">
                                            <td className="px-3 py-2 text-right">
                                                <PointsDelta value={row.points_delta} />
                                            </td>
                                            <td className="px-3 py-2 text-gray-700">
                                                {reasonLabel(row.reason_code)}
                                            </td>
                                            <td className="px-3 py-2 text-gray-600">
                                                {row.note ?? "—"}
                                            </td>
                                            <td className="px-3 py-2 text-gray-600">
                                                {formatDateTime(row.created_at)}
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                                            No point history yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </Section>

                <Section title="Audit history">
                    {audit.length === 0 ? (
                        <p className="text-sm text-gray-500">No audit entries for this user.</p>
                    ) : (
                        <ul className="space-y-2">
                            {audit.map((entry) => (
                                <li
                                    key={entry.id}
                                    className="rounded-md border border-gray-200 px-3 py-2 text-sm"
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-medium text-gray-900">
                                            {entry.action_type}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            {formatDateTime(entry.created_at)}
                                        </span>
                                    </div>
                                    <div className="mt-1 text-xs text-gray-600">
                                        by {entry.actor_display_name ?? "system"}
                                    </div>
                                    {entry.after_snapshot ? (
                                        <pre className="mt-1 overflow-x-auto rounded bg-gray-50 px-2 py-1 text-xs text-gray-600">
                                            {JSON.stringify(entry.after_snapshot)}
                                        </pre>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>
            </div>
        </main>
    );
}

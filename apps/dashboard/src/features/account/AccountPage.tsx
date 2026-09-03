"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { getAuthMe, isAbortError, logout, type AuthMeProfile } from "@/src/lib/api";
import { RolePills, VerifiedBadge } from "@/src/features/user-management/ui";
import { statusLabel } from "@/src/features/user-management/constants";

const LANGUAGE_LABELS: Record<string, string> = {
    my: "Myanmar",
    en: "English",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</dt>
            <dd className="mt-1 text-sm text-gray-900">{children}</dd>
        </div>
    );
}

export default function AccountPage() {
    const [profile, setProfile] = useState<AuthMeProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [loggingOut, setLoggingOut] = useState(false);

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError("");
        try {
            setProfile(await getAuthMe(signal ? { signal } : undefined));
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load account.");
            setProfile(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    async function handleLogout() {
        setLoggingOut(true);
        try {
            await logout();
        } catch {
            setLoggingOut(false);
        }
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-xl space-y-4">
                <div>
                    <h1 className="text-lg font-semibold text-gray-900">Account</h1>
                    <p className="mt-1 text-sm text-gray-600">Your signed-in dashboard profile.</p>
                </div>

                {loading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-600 shadow-sm">
                        Loading account…
                    </div>
                ) : null}

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                {profile ? (
                    <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Display name">{profile.display_name}</Field>
                            <Field label="Email">{profile.email}</Field>
                            <Field label="Email verified">
                                <VerifiedBadge verified={profile.email_verified} />
                            </Field>
                            <Field label="Status">{statusLabel(profile.account_status)}</Field>
                            <Field label="Roles">
                                <RolePills roles={profile.roles} />
                            </Field>
                            <Field label="Language">
                                {LANGUAGE_LABELS[profile.preferred_language] ?? profile.preferred_language}
                            </Field>
                            <Field label="Points">{profile.total_points}</Field>
                            {profile.phone ? <Field label="Phone">{profile.phone}</Field> : null}
                        </dl>
                    </section>
                ) : null}

                <div>
                    <button
                        type="button"
                        disabled={loggingOut}
                        onClick={() => void handleLogout()}
                        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                    >
                        {loggingOut ? "Signing out…" : "Log out"}
                    </button>
                </div>
            </div>
        </main>
    );
}

"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
    consumeImportReviewApiAuthFailed,
    isImportReviewDevRouteBypassActive,
    logImportReviewAuthDecision,
    readImportReviewAuthDebugState,
} from "@/src/lib/importReviewDevAccess";

type LoginResponse = {
    accessToken: string;
    user?: {
        id: string;
        public_id: string;
        email: string;
        display_name: string;
        roles: string[];
    };
};

type LoginApiPayload = {
    message?: unknown;
    error?: unknown;
    data?: {
        message?: unknown;
        error?: unknown;
    };
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "");

function parseJsonSafely(value: string): unknown {
    if (!value.trim()) {
        return null;
    }

    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}

function getString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getApiErrorMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const data = payload as LoginApiPayload;

    return (
        getString(data.message) ??
        getString(data.error) ??
        getString(data.data?.message) ??
        getString(data.data?.error)
    );
}

function getLoginErrorMessage(status: number, payload: unknown): string {
    const apiMessage = getApiErrorMessage(payload);

    if (apiMessage) {
        return apiMessage;
    }

    switch (status) {
        case 401:
            return "Invalid email or password";
        case 403:
            return "Account is inactive";
        case 404:
            return "User not found";
        default:
            return "Login failed";
    }
}

export default function LoginPageClient() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [authChecked, setAuthChecked] = useState(false);

    useEffect(() => {
        const pathname = window.location.pathname;
        const state = readImportReviewAuthDebugState(pathname, true);

        if (consumeImportReviewApiAuthFailed()) {
            logImportReviewAuthDecision(
                "LoginPageClient",
                "stay-on-login-after-import-review-api-401",
                { ...state, authLoading: false, importReviewApiAuthFailedFlag: true }
            );
            setAuthChecked(true);
            return;
        }

        const accessToken = window.localStorage.getItem("accessToken")?.trim();

        if (!accessToken) {
            logImportReviewAuthDecision("LoginPageClient", "show-login-form", {
                ...state,
                authLoading: false,
            });
            setAuthChecked(true);
            return;
        }

        logImportReviewAuthDecision("LoginPageClient", "redirect-dashboard", {
            ...readImportReviewAuthDebugState(pathname, false),
            hasAccessToken: true,
        });
        router.replace("/dashboard");
    }, [router]);

    if (!authChecked) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
                <p className="text-sm text-gray-600">Checking authentication…</p>
            </main>
        );
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        setError(null);
        setLoading(true);

        try {
            if (!API_BASE_URL) {
                throw new Error("Cannot connect to server");
            }

            const requestBody = {
                email: email.trim(),
                password,
            };

            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });

            const responseText = await response.text();
            const responseData = parseJsonSafely(responseText);

            if (!response.ok) {
                throw new Error(getLoginErrorMessage(response.status, responseData));
            }

            const data = responseData as LoginResponse | null;

            if (!data?.accessToken) {
                throw new Error("Login failed");
            }

            window.localStorage.removeItem("token");
            window.localStorage.removeItem("authToken");
            window.localStorage.removeItem("jwt");
            window.localStorage.setItem("accessToken", data.accessToken);
            router.replace("/dashboard");
        } catch (err) {
            if (err instanceof TypeError) {
                setError("Cannot connect to server");
                return;
            }

            setError(err instanceof Error ? err.message : "Login failed");
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
            <form
                onSubmit={handleSubmit}
                noValidate
                className="w-full max-w-sm rounded-lg bg-white p-6 shadow"
            >
                <h1 className="mb-4 text-2xl font-semibold text-gray-900">Dashboard Login</h1>

                <label className="mb-4 block">
                    <span className="mb-1 block text-sm text-gray-700">Email</span>
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                        required
                    />
                </label>

                <label className="mb-4 block">
                    <span className="mb-1 block text-sm text-gray-700">Password</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                        required
                    />
                </label>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded bg-gray-900 px-4 py-2 text-white disabled:opacity-60"
                >
                    {loading ? "Signing in..." : "Sign in"}
                </button>

                {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}

                {isImportReviewDevRouteBypassActive("/import-review") ? (
                    <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Development: you can open{" "}
                        <Link href="/import-review" className="font-medium underline">
                            Import review
                        </Link>{" "}
                        without signing in when{" "}
                        <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN</code> is
                        set.
                    </p>
                ) : null}

                <p className="mt-4 text-center text-sm text-gray-600">
                    <Link href="/signup" className="text-gray-900 underline">
                        Create demo admin account
                    </Link>
                </p>
            </form>
        </main>
    );
}

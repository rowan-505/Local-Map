"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        console.log("submit triggered");

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

            console.log("request body", requestBody);

            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });

            console.log("response status", response.status);

            const responseText = await response.text();
            const responseData = parseJsonSafely(responseText);

            console.log("response data/error", responseData ?? responseText ?? null);

            if (!response.ok) {
                throw new Error(getLoginErrorMessage(response.status, responseData));
            }

            const data = responseData as LoginResponse | null;

            if (!data?.accessToken) {
                throw new Error("Login failed");
            }

            window.localStorage.setItem("accessToken", data.accessToken);
            router.replace("/dashboard");
        } catch (err) {
            if (err instanceof TypeError) {
                console.log("response data/error", err);
                setError("Cannot connect to server");
                return;
            }

            console.log("response data/error", err);

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

                <p className="mt-4 text-center text-sm text-gray-600">
                    <Link href="/signup" className="text-gray-900 underline">
                        Create demo admin account
                    </Link>
                </p>
            </form>
        </main>
    );
}

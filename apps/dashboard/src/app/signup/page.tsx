"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type SignupResponse = {
    message?: string;
    user?: {
        id: string;
        public_id: string;
        email: string;
        display_name: string;
        roles: string[];
    };
};

type SignupApiPayload = {
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

function getApiMessage(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const data = payload as SignupApiPayload;

    return (
        getString(data.message) ??
        getString(data.error) ??
        getString(data.data?.message) ??
        getString(data.data?.error)
    );
}

export default function SignupPage() {
    const router = useRouter();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError(null);
        setSuccess(null);
        setLoading(true);

        try {
            if (!API_BASE_URL) {
                throw new Error("Cannot connect to server");
            }

            const response = await fetch(`${API_BASE_URL}/auth/signup`, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    username: username.trim(),
                    password,
                }),
            });

            const responseText = await response.text();
            const responseData = parseJsonSafely(responseText);

            if (!response.ok) {
                throw new Error(getApiMessage(responseData) ?? "Signup failed");
            }

            const data = responseData as SignupResponse | null;
            const successMessage = data?.message ?? "Demo admin account created";

            setSuccess(successMessage);
            setUsername("");
            setPassword("");

            window.setTimeout(() => {
                router.replace("/dashboard");
            }, 1200);
        } catch (err) {
            if (err instanceof TypeError) {
                setError("Cannot connect to server");
                return;
            }

            setError(err instanceof Error ? err.message : "Signup failed");
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
                <h1 className="mb-4 text-2xl font-semibold text-gray-900">Create Demo Admin</h1>

                <label className="mb-4 block">
                    <span className="mb-1 block text-sm text-gray-700">Username</span>
                    <input
                        type="text"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
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
                    {loading ? "Creating account..." : "Create account"}
                </button>

                {success ? <p className="mt-2 text-sm text-green-600">{success}</p> : null}
                {error ? <p className="mt-2 text-sm text-red-500">{error}</p> : null}

                <p className="mt-4 text-center text-sm text-gray-600">
                    <Link href="/dashboard" className="text-gray-900 underline">
                        Open dashboard
                    </Link>
                </p>
            </form>
        </main>
    );
}

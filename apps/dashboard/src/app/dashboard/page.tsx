"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const modules = [
    {
        href: "/places",
        title: "Places",
        description: "View and manage mapped places and POI records.",
    },
    {
        href: "/streets",
        title: "Streets",
        description: "Browse street records and review street geometry.",
    },
    {
        href: "/categories",
        title: "Categories",
        description: "Open the category module for reference data management.",
    },
    {
        href: "/admin-areas",
        title: "Admin Areas",
        description: "Open the admin area module for boundary-related data.",
    },
] as const;

export default function DashboardPage() {
    const router = useRouter();
    const [hasAccessToken] = useState(() => {
        if (typeof window === "undefined") {
            return false;
        }

        return Boolean(window.localStorage.getItem("accessToken"));
    });

    useEffect(() => {
        if (!hasAccessToken) {
            router.replace("/login");
        }
    }, [hasAccessToken, router]);

    if (!hasAccessToken) {
        return (
            <main className="min-h-screen bg-gray-100 p-6">
                <div className="mx-auto max-w-6xl rounded-lg bg-white p-6 text-gray-700 shadow">
                    Loading dashboard...
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-gray-100 p-6">
            <div className="mx-auto max-w-6xl">
                <h1 className="mb-2 text-3xl font-bold text-gray-900">Dashboard</h1>
                <p className="mb-6 text-sm text-gray-600">
                    Choose a data module to view or manage.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                    {modules.map((module) => (
                        <Link
                            key={module.href}
                            href={module.href}
                            className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
                        >
                            <h2 className="mb-2 text-xl font-semibold text-gray-900">
                                {module.title}
                            </h2>
                            <p className="mb-4 text-sm text-gray-600">{module.description}</p>
                            <span className="text-sm font-medium text-blue-600">
                                View / Manage
                            </span>
                        </Link>
                    ))}
                </div>
            </div>
        </main>
    );
}

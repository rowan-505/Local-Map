"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
    isImportReviewDevRouteBypassActive,
    logImportReviewAuthDecision,
    readImportReviewAuthDebugState,
} from "@/src/lib/importReviewDevAccess";

type GateStatus = "loading" | "allowed" | "redirecting";

function resolveGateStatus(pathname: string): GateStatus {
    if (typeof window === "undefined") {
        return "loading";
    }
    if (isImportReviewDevRouteBypassActive(pathname)) {
        return "allowed";
    }
    if (window.localStorage.getItem("accessToken")?.trim()) {
        return "allowed";
    }
    return "redirecting";
}

/**
 * Client gate for `/import-review/*` only (mounted from import-review layout).
 * In development with NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN, allows the shell without JWT.
 */
export default function ImportReviewRouteAuthGate({ children }: { children: ReactNode }) {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [status, setStatus] = useState<GateStatus>("loading");

    useEffect(() => {
        const next = resolveGateStatus(pathname);
        const resolved = readImportReviewAuthDebugState(pathname, false);

        if (next === "allowed") {
            logImportReviewAuthDecision(
                "ImportReviewRouteAuthGate",
                isImportReviewDevRouteBypassActive(pathname) ? "allow-dev-bypass" : "allow-jwt",
                {
                    ...resolved,
                    authLoading: false,
                    importReviewDevBypassActive: isImportReviewDevRouteBypassActive(pathname),
                }
            );
            queueMicrotask(() => setStatus("allowed"));
            return;
        }

        logImportReviewAuthDecision("ImportReviewRouteAuthGate", "redirect-login", resolved);
        queueMicrotask(() => setStatus("redirecting"));
        router.replace("/login");
    }, [pathname, router]);

    if (status === "loading" || status === "redirecting") {
        return (
            <main className="p-6">
                <p className="text-sm text-gray-600">
                    {status === "redirecting" ? "Redirecting to login…" : "Loading import review…"}
                </p>
            </main>
        );
    }

    return <>{children}</>;
}

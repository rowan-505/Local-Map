"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import {
    isImportReviewDevRouteBypassActive,
    logImportReviewAuthDecision,
    readImportReviewAuthDebugState,
} from "@/src/lib/importReviewDevAccess";

type GateStatus = "loading" | "allowed" | "redirecting";

/**
 * Client gate for `/import-review/*` only (mounted from import-review layout).
 * In development with NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN, allows the shell without JWT.
 */
export default function ImportReviewRouteAuthGate({ children }: { children: ReactNode }) {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [status, setStatus] = useState<GateStatus>("loading");

    useEffect(() => {
        const authLoading = true;
        const state = readImportReviewAuthDebugState(pathname, authLoading);
        const devBypass = isImportReviewDevRouteBypassActive(pathname);

        if (devBypass) {
            logImportReviewAuthDecision("ImportReviewRouteAuthGate", "allow-dev-bypass", {
                ...state,
                authLoading: false,
                importReviewDevBypassActive: true,
            });
            setStatus("allowed");
            return;
        }

        const hasToken = Boolean(
            typeof window !== "undefined" && window.localStorage.getItem("accessToken")?.trim()
        );

        const resolved = readImportReviewAuthDebugState(pathname, false);

        if (hasToken) {
            logImportReviewAuthDecision("ImportReviewRouteAuthGate", "allow-jwt", resolved);
            setStatus("allowed");
            return;
        }

        logImportReviewAuthDecision("ImportReviewRouteAuthGate", "redirect-login", resolved);
        setStatus("redirecting");
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

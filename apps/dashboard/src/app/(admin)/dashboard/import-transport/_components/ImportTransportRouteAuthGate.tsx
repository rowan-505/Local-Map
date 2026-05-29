"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
    isImportTransportDevRouteBypassActive,
    logImportTransportAuthDecision,
    readImportTransportAuthDebugState,
} from "@/src/lib/importTransportDevAccess";

type GateStatus = "loading" | "allowed" | "redirecting";

function resolveGateStatus(pathname: string): GateStatus {
    if (typeof window === "undefined") {
        return "loading";
    }
    if (pathname === "/login") {
        return "allowed";
    }
    if (isImportTransportDevRouteBypassActive(pathname)) {
        return "allowed";
    }
    if (window.localStorage.getItem("accessToken")?.trim()) {
        return "allowed";
    }
    return "redirecting";
}

/**
 * Client gate for `/dashboard/import-transport/*` only (mounted from import-transport layout).
 * In development with NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN, allows the shell without JWT.
 */
export default function ImportTransportRouteAuthGate({ children }: { children: ReactNode }) {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [status, setStatus] = useState<GateStatus>("loading");
    const redirectStartedRef = useRef(false);

    useEffect(() => {
        if (pathname === "/login") {
            queueMicrotask(() => setStatus("allowed"));
            return;
        }

        const next = resolveGateStatus(pathname);
        const resolved = readImportTransportAuthDebugState(pathname, false);

        if (next === "allowed") {
            logImportTransportAuthDecision(
                "ImportTransportRouteAuthGate",
                isImportTransportDevRouteBypassActive(pathname) ? "allow-dev-bypass" : "allow-jwt",
                {
                    ...resolved,
                    authLoading: false,
                    importTransportDevBypassActive: isImportTransportDevRouteBypassActive(pathname),
                }
            );
            queueMicrotask(() => setStatus("allowed"));
            return;
        }

        if (redirectStartedRef.current) {
            return;
        }
        redirectStartedRef.current = true;

        logImportTransportAuthDecision("ImportTransportRouteAuthGate", "redirect-login", resolved);
        queueMicrotask(() => setStatus("redirecting"));
        const loginUrl = `/login?next=${encodeURIComponent(pathname)}`;
        router.replace(loginUrl);
    }, [pathname, router]);

    if (status === "loading" || status === "redirecting") {
        return (
            <main className="p-6">
                <p className="text-sm text-gray-600">
                    {status === "redirecting" ? "Redirecting to login…" : "Loading import transport…"}
                </p>
            </main>
        );
    }

    return <>{children}</>;
}

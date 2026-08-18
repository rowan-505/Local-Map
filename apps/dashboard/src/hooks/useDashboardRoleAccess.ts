"use client";

import { useEffect, useState } from "react";

import {
    canDashboardWrite,
    hasDashboardAccess,
    isViewer,
    rolesFromJwtAccessToken,
} from "@/src/lib/jwtRoles";

export function useDashboardRoleAccess() {
    const [roles, setRoles] = useState<string[]>([]);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const refreshRoles = () => {
            setRoles(rolesFromJwtAccessToken(window.localStorage.getItem("accessToken")));
            setReady(true);
        };
        refreshRoles();
        window.addEventListener("storage", refreshRoles);
        return () => window.removeEventListener("storage", refreshRoles);
    }, []);

    return {
        roles,
        ready,
        hasAccess: hasDashboardAccess(roles),
        canWrite: canDashboardWrite(roles),
        isViewer: isViewer(roles),
    };
}

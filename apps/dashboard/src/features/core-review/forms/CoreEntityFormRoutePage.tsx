"use client";

import type { CoreEntityFormMode, CoreEntityKey } from "@/src/lib/core-review/entityConfigs";

import CoreEntityFormPage from "./CoreEntityFormPage";

export type CoreEntityFormRoutePageProps = {
    entityKey: CoreEntityKey;
    mode: CoreEntityFormMode;
    id?: string;
};

export default function CoreEntityFormRoutePage({ entityKey, mode, id }: CoreEntityFormRoutePageProps) {
    return <CoreEntityFormPage entityKey={entityKey} mode={mode} id={id} />;
}

export function resolveCoreEntityRouteId(raw: string | string[] | undefined): string {
    if (typeof raw === "string") {
        return raw;
    }
    if (Array.isArray(raw)) {
        return raw[0] ?? "";
    }
    return "";
}

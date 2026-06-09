import type { StreetRow, UpdateStreetInput } from "./streets.repo.js";

function deriveStreetCanonicalName(names: { myanmarName?: string; englishName?: string }) {
    const en = names.englishName?.trim();
    const mm = names.myanmarName?.trim();
    return (en ?? "") || (mm ?? "") || "Unnamed Street";
}

export function normalizeStreetNameForCompare(value: string | null | undefined): string {
    return (value ?? "").trim();
}

/** True when PATCH includes a non-empty official name that differs from stored value. */
export function streetOfficialNameShouldSync(
    existing: string | null | undefined,
    incoming: string | undefined,
): boolean {
    if (incoming === undefined) {
        return false;
    }
    const trimmed = incoming.trim();
    if (trimmed === "") {
        return false;
    }
    return normalizeStreetNameForCompare(existing) !== trimmed;
}

export function streetRoadClassIdChanged(
    existingRoadClassId: string | null | undefined,
    incomingRoadClassId: bigint | null | undefined,
): boolean {
    if (incomingRoadClassId === undefined) {
        return false;
    }
    const next = incomingRoadClassId === null ? null : String(incomingRoadClassId);
    const current = existingRoadClassId ?? null;
    return next !== current;
}

export function streetAdminAreaIdChanged(
    existingAdminAreaId: string | null | undefined,
    incomingAdminAreaId: bigint | null | undefined,
): boolean {
    if (incomingAdminAreaId === undefined) {
        return false;
    }
    const next = incomingAdminAreaId === null ? null : String(incomingAdminAreaId);
    const current = existingAdminAreaId ?? null;
    return next !== current;
}

export function streetUpdateTouchesRoutingGraph(
    input: UpdateStreetInput,
    existing: StreetRow,
    roadClassIdChanged: boolean,
): boolean {
    if (input.geometry) {
        return true;
    }
    if (roadClassIdChanged) {
        return true;
    }
    if (input.is_oneway !== undefined && input.is_oneway !== existing.is_oneway) {
        return true;
    }
    if (input.bridge !== undefined && input.bridge !== existing.bridge) {
        return true;
    }
    if (input.tunnel !== undefined && input.tunnel !== existing.tunnel) {
        return true;
    }
    return false;
}

export function streetUpdateNeedsDetailReload(args: {
    input: UpdateStreetInput;
    existing: StreetRow;
    myanmarChanged: boolean;
    englishChanged: boolean;
    roadClassIdChanged: boolean;
}): boolean {
    const { input, existing, myanmarChanged, englishChanged, roadClassIdChanged } = args;
    if (input.geometry) {
        return true;
    }
    if (myanmarChanged || englishChanged) {
        return true;
    }
    if (roadClassIdChanged) {
        return true;
    }
    if (streetAdminAreaIdChanged(existing.admin_area_id, input.admin_area_id)) {
        return true;
    }
    return false;
}

export function deriveCanonicalNameAfterNameEdits(args: {
    existing: StreetRow;
    myanmarChanged: boolean;
    englishChanged: boolean;
    myanmarName?: string;
    englishName?: string;
}): string {
    return deriveStreetCanonicalName({
        myanmarName: args.myanmarChanged
            ? args.myanmarName?.trim()
            : (args.existing.myanmar_name ?? undefined),
        englishName: args.englishChanged
            ? args.englishName?.trim()
            : (args.existing.english_name ?? undefined),
    });
}

export function applyStreetRowAfterScalarUpdate(
    existing: StreetRow,
    input: UpdateStreetInput,
    patch: {
        canonical_name?: string;
        myanmar_name?: string | null;
        english_name?: string | null;
        routing_status?: string;
        manual_override?: boolean;
    },
): StreetRow {
    const now = new Date();
    return {
        ...existing,
        canonical_name: patch.canonical_name ?? existing.canonical_name,
        admin_area_id:
            input.admin_area_id !== undefined
                ? (input.admin_area_id?.toString() ?? null)
                : existing.admin_area_id,
        surface: input.surface !== undefined ? input.surface : existing.surface,
        is_oneway: input.is_oneway !== undefined ? input.is_oneway : existing.is_oneway,
        bridge: input.bridge !== undefined ? input.bridge : existing.bridge,
        tunnel: input.tunnel !== undefined ? input.tunnel : existing.tunnel,
        verification_status: input.verification_status ?? existing.verification_status,
        is_verified: input.is_verified !== undefined ? input.is_verified : existing.is_verified,
        manual_override: patch.manual_override ?? existing.manual_override,
        routing_status: patch.routing_status ?? existing.routing_status,
        myanmar_name: patch.myanmar_name ?? existing.myanmar_name,
        english_name: patch.english_name ?? existing.english_name,
        updated_at: now,
        last_edited_at: now,
    };
}

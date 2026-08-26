import { getCoreReviewSettlementDuplicateWarnings } from "@/src/lib/api";

function pointFromPayload(payload: Record<string, unknown>): { lat: number; lng: number } | null {
    const geometry = payload.geometry ?? payload.point_geom ?? payload.pointGeom;
    if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
        return null;
    }
    if ((geometry as { type?: string }).type !== "Point") {
        return null;
    }
    const coordinates = (geometry as { coordinates?: unknown }).coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return null;
    }
    const lng = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    return { lat, lng };
}

function formatMeters(distanceM: number | null): string {
    if (distanceM == null || !Number.isFinite(distanceM)) {
        return "distance unknown";
    }
    return `${Math.round(distanceM)} m away`;
}

/** Warning only. Returns false if the user cancels. Does not block create when the check fails. */
export async function confirmSettlementCreateDespiteDuplicates(
    payload: Record<string, unknown>,
): Promise<boolean> {
    const point = pointFromPayload(payload);
    if (!point) {
        return true;
    }

    const townshipId = String(payload.township_id ?? payload.townshipId ?? "").trim();
    const canonicalName = String(payload.canonical_name ?? payload.canonicalName ?? "").trim();
    const nameMm = String(payload.name_mm ?? payload.nameMm ?? "").trim();
    const nameEn = String(payload.name_en ?? payload.nameEn ?? "").trim();

    try {
        const response = await getCoreReviewSettlementDuplicateWarnings({
            canonicalName: canonicalName || undefined,
            nameMm: nameMm || undefined,
            nameEn: nameEn || undefined,
            lat: point.lat,
            lng: point.lng,
            townshipId: townshipId || undefined,
        });
        const rows = response.data ?? [];
        if (rows.length === 0) {
            return true;
        }
        const lines = rows.slice(0, 8).map((row) => {
            const typeLabel = row.settlementTypeCode.replaceAll("_", " ");
            const township = row.townshipName ? ` (${row.townshipName})` : "";
            const flags = [
                formatMeters(row.distanceM),
                row.nameSimilarity != null && row.nameSimilarity >= 0.3 ? "similar name" : null,
                row.sameTownship ? "same township" : null,
            ].filter(Boolean);
            return `- ${typeLabel} "${row.canonicalName}"${township} — ${flags.join(", ")}`;
        });
        return window.confirm(
            ["Possible duplicate settlements found:", ...lines, "", "Create anyway?"].join("\n"),
        );
    } catch {
        return true;
    }
}

type QueryValue = string | number | boolean | null | undefined;

/** True when `fetch` was aborted (Strict Mode remount, navigation, dependency change). */
export function isAbortError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    return (error as { name?: string }).name === "AbortError";
}

export type Place = {
    id: string;
    public_id: string;
    primary_name: string;
    secondary_name: string | null;
    name_local: string | null;
    display_name: string;
    myanmarName: string | null;
    englishName: string | null;
    /** Optional API fields (snake/camel variants) — used by dashboard preview labels when present */
    nameMm?: string | null;
    nameEn?: string | null;
    myanmar_name?: string | null;
    english_name?: string | null;
    name_mm?: string | null;
    name_en?: string | null;
    category_id: string;
    admin_area_id: string | null;
    lat: number;
    lng: number;
    is_public: boolean;
    is_verified: boolean;
    names: PlaceName[];
    category_name: string | null;
    admin_area_name: string | null;
};

export type PlaceDetail = Place & {
    plus_code: string | null;
    importance_score: number | null;
    popularity_score: number | null;
    confidence_score: number | null;
    source_type_id: string;
    publish_status_id: string | null;
};

export type PlaceName = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
    search_weight: number;
};

export type PlacesParams = {
    q?: string;
    category?: string;
    is_public?: boolean;
    is_verified?: boolean;
    limit?: number;
    offset?: number;
};

/** Max `limit` for GET /places (API rejects values above this). */
export const PLACES_LIST_LIMIT = 100;

export type Category = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    sort_order: number;
};

export type AdminArea = {
    id: string;
    parent_id: string | null;
    admin_level_id: string;
    canonical_name: string;
    slug: string;
    is_active: boolean;
};

export type PlaceFormOption = {
    id: string;
    label: string;
    code?: string;
};

export type PlaceFormOptions = {
    categories: PlaceFormOption[];
    admin_areas: PlaceFormOption[];
    source_types: PlaceFormOption[];
    publish_statuses: PlaceFormOption[];
};

/** Body for POST /places — field names match the API */
export type CreatePlacePayload = {
    myanmarName?: string;
    englishName?: string;
    categoryId: string;
    adminAreaId?: string | null;
    lat: number;
    lng: number;
    plusCode?: string | null;
    importanceScore?: number;
    popularityScore?: number;
    confidenceScore?: number;
    isPublic?: boolean;
    isVerified?: boolean;
    sourceTypeId?: string | null;
    publishStatusId?: string | null;
};

export type UpdatePlacePayload = Partial<CreatePlacePayload>;

export type StreetGeometry =
    | {
          type: "LineString";
          coordinates: number[][];
      }
    | {
          type: "MultiLineString";
          coordinates: number[][][];
      }
    | null;

export type Street = {
    public_id: string;
    canonical_name: string;
    myanmarName: string | null;
    englishName: string | null;
    names: StreetName[];
    admin_area_id: string | null;
    admin_area_name: string | null;
    source_type_id?: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    geometry: StreetGeometry;
};

export type StreetDetail = Street;

export type UpdateStreetPayload = {
    canonical_name?: string;
    myanmarName?: string;
    englishName?: string;
    admin_area_id: string | null;
};

export type CreateStreetPayload = {
    canonical_name?: string;
    myanmarName?: string;
    englishName?: string;
    admin_area_id: string | null;
};

export type StreetName = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
};

export type StreetsParams = {
    limit?: number;
};

export type BuildingPolygonGeometry = {
    type: "Polygon";
    coordinates: number[][][];
};

export type BuildingMultiPolygonGeometry = {
    type: "MultiPolygon";
    coordinates: number[][][][];
};

export type BuildingGeometry = BuildingPolygonGeometry | BuildingMultiPolygonGeometry;

/** Row from ref.ref_building_types (GET /building-types and embedded on buildings). */
export type RefBuildingType = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    parent_id: string | null;
    /** Present on GET /building-types; omitted on embedded building references. */
    sort_order?: number;
};

export type Building = {
    id: string;
    public_id: string;
    source_staging_id: string | null;
    external_id: string | null;
    name: string | null;
    /** FK to ref.ref_building_types (when exposed by API). */
    building_type_id?: string | null;
    /** Resolved taxonomy; null when not linked to ref or inactive. */
    building_type: RefBuildingType | null;
    /** From ref join (flat); use for display when building_type object is null. */
    building_type_code?: string | null;
    building_type_name?: string | null;
    building_type_name_mm?: string | null;
    class_code: string;
    normalized_data: Record<string, unknown>;
    source_refs: Record<string, unknown>;
    levels: number | null;
    height_m: number | null;
    area_m2: number | null;
    confidence_score: number | null;
    is_verified: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
    /** Omitted in some list responses — fetch `GET /buildings/:id` for full footprint when missing. */
    geometry?: BuildingGeometry | null;
};

/** Default/max `limit` for GET /buildings (aligned with API default 100). */
export const BUILDINGS_LIST_LIMIT = 100;

export type BuildingsParams = {
    q?: string;
    limit?: number;
    offset?: number;
};

export type DeleteBuildingResponse = {
    ok: boolean;
    deleted: boolean;
    public_id: string;
};

export type PlaceBuildingRelationType = "inside" | "entrance" | "nearby" | "compound";

export type LinkedBuildingSummaryApi = {
    relation_type: string;
    is_primary: boolean;
    created_at: string;
    building: {
        public_id: string;
        name: string | null;
        building_type_id?: string | null;
        building_type: RefBuildingType | null;
        building_type_code?: string | null;
        building_type_name?: string | null;
        building_type_name_mm?: string | null;
        class_code: string;
        area_m2: number | null;
    };
};

export type LinkedPlaceSummaryApi = {
    relation_type: string;
    is_primary: boolean;
    created_at: string;
    place: {
        public_id: string;
        primary_name: string | null;
        display_name: string | null;
        lat?: number | null;
        lng?: number | null;
        category_name: string | null;
    };
};

export type LinkedPlacesForBuildingResponse = {
    items: LinkedPlaceSummaryApi[];
};

export type LinkedPlaceBuildingListResponse = {
    items: LinkedBuildingSummaryApi[];
};

export type LinkPlaceBuildingPayload = {
    building_id: string;
    relation_type?: PlaceBuildingRelationType;
    is_primary?: boolean;
};

export type PatchPlaceBuildingPayload = {
    relation_type?: PlaceBuildingRelationType;
    is_primary?: boolean;
};

/** POST /places/:id/buildings */
export type LinkPlaceBuildingResponse = LinkedBuildingSummaryApi & {
    place_id: string;
};

/** PATCH /places/:id/buildings/:buildingId */
export type PatchPlaceBuildingResponse = LinkPlaceBuildingResponse;

/** POST/PATCH bodies — snake_case matches API JSON */
export type CreateBuildingPayload = {
    geometry: BuildingGeometry;
    name?: string | null;
    /** Prefer {@link building_type_id} when both are set (API resolves ref codes). */
    building_type?: string;
    /** Omit or null: create omits; PATCH may send null to clear FK. */
    building_type_id?: string | null;
    levels?: number;
    height_m?: number;
    confidence_score?: number;
    is_verified?: boolean;
};

export type UpdateBuildingPayload = Partial<CreateBuildingPayload>;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

function getApiBaseUrl(): string {
    if (!API_BASE_URL) {
        throw new Error("NEXT_PUBLIC_API_BASE_URL is not configured.");
    }

    return API_BASE_URL.replace(/\/+$/, "");
}

function buildUrl(path: string, params?: Record<string, QueryValue>): string {
    const url = new URL(path, `${getApiBaseUrl()}/`);

    if (!params) {
        return url.toString();
    }

    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === "") {
            continue;
        }

        url.searchParams.set(key, String(value));
    }

    return url.toString();
}

function getAccessToken(): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    return window.localStorage.getItem("accessToken");
}

function clearAuthTokens() {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.removeItem("accessToken");
    window.localStorage.removeItem("token");
    window.localStorage.removeItem("authToken");
    window.localStorage.removeItem("jwt");
}

function redirectToLogin() {
    if (typeof window === "undefined" || window.location.pathname === "/login") {
        return;
    }

    window.location.replace("/login");
}

/** Formats API `issues` from Zod `.flatten()` or `{ path, message }[]` (e.g. building geometry validation). */
function formatApiIssuesBlock(issues: unknown): string {
    if (issues === undefined || issues === null) {
        return "";
    }

    if (Array.isArray(issues)) {
        const lines: string[] = [];

        for (const item of issues) {
            if (item && typeof item === "object" && !Array.isArray(item)) {
                const rec = item as { path?: unknown; message?: unknown };
                const path = typeof rec.path === "string" && rec.path.trim() ? rec.path.trim() : "";
                const msg = typeof rec.message === "string" && rec.message.trim() ? rec.message.trim() : "";

                if (path && msg) {
                    lines.push(`• ${path}: ${msg}`);
                } else if (msg) {
                    lines.push(`• ${msg}`);
                } else {
                    lines.push(`• ${JSON.stringify(item)}`);
                }
            } else {
                lines.push(`• ${String(item)}`);
            }
        }

        return lines.join("\n");
    }

    if (typeof issues === "object") {
        const o = issues as { formErrors?: unknown; fieldErrors?: Record<string, unknown> };
        const lines: string[] = [];

        if (Array.isArray(o.formErrors)) {
            for (const fe of o.formErrors) {
                if (typeof fe === "string" && fe.trim()) {
                    lines.push(`• ${fe.trim()}`);
                }
            }
        }

        if (o.fieldErrors && typeof o.fieldErrors === "object") {
            for (const [field, errs] of Object.entries(o.fieldErrors)) {
                if (Array.isArray(errs)) {
                    for (const err of errs) {
                        if (typeof err === "string" && err.trim()) {
                            lines.push(`• ${field}: ${err.trim()}`);
                        }
                    }
                }
            }
        }

        return lines.join("\n");
    }

    return `• ${String(issues)}`;
}

async function getErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
        let data: Record<string, unknown>;

        try {
            data = (await response.json()) as Record<string, unknown>;
        } catch {
            return `Request failed with status ${response.status}`;
        }

        const headline: string[] = [];

        if (typeof data.message === "string" && data.message.trim()) {
            headline.push(data.message.trim());
        }

        if (typeof data.error === "string" && data.error.trim()) {
            headline.push(data.error.trim());
        }

        const issuesBlock = formatApiIssuesBlock(data.issues);

        if (issuesBlock) {
            return headline.length > 0 ? `${headline.join(" — ")}\n\n${issuesBlock}` : issuesBlock;
        }

        if (headline.length > 0) {
            return headline.join(" — ");
        }

        return JSON.stringify(data);
    }

    const text = await response.text();

    if (text.trim()) {
        return text;
    }

    return `Request failed with status ${response.status}`;
}

export async function apiFetch<T>(
    path: string,
    init: RequestInit = {},
    params?: Record<string, QueryValue>
): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");

    const accessToken = getAccessToken();
    if (!accessToken) {
        redirectToLogin();
        throw new Error("Authentication required");
    }

    headers.set("Authorization", `Bearer ${accessToken}`);

    const response = await fetch(buildUrl(path, params), {
        ...init,
        headers,
    });

    if (response.status === 401) {
        clearAuthTokens();
        redirectToLogin();
        throw new Error("Session expired. Please log in again.");
    }

    if (!response.ok) {
        const message = await getErrorMessage(response);
        throw new Error(message);
    }

    return (await response.json()) as T;
}

export function getPlaces(params?: PlacesParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Place[]>("/places", { method: "GET", ...fetchInit }, params);
}

export function getPlace(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<PlaceDetail>(`/places/${id}`, { method: "GET", ...fetchInit });
}

export function getPlaceFormOptions() {
    return apiFetch<PlaceFormOptions>("/place-form-options", { method: "GET" });
}

export function updatePlace(id: string, payload: UpdatePlacePayload) {
    console.log("PATCH_PLACE_PAYLOAD", id, payload);

    return apiFetch<PlaceDetail>(`/places/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function createPlace(payload: CreatePlacePayload) {
    console.log("CREATE_PLACE_PAYLOAD", payload);

    return apiFetch<PlaceDetail>("/places", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function deletePlace(id: string) {
    return apiFetch<{ success: boolean; public_id: string }>(`/places/${id}`, {
        method: "DELETE",
    });
}

export function getCategories() {
    return apiFetch<Category[]>("/categories", { method: "GET" });
}

export function getAdminAreas() {
    return apiFetch<AdminArea[]>("/admin-areas", { method: "GET" });
}

export function getStreets(params?: StreetsParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Street[]>("/streets", { method: "GET", ...fetchInit }, params);
}

export function getStreet(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<StreetDetail>(`/streets/${id}`, { method: "GET", ...fetchInit });
}

export function createStreet(payload: CreateStreetPayload) {
    return apiFetch<StreetDetail>("/streets", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function updateStreet(id: string, payload: UpdateStreetPayload) {
    return apiFetch<StreetDetail>(`/streets/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function getBuildings(params?: BuildingsParams, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Building[]>("/buildings", { method: "GET", ...fetchInit }, params);
}

export function getBuildingTypes(fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<RefBuildingType[]>("/building-types", { method: "GET", ...fetchInit });
}

export function getBuilding(id: string, fetchInit?: Pick<RequestInit, "signal">) {
    return apiFetch<Building>(`/buildings/${id}`, { method: "GET", ...fetchInit });
}

export function createBuilding(payload: CreateBuildingPayload) {
    return apiFetch<Building>("/buildings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function updateBuilding(id: string, payload: UpdateBuildingPayload) {
    return apiFetch<Building>(`/buildings/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function deleteBuilding(id: string) {
    return apiFetch<DeleteBuildingResponse>(`/buildings/${id}`, {
        method: "DELETE",
    });
}

export function getLinkedBuildingsForPlace(placePublicId: string) {
    return apiFetch<LinkedPlaceBuildingListResponse>(`/places/${placePublicId}/buildings`, {
        method: "GET",
    });
}

export function linkBuildingToPlace(placePublicId: string, payload: LinkPlaceBuildingPayload) {
    return apiFetch<LinkPlaceBuildingResponse>(`/places/${placePublicId}/buildings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            building_id: payload.building_id,
            relation_type: payload.relation_type ?? "inside",
            is_primary: payload.is_primary ?? false,
        }),
    });
}

export function unlinkBuildingFromPlace(placePublicId: string, buildingPublicId: string) {
    return apiFetch<{ ok: boolean; place_id: string; building_id: string }>(
        `/places/${placePublicId}/buildings/${buildingPublicId}`,
        { method: "DELETE" }
    );
}

export function getLinkedPlacesForBuilding(buildingPublicId: string) {
    return apiFetch<LinkedPlacesForBuildingResponse>(`/buildings/${buildingPublicId}/places`, {
        method: "GET",
    });
}

export function patchPlaceBuildingLink(
    placePublicId: string,
    buildingPublicId: string,
    payload: PatchPlaceBuildingPayload
) {
    return apiFetch<PatchPlaceBuildingResponse>(
        `/places/${placePublicId}/buildings/${buildingPublicId}`,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }
    );
}

type QueryValue = string | number | boolean | null | undefined;

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

async function getErrorMessage(response: Response): Promise<string> {
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
        let data: Record<string, unknown>;

        try {
            data = (await response.json()) as Record<string, unknown>;
        } catch {
            return `Request failed with status ${response.status}`;
        }

        const parts: string[] = [];

        if (typeof data.message === "string" && data.message.trim()) {
            parts.push(data.message.trim());
        }

        if (typeof data.error === "string" && data.error.trim()) {
            parts.push(data.error.trim());
        }

        if (data.issues !== undefined) {
            try {
                parts.push(JSON.stringify(data.issues));
            } catch {
                parts.push(String(data.issues));
            }
        }

        if (parts.length > 0) {
            return parts.join(" — ");
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

export function getPlaces(params?: PlacesParams) {
    return apiFetch<Place[]>("/places", { method: "GET" }, params);
}

export function getPlace(id: string) {
    return apiFetch<PlaceDetail>(`/places/${id}`, { method: "GET" });
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

export function getStreets(params?: StreetsParams) {
    return apiFetch<Street[]>("/streets", { method: "GET" }, params);
}

export function getStreet(id: string) {
    return apiFetch<StreetDetail>(`/streets/${id}`, { method: "GET" });
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

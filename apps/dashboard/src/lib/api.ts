type QueryValue = string | number | boolean | null | undefined;

export type Place = {
    id: string;
    public_id: string;
    primary_name: string;
    display_name: string;
    myanmarName: string | null;
    englishName: string | null;
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
    current_version_id: string | null;
    deleted_at: string | null;
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

export type UpdatePlacePayload = {
    primary_name?: string;
    display_name?: string;
    myanmarName?: string;
    englishName?: string;
    category_id?: string | null;
    admin_area_id?: string | null;
    lat?: number;
    lng?: number;
    plus_code?: string | null;
    importance_score?: number | null;
    popularity_score?: number | null;
    confidence_score?: number | null;
    is_public?: boolean;
    is_verified?: boolean;
    source_type_id?: string | null;
    publish_status_id?: string | null;
};

export type CreatePlacePayload = {
    primary_name?: string;
    display_name?: string;
    myanmarName?: string;
    englishName?: string;
    category_id: string;
    admin_area_id?: string | null;
    plus_code?: string | null;
    lat: number;
    lng: number;
    importance_score?: number | null;
    popularity_score?: number | null;
    confidence_score?: number | null;
    is_public?: boolean;
    is_verified?: boolean;
    source_type_id?: string | null;
    publish_status_id?: string | null;
};

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
        const data = (await response.json()) as {
            message?: string;
            error?: string;
            issues?: unknown;
        };

        if (typeof data.message === "string" && data.message.trim()) {
            return data.message;
        }

        if (typeof data.error === "string" && data.error.trim()) {
            return data.error;
        }
    } else {
        const text = await response.text();

        if (text.trim()) {
            return text;
        }
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
    return apiFetch<PlaceDetail>(`/places/${id}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
}

export function createPlace(payload: CreatePlacePayload) {
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

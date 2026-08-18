import type { Geometry } from "geojson";
import { z } from "zod";

import type { ImportReviewGeoJson } from "@/src/lib/api";
import {
    normalizeVerificationStatus,
    verificationStatusOptions,
    type CoreReviewVerificationStatus,
} from "@/src/features/core-review/config/verificationStatus";
import { preparePolygonGeometryForSave } from "@/src/lib/core-review/savePayloadUtils";
import {
    createCoreReviewEntity,
    getCoreReviewDetail,
    updateCoreReviewEntity,
    type CoreReviewEntitySlug,
} from "@/src/lib/api";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";

import type { CoreEntityFieldDef, CoreEntityFormValues } from "./types";

export function verificationStatusFormField(): CoreEntityFieldDef {
    return {
        key: "verification_status",
        label: "Verification status",
        type: "select",
        selectOptions: [...verificationStatusOptions],
    };
}

export function verificationStatusFromDetail(detail: {
    verificationStatus?: string | null;
    verification_status?: string | null;
    isVerified?: boolean | null;
    is_verified?: boolean | null;
}): CoreReviewVerificationStatus {
    return normalizeVerificationStatus(
        detail.verificationStatus ?? detail.verification_status,
        detail.isVerified ?? detail.is_verified,
    );
}

export function verificationStatusPayloadValue(
    values: CoreEntityFormValues,
    key = "verification_status",
): CoreReviewVerificationStatus {
    const raw = values[key];
    return normalizeVerificationStatus(typeof raw === "string" ? raw : undefined);
}

export function verificationStatusWritePayload(
    values: CoreEntityFormValues,
    key = "verification_status",
): { verification_status: CoreReviewVerificationStatus } {
    return { verification_status: verificationStatusPayloadValue(values, key) };
}

export function createCoreReviewWriteMutations<TDetail>(slug: CoreReviewEntitySlug) {
    return {
        createEntity: (payload: unknown) => createCoreReviewEntity<TDetail>(slug, payload),
        updateEntity: (id: string, payload: unknown) =>
            updateCoreReviewEntity<TDetail>(slug, id, payload),
    };
}

export function detailRecordId(detail: {
    publicId?: string;
    public_id?: string;
    id?: string | number;
}): string {
    if (detail.publicId) return detail.publicId;
    if (detail.public_id) return detail.public_id;
    return String(detail.id ?? "");
}

export function nullableFormString(value: unknown): string | null {
    const trimmed = String(value ?? "").trim();
    return trimmed || null;
}

export function optionalFormRefId(value: unknown): string | null {
    return nullableFormString(value);
}

/** Parse a required ref dropdown value into a numeric id for API payloads. */
export function parseRequiredFormRefId(value: unknown, fieldLabel: string): number {
    const trimmed = String(value ?? "").trim();
    if (!/^\d+$/.test(trimmed)) {
        throw new Error(`${fieldLabel} must be selected from the list (numeric id required).`);
    }
    return Number.parseInt(trimmed, 10);
}

/** Parse an optional ref dropdown value into a numeric id, or null when blank. */
export function parseOptionalFormRefId(value: unknown): number | null {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return null;
    }
    if (!/^\d+$/.test(trimmed)) {
        throw new Error("Reference selection must use a numeric id from the dropdown.");
    }
    return Number.parseInt(trimmed, 10);
}

export function requirePointGeometry(values: CoreEntityFormValues, fieldKey: string): Geometry {
    const geometry = getFormGeometry(values, fieldKey);
    if (!geometry || geometry.type !== "Point") {
        throw new Error("Click the map to set a location.");
    }
    return geometry;
}

export function requireLineGeometry(values: CoreEntityFormValues, fieldKey: string): Geometry {
    const geometry = getFormGeometry(values, fieldKey);
    if (!geometry || geometry.type !== "LineString") {
        throw new Error("Draw a line on the map before saving.");
    }
    if (geometry.coordinates.length < 2) {
        throw new Error("Line must have at least two coordinates.");
    }
    return geometry;
}

export function requirePolygonGeometry(values: CoreEntityFormValues, fieldKey: string): Geometry {
    const geometry = getFormGeometry(values, fieldKey);
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) {
        throw new Error("Draw a polygon on the map before saving.");
    }
    return preparePolygonGeometryForSave(geometry);
}

export function mapClassifiedFeaturePayload(values: CoreEntityFormValues, geomField = "geom") {
    const waterClassId = parseRequiredFormRefId(values.water_class_id, "Water class");
    return {
        name: nullableFormString(values.name),
        water_class_id: waterClassId,
        waterClassId,
        is_active: bool(values.is_active),
        ...verificationStatusWritePayload(values),
        geom: requirePolygonGeometry(values, geomField),
    };
}

export function mapWaterLinePayload(values: CoreEntityFormValues, geomField = "geom") {
    const waterClassId = parseRequiredFormRefId(values.water_class_id, "Water class");
    return {
        name: nullableFormString(values.name),
        water_class_id: waterClassId,
        waterClassId,
        is_active: bool(values.is_active),
        ...verificationStatusWritePayload(values),
        geom: requireLineGeometry(values, geomField),
    };
}

/** Thrown by placeholder create/update handlers until write APIs exist. */
export const CORE_ENTITY_WRITE_API_TODO =
    "TODO: Wire POST/PATCH when the API module for this entity is implemented.";

export function createCoreReviewFetchDetail<T>(slug: CoreReviewEntitySlug) {
    return async (id: string): Promise<T> => {
        const response = await getCoreReviewDetail<T>(slug, id);
        return response.data;
    };
}

export function createPendingWriteMutations<TDetail>() {
    return {
        // TODO: Replace with real POST when API is implemented.
        createEntity: async (_payload: unknown): Promise<TDetail> => {
            throw new Error(CORE_ENTITY_WRITE_API_TODO);
        },
        // TODO: Replace with real PATCH when API is implemented.
        updateEntity: async (_id: string, _payload: unknown): Promise<TDetail> => {
            throw new Error(CORE_ENTITY_WRITE_API_TODO);
        },
    } as {
        createEntity: (payload: unknown) => Promise<TDetail>;
        updateEntity: (id: string, payload: unknown) => Promise<TDetail>;
    };
}

export function geometryFromDetail(value: ImportReviewGeoJson | null | undefined): Geometry | null {
    if (!value || typeof value !== "object" || !("type" in value)) {
        return null;
    }
    return value as unknown as Geometry;
}

export function pointFromDetailGeometry(
    value: ImportReviewGeoJson | null | undefined,
): Geometry | null {
    const geom = geometryFromDetail(value);
    if (geom?.type === "Point") {
        return geom;
    }
    return null;
}

export function lineFromDetailGeometry(value: ImportReviewGeoJson | null | undefined): Geometry | null {
    const geom = geometryFromDetail(value);
    if (!geom) {
        return null;
    }
    if (geom.type === "LineString") {
        return geom;
    }
    if (geom.type === "MultiLineString" && geom.coordinates[0]) {
        return { type: "LineString", coordinates: geom.coordinates[0] };
    }
    return null;
}

export function polygonFromDetailGeometry(value: ImportReviewGeoJson | null | undefined): Geometry | null {
    const geom = geometryFromDetail(value);
    if (!geom) {
        return null;
    }
    if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
        return geom;
    }
    return null;
}

export const standardIdReadonlyFields = (): CoreEntityFieldDef[] => [
    { key: "id", label: "Internal ID", type: "text", detailPath: "id" },
];

export const standardPublicIdReadonlyFields = (): CoreEntityFieldDef[] => [
    { key: "public_id", label: "Public ID", type: "text", detailPath: "publicId" },
];

export const standardTimestampReadonlyFields = (): CoreEntityFieldDef[] => [
    { key: "created_at", label: "Created", type: "date-readonly", detailPath: "createdAt" },
    { key: "updated_at", label: "Updated", type: "date-readonly", detailPath: "updatedAt" },
];

export const yesNoFormat = (v: unknown) => (v ? "Yes" : "No");

export const optionalStringSchema = z.string();
export const optionalBooleanSchema = z.boolean();
export const optionalNumberStringSchema = z.string();
export const optionalGeometrySchema = z.custom<Geometry | null>();

export function str(value: unknown): string {
    return value == null ? "" : String(value);
}

export function bool(value: unknown): boolean {
    return Boolean(value);
}

export function noopPayload(_values: CoreEntityFormValues): Record<string, never> {
    return {};
}

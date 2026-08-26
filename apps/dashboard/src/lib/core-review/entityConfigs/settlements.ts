import type { Geometry } from "geojson";
import { z } from "zod";

import { coreReviewPath } from "@/src/lib/dashboardNavigation";
import { SETTLEMENT_TYPE_OPTIONS } from "@/src/lib/core-review/settlementTypes";

import {
    createCoreReviewFetchDetail,
    createCoreReviewWriteMutations,
    detailRecordId,
    nullableFormString,
    parseOptionalFormRefId,
    requirePointGeometry,
    standardPublicIdReadonlyFields,
    standardTimestampReadonlyFields,
    verificationStatusFormField,
    verificationStatusFromDetail,
    verificationStatusWritePayload,
    yesNoFormat,
} from "./shared";
import type { CoreEntityConfig, CoreEntityFormValues } from "./types";

const POINT_GEOM_FIELD = "point_geom";

type SettlementDetail = {
    id?: string | number;
    publicId?: string;
    public_id?: string;
    canonicalName?: string | null;
    canonical_name?: string | null;
    nameMm?: string | null;
    name_mm?: string | null;
    nameEn?: string | null;
    name_en?: string | null;
    settlementTypeCode?: string | null;
    settlement_type_code?: string | null;
    townshipId?: string | number | null;
    township_id?: string | number | null;
    adminAreaId?: string | number | null;
    population?: number | null;
    sourceTypeId?: string | number | null;
    source_type_id?: string | number | null;
    hasFootprint?: boolean | null;
    lat?: number | null;
    lng?: number | null;
    geometry?: { type?: string; coordinates?: number[] } | null;
    verificationStatus?: string | null;
    verification_status?: string | null;
    isVerified?: boolean | null;
};

function settlementFormSchema() {
    return z
        .object({
            canonicalName: z.string().trim().min(1, "Canonical name is required"),
            nameMm: z.string(),
            nameEn: z.string(),
            settlementType: z.string().min(1, "Settlement type is required"),
            townshipId: z.string(),
            population: z.union([z.string(), z.number()]),
            sourceTypeId: z.string(),
            verification_status: z.string(),
            point_geom: z.custom<Geometry | null>(),
        })
        .refine(
            (values) => {
                if (!values.point_geom || values.point_geom.type !== "Point") {
                    return false;
                }
                const [lng, lat] = values.point_geom.coordinates;
                return Number.isFinite(lng) && Number.isFinite(lat);
            },
            { message: "Click the map to set a location", path: ["point_geom"] },
        );
}

function parseOptionalPopulation(value: unknown): number | null {
    const raw = String(value ?? "").trim();
    if (!raw) {
        return null;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("Population must be a whole number of 0 or more.");
    }
    return parsed;
}

function formValuesToSettlementPayload(values: CoreEntityFormValues) {
    const geometry = requirePointGeometry(values, POINT_GEOM_FIELD);
    return {
        canonical_name: String(values.canonicalName ?? "").trim(),
        name_mm: nullableFormString(values.nameMm),
        name_en: nullableFormString(values.nameEn),
        settlement_type: String(values.settlementType ?? "").trim(),
        township_id: parseOptionalFormRefId(values.townshipId),
        population: parseOptionalPopulation(values.population),
        source_type_id: parseOptionalFormRefId(values.sourceTypeId),
        ...verificationStatusWritePayload(values),
        geometry,
    };
}

const settlementWriteMutations = createCoreReviewWriteMutations<SettlementDetail>("settlements");

export const SETTLEMENTS_ENTITY_CONFIG: CoreEntityConfig<SettlementDetail> = {
    entityKey: "settlements",
    label: "Settlement",
    labelPlural: "Settlements",
    routeSegment: "settlements",
    coreReviewSlug: "settlements",
    apiBase: "/core-review/settlements",
    listRoute: coreReviewPath("settlements"),
    createRoute: coreReviewPath("settlements/new"),
    editRoute: (id) => coreReviewPath(`settlements/${id}/edit`),
    writeApiAvailable: true,
    geometry: {
        fieldKey: POINT_GEOM_FIELD,
        geometryType: "point",
        title: "Settlement location",
    },
    editableFields: [
        {
            key: "settlementType",
            label: "Settlement type",
            type: "select",
            required: true,
            selectOptions: SETTLEMENT_TYPE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
            })),
        },
        { key: "canonicalName", label: "Canonical name", type: "text", required: true },
        { key: "nameMm", label: "Myanmar name", type: "text" },
        { key: "nameEn", label: "English name", type: "text" },
        {
            key: "townshipId",
            label: "Township",
            type: "ref",
            refSource: "township-admin-areas",
            helpText: "Optional",
        },
        {
            key: "population",
            label: "Population",
            type: "number",
            numberMin: 0,
            placeholder: "Optional",
        },
        verificationStatusFormField(),
        {
            key: "sourceTypeId",
            label: "Source type",
            type: "ref",
            refSource: "reference-options:source_types",
            helpText: "Optional — defaults to manual when left blank.",
        },
    ],
    readonlyMetadata: [
        ...standardPublicIdReadonlyFields(),
        ...standardTimestampReadonlyFields(),
        {
            key: "hasFootprint",
            label: "Polygon/footprint available",
            type: "text",
            detailPath: "hasFootprint",
            format: yesNoFormat,
        },
    ],
    defaultFormValues: {
        canonicalName: "",
        nameMm: "",
        nameEn: "",
        settlementType: "",
        townshipId: "",
        population: "",
        sourceTypeId: "",
        verification_status: "unverified",
        point_geom: null,
    },
    formSchema: settlementFormSchema,
    detailToFormValues: (detail) => {
        const d = detail;
        const lat =
            typeof d.lat === "number"
                ? d.lat
                : Array.isArray(d.geometry?.coordinates)
                  ? Number(d.geometry.coordinates[1])
                  : 0;
        const lng =
            typeof d.lng === "number"
                ? d.lng
                : Array.isArray(d.geometry?.coordinates)
                  ? Number(d.geometry.coordinates[0])
                  : 0;

        return {
            canonicalName: d.canonicalName ?? d.canonical_name ?? "",
            nameMm: d.nameMm ?? d.name_mm ?? "",
            nameEn: d.nameEn ?? d.name_en ?? "",
            settlementType: d.settlementTypeCode ?? d.settlement_type_code ?? "",
            townshipId: String(d.townshipId ?? d.township_id ?? d.adminAreaId ?? ""),
            population: d.population == null ? "" : String(d.population),
            sourceTypeId: String(d.sourceTypeId ?? d.source_type_id ?? ""),
            verification_status: verificationStatusFromDetail(d),
            point_geom: {
                type: "Point",
                coordinates: [lng, lat],
            },
        };
    },
    formValuesToCreatePayload: formValuesToSettlementPayload,
    formValuesToUpdatePayload: formValuesToSettlementPayload,
    getDetailId: detailRecordId,
    fetchDetail: createCoreReviewFetchDetail("settlements"),
    createEntity: settlementWriteMutations.createEntity,
    updateEntity: settlementWriteMutations.updateEntity,
    createDescription:
        "Set the settlement point on the map, then fill in type and names. A polygon is not required.",
    editDescription: (detail) => `public_id: ${detail.publicId ?? detail.public_id ?? ""}`,
};

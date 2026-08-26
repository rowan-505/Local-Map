"use client";

import {
    Controller,
    type Control,
    type FieldErrors,
    type UseFormSetValue,
    type UseFormWatch,
} from "react-hook-form";

import { isStreetSurfacePreset, STREET_SURFACE_PRESETS } from "@/src/features/streets/streetSurfaces";
import type {
    CoreEntityFieldDef,
    CoreEntityFormMode,
    CoreEntityFormValues,
} from "@/src/lib/core-review/entityConfigs/types";

import { formatBuildingTypeDisplay } from "@/src/lib/building-type/display";

import CoreRefDropdown from "./CoreRefDropdown";
import EntityTownshipAdminField from "./EntityTownshipAdminField";
import type { CoreRefLoadState } from "./useCoreEntityRefs";
import type { CoreRefSourceKind } from "@/src/lib/core-review/entityConfigs/types";
import type { EntityAdminAreaKind, RoadInferCurrentAdminArea } from "@/src/lib/api";

const inputClass =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-50";

export type CoreEntityFieldRendererProps = {
    field: CoreEntityFieldDef;
    mode: CoreEntityFormMode;
    control: Control<CoreEntityFormValues>;
    errors: FieldErrors<CoreEntityFormValues>;
    disabled?: boolean;
    refStates: Record<CoreRefSourceKind, CoreRefLoadState>;
    editDetail?: unknown | null;
    watch?: UseFormWatch<CoreEntityFormValues>;
    setValue?: UseFormSetValue<CoreEntityFormValues>;
};

function buildingTypeOrphanLabel(detail: unknown | null | undefined): string | null {
    if (!detail || typeof detail !== "object") {
        return null;
    }
    const d = detail as Record<string, unknown>;
    const embedded =
        d.building_type && typeof d.building_type === "object" && !Array.isArray(d.building_type)
            ? (d.building_type as Record<string, unknown>)
            : null;
    const label = formatBuildingTypeDisplay({
        buildingTypeCode:
            (typeof d.building_type_code === "string" ? d.building_type_code : null) ??
            (typeof d.buildingTypeCode === "string" ? d.buildingTypeCode : null) ??
            (typeof embedded?.code === "string" ? embedded.code : null),
        buildingTypeName:
            (typeof d.building_type_name === "string" ? d.building_type_name : null) ??
            (typeof d.buildingTypeName === "string" ? d.buildingTypeName : null) ??
            (typeof embedded?.name === "string" ? embedded.name : null),
        legacyBuildingType: typeof d.building_type === "string" ? d.building_type : null,
        buildingTypeId:
            d.building_type_id != null
                ? String(d.building_type_id)
                : d.buildingTypeId != null
                  ? String(d.buildingTypeId)
                  : null,
        normalizedData: d.normalized_data ?? d.normalizedData,
    });
    return label || null;
}

function fieldError(errors: FieldErrors<Record<string, unknown>>, key: string): string | undefined {
    const err = errors[key];
    return typeof err?.message === "string" ? err.message : undefined;
}

/** Stored admin-area row from place/building detail (no infer audit fields on API yet). */
function storedCurrentAdminAreaFromDetail(
    entityKind: EntityAdminAreaKind,
    detailRecord: Record<string, unknown> | null,
): RoadInferCurrentAdminArea | null {
    if (!detailRecord) {
        return null;
    }

    const id = String(detailRecord.admin_area_id ?? detailRecord.adminAreaId ?? "").trim();
    if (!id) {
        return null;
    }

    if (entityKind === "place") {
        const name =
            typeof detailRecord.admin_area_name === "string"
                ? detailRecord.admin_area_name
                : typeof detailRecord.adminAreaName === "string"
                  ? detailRecord.adminAreaName
                  : null;
        return { id, name, level_code: null, is_active: null };
    }

    if (entityKind === "building") {
        const embedded = detailRecord.admin_area;
        if (embedded && typeof embedded === "object" && !Array.isArray(embedded)) {
            const ref = embedded as Record<string, unknown>;
            const name =
                typeof ref.canonical_name === "string"
                    ? ref.canonical_name
                    : typeof ref.name === "string"
                      ? ref.name
                      : null;
            return { id, name, level_code: null, is_active: null };
        }
        return { id, name: null, level_code: null, is_active: null };
    }

    return null;
}

export default function CoreEntityFieldRenderer({
    field,
    mode,
    control,
    errors,
    disabled,
    refStates,
    editDetail,
    watch,
    setValue,
}: CoreEntityFieldRendererProps) {
    if (field.createOnly && mode === "edit") return null;
    if (field.editOnly && mode === "create") return null;

    const error = fieldError(errors, field.key);
    const id = `core-field-${field.key}`;

    if (field.type === "township-admin" && field.townshipAdmin && watch && setValue) {
        const usesStoredAdminInfer =
            field.townshipAdmin.entityKind === "street" ||
            field.townshipAdmin.entityKind === "land_area" ||
            field.townshipAdmin.entityKind === "bus_stop" ||
            field.townshipAdmin.entityKind === "place" ||
            field.townshipAdmin.entityKind === "building";
        const detailRecord =
            usesStoredAdminInfer && editDetail && typeof editDetail === "object"
                ? (editDetail as Record<string, unknown>)
                : null;
        const storedAdminAreaId = detailRecord
            ? String(detailRecord.admin_area_id ?? detailRecord.adminAreaId ?? "").trim()
            : "";
        const entityPublicId = detailRecord
            ? String(detailRecord.public_id ?? detailRecord.publicId ?? "").trim()
            : "";
        const storedCurrentAdminArea =
            field.townshipAdmin.entityKind === "place" ||
            field.townshipAdmin.entityKind === "building"
                ? storedCurrentAdminAreaFromDetail(field.townshipAdmin.entityKind, detailRecord)
                : null;

        return (
            <EntityTownshipAdminField
                config={{
                    entityKind: field.townshipAdmin.entityKind,
                    geometryFieldKey: field.townshipAdmin.geometryFieldKey,
                    adminAreaIdKey: field.townshipAdmin.adminAreaIdKey,
                    manualOverrideKey: field.townshipAdmin.manualOverrideKey,
                }}
                control={control}
                watch={watch}
                setValue={setValue}
                disabled={disabled}
                error={error}
                storedAdminAreaId={storedAdminAreaId || null}
                storedCurrentAdminArea={storedCurrentAdminArea}
                entityPublicId={entityPublicId || null}
            />
        );
    }

    if (field.type === "ref" && field.refSource) {
        return (
            <Controller
                name={field.key}
                control={control}
                render={({ field: f }) => (
                    <CoreRefDropdown
                        id={id}
                        label={field.label}
                        value={String(f.value ?? "")}
                        onChange={f.onChange}
                        required={field.required}
                        disabled={disabled}
                        placeholder={`Select ${field.label.toLowerCase()}…`}
                        helpText={field.helpText}
                        error={error}
                        refSource={field.refSource!}
                        refState={refStates[field.refSource!]}
                        orphanOptionLabel={
                            field.key === "building_type_id" ? buildingTypeOrphanLabel(editDetail) : null
                        }
                    />
                )}
            />
        );
    }

    if (field.type === "select") {
        const options = field.selectOptions ?? [];
        return (
            <Controller
                name={field.key}
                control={control}
                render={({ field: f }) => (
                    <label className="block" htmlFor={id}>
                        <span className="mb-1 block text-sm font-medium text-slate-700">
                            {field.label}
                            {field.required ? <span className="text-red-600"> *</span> : null}
                        </span>
                        <select
                            id={id}
                            value={String(f.value ?? "")}
                            disabled={disabled}
                            onChange={(e) => f.onChange(e.target.value)}
                            className={inputClass}
                        >
                            <option value="">Select…</option>
                            {options.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        {field.helpText ? (
                            <p className="mt-1 text-xs text-slate-500">{field.helpText}</p>
                        ) : null}
                        {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
                    </label>
                )}
            />
        );
    }

    if (field.type === "boolean") {
        return (
            <Controller
                name={field.key}
                control={control}
                render={({ field: f }) => (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                        <input
                            id={id}
                            type="checkbox"
                            checked={Boolean(f.value)}
                            disabled={disabled}
                            onChange={(e) => f.onChange(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>{field.label}</span>
                    </label>
                )}
            />
        );
    }

    if (field.type === "surface-preset") {
        return (
            <Controller
                name={field.key}
                control={control}
                render={({ field: f }) => {
                    const value = String(f.value ?? "");
                    const presetValue =
                        value && isStreetSurfacePreset(value) ? value : value !== "" ? "__custom__" : "";

                    return (
                        <div className="space-y-2">
                            <label className="block" htmlFor={`${id}-preset`}>
                                <span className="mb-1 block text-sm font-medium text-slate-700">{field.label}</span>
                                <select
                                    id={`${id}-preset`}
                                    value={presetValue}
                                    disabled={disabled}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        f.onChange(v === "__custom__" ? "" : v);
                                    }}
                                    className={inputClass}
                                >
                                    {STREET_SURFACE_PRESETS.map((preset) => (
                                        <option key={preset.value || "empty"} value={preset.value || ""}>
                                            {preset.label}
                                        </option>
                                    ))}
                                    <option value="__custom__">Custom…</option>
                                </select>
                            </label>
                            {presetValue === "__custom__" || (value && !isStreetSurfacePreset(value)) ? (
                                <input
                                    id={id}
                                    type="text"
                                    value={value}
                                    disabled={disabled}
                                    onChange={(e) => f.onChange(e.target.value)}
                                    placeholder="Custom surface"
                                    className={inputClass}
                                    list={`${id}-surfaces`}
                                />
                            ) : null}
                            <datalist id={`${id}-surfaces`}>
                                {STREET_SURFACE_PRESETS.filter((p) => p.value).map((p) => (
                                    <option key={p.value} value={p.value} />
                                ))}
                            </datalist>
                            {field.helpText ? (
                                <p className="text-xs text-slate-500">{field.helpText}</p>
                            ) : null}
                            {error ? <p className="text-sm text-red-600">{error}</p> : null}
                        </div>
                    );
                }}
            />
        );
    }

    if (field.type === "textarea") {
        return (
            <Controller
                name={field.key}
                control={control}
                render={({ field: f }) => (
                    <label className="block" htmlFor={id}>
                        <span className="mb-1 block text-sm font-medium text-slate-700">{field.label}</span>
                        <textarea
                            id={id}
                            rows={3}
                            value={String(f.value ?? "")}
                            disabled={disabled}
                            placeholder={field.placeholder}
                            onChange={f.onChange}
                            className={inputClass}
                        />
                        {field.helpText ? (
                            <p className="mt-1 text-xs text-slate-500">{field.helpText}</p>
                        ) : null}
                        {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
                    </label>
                )}
            />
        );
    }

    if (field.type === "number") {
        return (
            <Controller
                name={field.key}
                control={control}
                render={({ field: f }) => (
                    <label className="block" htmlFor={id}>
                        <span className="mb-1 block text-sm font-medium text-slate-700">
                            {field.label}
                            {field.required ? <span className="text-red-600"> *</span> : null}
                        </span>
                        <input
                            id={id}
                            type="number"
                            value={f.value === "" || f.value == null ? "" : String(f.value)}
                            disabled={disabled}
                            placeholder={field.placeholder}
                            min={field.numberMin}
                            max={field.numberMax}
                            step={field.numberStep ?? "any"}
                            onChange={(e) => {
                                const raw = e.target.value;
                                f.onChange(raw === "" ? "" : Number(raw));
                            }}
                            className={inputClass}
                        />
                        {field.helpText ? (
                            <p className="mt-1 text-xs text-slate-500">{field.helpText}</p>
                        ) : null}
                        {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
                    </label>
                )}
            />
        );
    }

    return (
        <Controller
            name={field.key}
            control={control}
            render={({ field: f }) => (
                <label className="block" htmlFor={id}>
                    <span className="mb-1 block text-sm font-medium text-slate-700">
                        {field.label}
                        {field.required ? <span className="text-red-600"> *</span> : null}
                    </span>
                    <input
                        id={id}
                        type="text"
                        value={String(f.value ?? "")}
                        disabled={disabled}
                        placeholder={field.placeholder}
                        onChange={f.onChange}
                        className={inputClass}
                    />
                    {field.helpText ? <p className="mt-1 text-xs text-slate-500">{field.helpText}</p> : null}
                    {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
                </label>
            )}
        />
    );
}

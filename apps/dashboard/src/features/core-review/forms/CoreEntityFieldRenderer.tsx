"use client";

import { Controller, type Control, type FieldErrors } from "react-hook-form";

import { isStreetSurfacePreset, STREET_SURFACE_PRESETS } from "@/src/features/streets/streetSurfaces";
import type { CoreEntityFieldDef, CoreEntityFormMode } from "@/src/lib/core-review/entityConfigs/types";

import CoreRefDropdown from "./CoreRefDropdown";
import type { CoreRefLoadState } from "./useCoreEntityRefs";
import type { CoreRefSourceKind } from "@/src/lib/core-review/entityConfigs/types";

const inputClass =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-50";

export type CoreEntityFieldRendererProps = {
    field: CoreEntityFieldDef;
    mode: CoreEntityFormMode;
    control: Control<Record<string, unknown>>;
    errors: FieldErrors<Record<string, unknown>>;
    disabled?: boolean;
    refStates: Record<CoreRefSourceKind, CoreRefLoadState>;
};

function fieldError(errors: FieldErrors<Record<string, unknown>>, key: string): string | undefined {
    const err = errors[key];
    return typeof err?.message === "string" ? err.message : undefined;
}

export default function CoreEntityFieldRenderer({
    field,
    mode,
    control,
    errors,
    disabled,
    refStates,
}: CoreEntityFieldRendererProps) {
    if (field.createOnly && mode === "edit") return null;
    if (field.editOnly && mode === "create") return null;

    const error = fieldError(errors, field.key);
    const id = `core-field-${field.key}`;

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
                    />
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

"use client";

import AdminAreaCombobox from "@/src/components/admin-areas/AdminAreaCombobox";

import type { CoreRefLoadState } from "./useCoreEntityRefs";

export type CoreRefDropdownProps = {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    required?: boolean;
    disabled?: boolean;
    placeholder?: string;
    helpText?: string;
    error?: string;
    refSource: "admin-areas" | Exclude<string, "admin-areas">;
    refState?: CoreRefLoadState;
};

export default function CoreRefDropdown({
    id,
    label,
    value,
    onChange,
    required,
    disabled,
    placeholder = "Select…",
    helpText,
    error,
    refSource,
    refState,
}: CoreRefDropdownProps) {
    if (refSource === "admin-areas") {
        return (
            <label className="block" htmlFor={id}>
                <span className="mb-1 block text-sm font-medium text-slate-700">
                    {label}
                    {required ? <span className="text-red-600"> *</span> : null}
                </span>
                <AdminAreaCombobox
                    id={id}
                    value={value}
                    onChange={(id) => onChange(id ?? "")}
                    disabled={disabled}
                    placeholder="Search admin area…"
                />
                {helpText ? <p className="mt-1 text-xs text-slate-500">{helpText}</p> : null}
                {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
            </label>
        );
    }

    const isLoading = refState?.isLoading ?? false;
    const loadError = refState?.error ?? null;
    const options = refState?.options ?? [];

    return (
        <label className="block" htmlFor={id}>
            <span className="mb-1 block text-sm font-medium text-slate-700">
                {label}
                {required ? <span className="text-red-600"> *</span> : null}
            </span>
            {isLoading ? (
                <p className="mb-2 text-sm text-slate-500">Loading options…</p>
            ) : null}
            {loadError ? (
                <div className="mb-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {loadError}
                    <button
                        type="button"
                        className="ml-2 font-medium underline"
                        onClick={() => refState?.reload()}
                    >
                        Retry
                    </button>
                </div>
            ) : null}
            <select
                id={id}
                value={value}
                disabled={disabled || isLoading}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-50"
            >
                <option value="">{placeholder}</option>
                {options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
            {helpText ? <p className="mt-1 text-xs text-slate-500">{helpText}</p> : null}
            {error ? <p className="mt-1 text-sm text-red-600">{error}</p> : null}
        </label>
    );
}

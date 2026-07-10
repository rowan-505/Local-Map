"use client";

import { useEffect, useState } from "react";

import {
    SEARCH_ALIAS_LANGUAGE_OPTIONS,
    SEARCH_ALIAS_TYPES,
    aliasTypeLabel,
} from "./constants";
import SearchEntityPicker, { type SelectedSearchEntity } from "./SearchEntityPicker";
import type { SearchAliasItem } from "./types";
import { INPUT_CLASS, PRIMARY_BTN, SECONDARY_BTN, SELECT_CLASS } from "./ui";

export type SearchAliasFormValues = {
    entity: SelectedSearchEntity | null;
    alias_text: string;
    alias_type: string;
    language_code: string;
    source: string;
};

const EMPTY_FORM: SearchAliasFormValues = {
    entity: null,
    alias_text: "",
    alias_type: "common_name",
    language_code: "",
    source: "",
};

function toFormValues(item: SearchAliasItem): SearchAliasFormValues {
    return {
        entity: {
            entity_type: item.entity_type,
            entity_id: item.entity_id,
            display_name: item.indexed_entity?.display_name ?? item.alias_text,
            public_id: item.indexed_entity?.public_id ?? null,
        },
        alias_text: item.alias_text,
        alias_type: item.alias_type,
        language_code: item.language_code ?? "",
        source: item.source ?? "",
    };
}

export default function SearchAliasFormDialog({
    mode,
    initialItem,
    presetEntity,
    presetAliasText,
    presetLanguageCode,
    saving,
    error,
    onClose,
    onSubmit,
}: {
    mode: "create" | "edit";
    initialItem?: SearchAliasItem | null;
    presetEntity?: SelectedSearchEntity | null;
    presetAliasText?: string;
    presetLanguageCode?: string;
    saving: boolean;
    error: string;
    onClose: () => void;
    onSubmit: (values: SearchAliasFormValues) => void | Promise<void>;
}) {
    const [form, setForm] = useState<SearchAliasFormValues>(() => {
        if (initialItem) {
            return toFormValues(initialItem);
        }
        if (presetEntity || presetAliasText || presetLanguageCode) {
            return {
                ...EMPTY_FORM,
                entity: presetEntity ?? null,
                alias_text: presetAliasText ?? "",
                language_code: presetLanguageCode ?? "",
            };
        }
        return EMPTY_FORM;
    });

    useEffect(() => {
        if (initialItem) {
            setForm(toFormValues(initialItem));
        } else if (presetEntity || presetAliasText || presetLanguageCode) {
            setForm({
                ...EMPTY_FORM,
                entity: presetEntity ?? null,
                alias_text: presetAliasText ?? "",
                language_code: presetLanguageCode ?? "",
            });
        } else {
            setForm(EMPTY_FORM);
        }
    }, [initialItem, presetEntity, presetAliasText, presetLanguageCode]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
            <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="Close dialog"
                onClick={onClose}
            />
            <div className="relative z-10 w-full max-w-lg rounded-lg border border-gray-200 bg-white shadow-xl">
                <div className="border-b border-gray-200 px-5 py-4">
                    <h2 className="text-lg font-semibold text-gray-900">
                        {mode === "create" ? "Create search alias" : "Edit search alias"}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">
                        Aliases improve search matching only. Canonical entity names stay unchanged.
                    </p>
                </div>

                <form
                    className="space-y-4 px-5 py-4"
                    onSubmit={(e) => {
                        e.preventDefault();
                        void onSubmit(form);
                    }}
                >
                    <label className="block space-y-1 text-sm">
                        <span className="text-gray-700">Linked searchable entity</span>
                        <SearchEntityPicker
                            value={form.entity}
                            onChange={(entity) => setForm((prev) => ({ ...prev, entity }))}
                            disabled={mode === "edit"}
                            initialQuery={presetAliasText ?? ""}
                        />
                    </label>

                    <label className="block space-y-1 text-sm">
                        <span className="text-gray-700">Alias text</span>
                        <input
                            required
                            maxLength={500}
                            value={form.alias_text}
                            onChange={(e) =>
                                setForm((prev) => ({ ...prev, alias_text: e.target.value }))
                            }
                            className={INPUT_CLASS}
                            placeholder="e.g. RGN, Yangon Airport"
                        />
                    </label>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="block space-y-1 text-sm">
                            <span className="text-gray-700">Alias type</span>
                            <select
                                value={form.alias_type}
                                onChange={(e) =>
                                    setForm((prev) => ({ ...prev, alias_type: e.target.value }))
                                }
                                className={SELECT_CLASS}
                            >
                                {SEARCH_ALIAS_TYPES.map((type) => (
                                    <option key={type} value={type}>
                                        {aliasTypeLabel(type)}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="block space-y-1 text-sm">
                            <span className="text-gray-700">Language</span>
                            <select
                                value={form.language_code}
                                onChange={(e) =>
                                    setForm((prev) => ({ ...prev, language_code: e.target.value }))
                                }
                                className={SELECT_CLASS}
                            >
                                {SEARCH_ALIAS_LANGUAGE_OPTIONS.map((option) => (
                                    <option key={option.value || "any"} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <label className="block space-y-1 text-sm">
                        <span className="text-gray-700">Source (optional)</span>
                        <input
                            maxLength={120}
                            value={form.source}
                            onChange={(e) => setForm((prev) => ({ ...prev, source: e.target.value }))}
                            className={INPUT_CLASS}
                            placeholder="manual, import review, …"
                        />
                    </label>

                    {error ? (
                        <div className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                            {error}
                        </div>
                    ) : null}

                    <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                        <button type="button" className={SECONDARY_BTN} onClick={onClose} disabled={saving}>
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className={PRIMARY_BTN}
                            disabled={saving || (mode === "create" && !form.entity)}
                        >
                            {saving ? "Saving…" : mode === "create" ? "Create alias" : "Save changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

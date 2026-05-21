"use client";

import { useEffect, useMemo, useState } from "react";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";

import type { ImportReviewEntityConfig } from "../config/types";
import { overrideFieldDefsForEntity } from "../config/overrideFieldDefs";
import { useImportReviewReferenceOptions } from "../hooks/useImportReviewReferenceOptions";
import { IMPORT_REVIEW_SELECT_CLASS } from "../utils/entityPageUtils";
import { safeJson as formatStoredJson } from "../utils/detailDrawerUtils";
import {
    buildInitialOverrideForm,
    buildOverridePatch,
    validateOverrideForm,
    readImportedValue,
} from "../utils/overrideEditorUtils";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import { importReviewMessageTone } from "../utils/importReviewMessageTone";
import AdminAreaCombobox from "@/src/components/admin-areas/AdminAreaCombobox";

import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "./ImportReviewStatusBanner";

function optionLabel(opt: { id: string; code: string | null; name: string | null }): string {
    const code = opt.code?.trim();
    const name = opt.name?.trim();
    if (code && name) {
        return `${code} — ${name}`;
    }
    return code || name || opt.id;
}

export default function ImportReviewOverrideEditor({
    config,
    row,
    apiScope,
    canEdit,
    isSaving,
    saveMessage,
    onSave,
}: {
    config: ImportReviewEntityConfig;
    row: ImportReviewBuildingListItem;
    apiScope: ImportReviewScopeQueryParams | null;
    canEdit: boolean;
    isSaving: boolean;
    saveMessage: string | null;
    onSave: (patch: Record<string, unknown>, reviewNote: string | null) => Promise<void>;
}) {
    const fieldDefs = useMemo(() => overrideFieldDefsForEntity(config), [config]);
    const { bundle, isLoading: refsLoading, error: refsError } = useImportReviewReferenceOptions(
        fieldDefs.some((d) => d.type === "select")
    );

    const [form, setForm] = useState<Record<string, string>>(() => buildInitialOverrideForm(row, fieldDefs));
    const [baseline, setBaseline] = useState<Record<string, string>>(() => buildInitialOverrideForm(row, fieldDefs));
    const [clearedKeys, setClearedKeys] = useState<Set<string>>(() => new Set());
    const [overrideNote, setOverrideNote] = useState(row.review_note ?? "");
    const [validationError, setValidationError] = useState<string | null>(null);

    const promoted = (row.promotion_status ?? "").toLowerCase() === "promoted";

    useEffect(() => {
        const next = buildInitialOverrideForm(row, fieldDefs);
        setForm(next);
        setBaseline(next);
        setClearedKeys(new Set());
        setOverrideNote(row.review_note ?? "");
        setValidationError(null);
    }, [row.id, fieldDefs, row]);

    const isDirty = useMemo(() => {
        if (clearedKeys.size > 0) {
            return true;
        }
        for (const def of fieldDefs) {
            if ((form[def.configKey] ?? "") !== (baseline[def.configKey] ?? "")) {
                return true;
            }
        }
        return false;
    }, [form, baseline, clearedKeys, fieldDefs]);

    const handleReset = () => {
        setForm({ ...baseline });
        setClearedKeys(new Set());
        setValidationError(null);
    };

    const handleClearField = (configKey: string) => {
        setForm((prev) => ({ ...prev, [configKey]: "" }));
        setClearedKeys((prev) => new Set(prev).add(configKey));
    };

    const handleSave = async () => {
        if (!apiScope || promoted || !canEdit) {
            return;
        }
        const validation = validateOverrideForm(fieldDefs, form);
        if (validation) {
            setValidationError(validation);
            return;
        }
        setValidationError(null);
        const patch = buildOverridePatch({ defs: fieldDefs, form, baseline, clearedKeys });
        if (Object.keys(patch).length === 0) {
            setValidationError("No override changes to save.");
            return;
        }
        await onSave(patch, overrideNote.trim() === "" ? null : overrideNote.trim());
        setBaseline({ ...form });
        setClearedKeys(new Set());
    };

    if (fieldDefs.length === 0) {
        return null;
    }

    return (
        <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/30 p-4">
            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-900">Review overrides</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-violet-950/85">
                    PATCH <span className="font-mono">/overrides</span> merges into{" "}
                    <span className="font-mono">review_overrides</span> only — does not change imported source columns
                    or core tables.
                </p>
                {promoted ? (
                    <p className="mt-1 text-[11px] font-semibold text-red-800">
                        promotion_status=promoted — overrides are blocked.
                    </p>
                ) : null}
            </div>

            {refsLoading ? (
                <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingReferenceOptions} />
            ) : null}
            {refsError ? (
                <ImportReviewStatusBanner message={refsError} tone="error" compact />
            ) : null}
            {validationError ? (
                <ImportReviewStatusBanner message={validationError} tone="error" compact />
            ) : null}
            {isSaving ? (
                <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.savingOverrides} />
            ) : null}
            {saveMessage && !isSaving ? (
                <ImportReviewStatusBanner
                    message={saveMessage}
                    tone={importReviewMessageTone(saveMessage)}
                    compact
                />
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fieldDefs.map((def) => {
                    const imported = readImportedValue(row, def);
                    const value = form[def.configKey] ?? "";
                    const selectOptions =
                        def.refSource && def.type === "select"
                            ? (bundle[def.refSource] ?? [])
                            : [];

                    return (
                        <div key={def.configKey} className={def.type === "textarea" ? "sm:col-span-2" : ""}>
                            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                <span className="flex items-center justify-between gap-2">
                                    <span>{def.label}</span>
                                    <button
                                        type="button"
                                        className="text-[10px] font-normal text-violet-800 hover:underline"
                                        disabled={!canEdit || promoted || isSaving}
                                        onClick={() => handleClearField(def.configKey)}
                                    >
                                        Clear override
                                    </button>
                                </span>
                                {imported ? (
                                    <span className="text-[10px] font-normal text-gray-500">
                                        Imported: <span className="font-mono text-gray-700">{imported}</span>
                                    </span>
                                ) : null}
                                {def.type === "admin_area" ? (
                                    <AdminAreaCombobox
                                        value={value.trim() === "" ? null : value}
                                        disabled={!canEdit || promoted || isSaving}
                                        placeholder="Search admin area…"
                                        onChange={(id) => {
                                            setForm((prev) => ({
                                                ...prev,
                                                [def.configKey]: id ?? "",
                                            }));
                                            setClearedKeys((prev) => {
                                                const next = new Set(prev);
                                                next.delete(def.configKey);
                                                return next;
                                            });
                                        }}
                                    />
                                ) : def.type === "select" ? (
                                    <select
                                        value={value}
                                        disabled={!canEdit || promoted || isSaving || refsLoading}
                                        onChange={(e) => {
                                            setForm((prev) => ({ ...prev, [def.configKey]: e.target.value }));
                                            setClearedKeys((prev) => {
                                                const next = new Set(prev);
                                                next.delete(def.configKey);
                                                return next;
                                            });
                                        }}
                                        className={IMPORT_REVIEW_SELECT_CLASS}
                                    >
                                        <option value="">—</option>
                                        {selectOptions.map((opt) => (
                                            <option key={opt.id} value={opt.id}>
                                                {optionLabel(opt)}
                                            </option>
                                        ))}
                                    </select>
                                ) : def.type === "boolean" ? (
                                    <select
                                        value={value}
                                        disabled={!canEdit || promoted || isSaving}
                                        onChange={(e) => {
                                            setForm((prev) => ({ ...prev, [def.configKey]: e.target.value }));
                                            setClearedKeys((prev) => {
                                                const next = new Set(prev);
                                                next.delete(def.configKey);
                                                return next;
                                            });
                                        }}
                                        className={IMPORT_REVIEW_SELECT_CLASS}
                                    >
                                        <option value="">—</option>
                                        <option value="true">true</option>
                                        <option value="false">false</option>
                                    </select>
                                ) : def.type === "textarea" ? (
                                    <textarea
                                        value={value}
                                        rows={3}
                                        disabled={!canEdit || promoted || isSaving}
                                        onChange={(e) => {
                                            setForm((prev) => ({ ...prev, [def.configKey]: e.target.value }));
                                            setClearedKeys((prev) => {
                                                const next = new Set(prev);
                                                next.delete(def.configKey);
                                                return next;
                                            });
                                        }}
                                        className={IMPORT_REVIEW_SELECT_CLASS}
                                    />
                                ) : (
                                    <input
                                        type={def.type === "number" ? "number" : "text"}
                                        value={value}
                                        disabled={!canEdit || promoted || isSaving}
                                        onChange={(e) => {
                                            setForm((prev) => ({ ...prev, [def.configKey]: e.target.value }));
                                            setClearedKeys((prev) => {
                                                const next = new Set(prev);
                                                next.delete(def.configKey);
                                                return next;
                                            });
                                        }}
                                        className={IMPORT_REVIEW_SELECT_CLASS}
                                        autoComplete="off"
                                    />
                                )}
                            </label>
                        </div>
                    );
                })}
            </div>

            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                review_note (optional, saved with overrides)
                <textarea
                    value={overrideNote}
                    disabled={!canEdit || promoted || isSaving}
                    onChange={(e) => setOverrideNote(e.target.value)}
                    rows={2}
                    className={IMPORT_REVIEW_SELECT_CLASS}
                />
            </label>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    disabled={!isDirty || isSaving || !canEdit || promoted}
                    onClick={handleReset}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                >
                    Reset unsaved changes
                </button>
                <button
                    type="button"
                    disabled={isSaving || !canEdit || promoted || !apiScope}
                    onClick={() => void handleSave()}
                    className="rounded-lg bg-violet-900 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                >
                    {isSaving ? "Saving overrides…" : "Save overrides"}
                </button>
            </div>

            <details className="rounded-lg border border-gray-200 bg-white/80">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
                    Stored review_overrides (server JSON)
                </summary>
                <pre className="max-h-40 overflow-auto border-t border-gray-100 p-3 text-[11px]">
                    {formatStoredJson(row.review_overrides)}
                </pre>
            </details>
        </section>
    );
}

"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";

import type { ImportReviewEntityConfig } from "../config/types";
import {
    groupOverrideFieldDefs,
    overrideFieldDefsForEntity,
    type ImportReviewOverrideFieldDef,
} from "../config/overrideFieldDefs";
import { isFieldEssentialForEntity, labelWithEssentialMarker } from "../config/essentialFields";
import type { ImportReviewFormOptionsBundle } from "../hooks/useImportReviewFormOptions";
import { IMPORT_REVIEW_SELECT_CLASS } from "../utils/entityPageUtils";
import {
    fieldUsesSelectOptions,
    formOptionsKeyForField,
    selectOptionsForField,
    selectOptionsWithCurrentValue,
    toAdminAreaComboboxOptions,
} from "../utils/formOptionsUtils";
import { safeJson as formatStoredJson } from "../utils/detailDrawerUtils";
import {
    asOverrideRecord,
    buildInitialOverrideForm,
    buildOverridePatch,
    validateOverrideForm,
    readImportedValue,
} from "../utils/overrideEditorUtils";
import { deriveImportedClassCode } from "../utils/importReviewClassificationFields";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import { importReviewMessageTone } from "../utils/importReviewMessageTone";
import AdminAreaCombobox from "@/src/components/admin-areas/AdminAreaCombobox";

import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "./ImportReviewStatusBanner";

function OverrideFieldGrid({
    config,
    row,
    defs,
    form,
    canEdit,
    promoted,
    isSaving,
    optionsLoading,
    formOptions,
    onFormChange,
    onClearField,
}: {
    config: ImportReviewEntityConfig;
    row: ImportReviewBuildingListItem;
    defs: ImportReviewOverrideFieldDef[];
    form: Record<string, string>;
    canEdit: boolean;
    promoted: boolean;
    isSaving: boolean;
    optionsLoading: boolean;
    formOptions: ImportReviewFormOptionsBundle | null;
    onFormChange: (configKey: string, value: string) => void;
    onClearField: (configKey: string) => void;
}) {
    const adminAreaOptions = useMemo(() => toAdminAreaComboboxOptions(formOptions), [formOptions]);

    if (defs.length === 0) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {defs.map((def) => {
                const importedForPatch = readImportedValue(row, def, config.apiFamily);
                const importedDisplay =
                    def.patchKey === "landuse_class_id" && config.apiFamily === "landuse"
                        ? (deriveImportedClassCode(row, config.apiFamily) ?? "")
                        : importedForPatch;
                const importedLabel =
                    def.patchKey === "landuse_class_id" && config.apiFamily === "landuse"
                        ? "Imported class:"
                        : "Imported:";
                const value = form[def.configKey] ?? "";
                const essential = isFieldEssentialForEntity(config, def.configKey);
                const usesSelect = fieldUsesSelectOptions(config, def);
                const optionKey = formOptionsKeyForField(config, def);
                const selectOptions = selectOptionsWithCurrentValue(
                    selectOptionsForField(formOptions, optionKey),
                    value
                );
                const disabled = !canEdit || promoted || isSaving;

                return (
                    <div key={def.configKey} className={def.type === "textarea" ? "sm:col-span-2" : ""}>
                        <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                            <span className="flex items-center justify-between gap-2">
                                <span>{labelWithEssentialMarker(def.label, essential)}</span>
                                <button
                                    type="button"
                                    className="text-[10px] font-normal text-violet-800 hover:underline"
                                    disabled={disabled}
                                    onClick={() => onClearField(def.configKey)}
                                >
                                    Clear override
                                </button>
                            </span>
                            {def.helperText ? (
                                <span className="text-[10px] font-normal text-gray-500">{def.helperText}</span>
                            ) : null}
                            {importedDisplay ? (
                                <span className="text-[10px] font-normal text-gray-500">
                                    {importedLabel}{" "}
                                    <span className="font-mono text-gray-700">{importedDisplay}</span>
                                </span>
                            ) : null}
                            {def.type === "admin_area" ? (
                                <AdminAreaCombobox
                                    value={value.trim() === "" ? null : value}
                                    disabled={disabled || optionsLoading}
                                    placeholder="Search admin area…"
                                    options={adminAreaOptions.length > 0 ? adminAreaOptions : undefined}
                                    optionsLoading={optionsLoading}
                                    onChange={(id) => onFormChange(def.configKey, id ?? "")}
                                />
                            ) : usesSelect ? (
                                <select
                                    value={value}
                                    disabled={disabled || optionsLoading}
                                    onChange={(e) => onFormChange(def.configKey, e.target.value)}
                                    className={IMPORT_REVIEW_SELECT_CLASS}
                                >
                                    <option value="">—</option>
                                    {selectOptions.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            ) : def.type === "boolean" ? (
                                <select
                                    value={value}
                                    disabled={disabled}
                                    onChange={(e) => onFormChange(def.configKey, e.target.value)}
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
                                    disabled={disabled}
                                    onChange={(e) => onFormChange(def.configKey, e.target.value)}
                                    className={IMPORT_REVIEW_SELECT_CLASS}
                                />
                            ) : (
                                <input
                                    type={def.type === "number" ? "number" : "text"}
                                    value={value}
                                    disabled={disabled}
                                    onChange={(e) => onFormChange(def.configKey, e.target.value)}
                                    className={IMPORT_REVIEW_SELECT_CLASS}
                                    autoComplete="off"
                                    placeholder={
                                        def.section === "names"
                                            ? def.configKey === "name_mm"
                                                ? "Myanmar label (optional)"
                                                : "English label (optional)"
                                            : undefined
                                    }
                                />
                            )}
                        </label>
                    </div>
                );
            })}
        </div>
    );
}

function OverrideFormSection({
    title,
    description,
    children,
}: {
    title: string;
    description?: string;
    children: ReactNode;
}) {
    return (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white/90 p-3">
            <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-800">{title}</h4>
                {description ? (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">{description}</p>
                ) : null}
            </div>
            {children}
        </section>
    );
}

export default function ImportReviewOverrideEditor({
    config,
    row,
    apiScope,
    canEdit,
    isSaving,
    saveMessage,
    formOptions,
    formOptionsLoading = false,
    formOptionsError = "",
    onSave,
}: {
    config: ImportReviewEntityConfig;
    row: ImportReviewBuildingListItem;
    apiScope: ImportReviewScopeQueryParams | null;
    canEdit: boolean;
    isSaving: boolean;
    saveMessage: string | null;
    formOptions: ImportReviewFormOptionsBundle | null;
    formOptionsLoading?: boolean;
    formOptionsError?: string;
    onSave: (patch: Record<string, unknown>, reviewNote: string | null) => Promise<void>;
}) {
    const fieldDefs = useMemo(() => overrideFieldDefsForEntity(config), [config]);
    const { names, classification, address } = useMemo(
        () => groupOverrideFieldDefs(fieldDefs),
        [fieldDefs]
    );

    const [form, setForm] = useState<Record<string, string>>(() => buildInitialOverrideForm(row, fieldDefs));
    const [baseline, setBaseline] = useState<Record<string, string>>(() => buildInitialOverrideForm(row, fieldDefs));
    const [clearedKeys, setClearedKeys] = useState<Set<string>>(() => new Set());
    const [overrideNote, setOverrideNote] = useState(row.review_note ?? "");
    const [validationError, setValidationError] = useState<string | null>(null);

    const promoted = (row.promotion_status ?? "").toLowerCase() === "promoted";

    useEffect(() => {
        const next = buildInitialOverrideForm(row, fieldDefs, config.apiFamily);
        setForm(next);
        setBaseline(next);
        setClearedKeys(new Set());
        setOverrideNote(row.review_note ?? "");
        setValidationError(null);
    }, [row.id, fieldDefs, row, config.apiFamily]);

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

    const handleFormChange = (configKey: string, value: string) => {
        setForm((prev) => ({ ...prev, [configKey]: value }));
        setClearedKeys((prev) => {
            const next = new Set(prev);
            next.delete(configKey);
            return next;
        });
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
        const patch = buildOverridePatch({
            defs: fieldDefs,
            form,
            row,
            clearedKeys,
            apiFamily: config.apiFamily,
        });
        const hasStoredOverrides = Object.keys(asOverrideRecord(row.review_overrides)).length > 0;
        if (Object.keys(patch).length === 0 && !(hasStoredOverrides && clearedKeys.size > 0)) {
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

    const sharedGridProps = {
        config,
        row,
        form,
        canEdit,
        promoted,
        isSaving,
        optionsLoading: formOptionsLoading,
        formOptions,
        onFormChange: handleFormChange,
        onClearField: handleClearField,
    };

    return (
        <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/30 p-4">
            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-900">Review overrides</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-violet-950/85">
                    Names (<span className="font-mono">name_mm</span> / <span className="font-mono">name_en</span>) are
                    separate from class/type fields. PATCH merges into{" "}
                    <span className="font-mono">review_overrides</span> only — imported source columns are unchanged.
                </p>
                {promoted ? (
                    <p className="mt-1 text-[11px] font-semibold text-red-800">
                        promotion_status=promoted — overrides are blocked.
                    </p>
                ) : null}
            </div>

            {formOptionsLoading ? (
                <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingReferenceOptions} />
            ) : null}
            {formOptionsError ? <ImportReviewStatusBanner message={formOptionsError} tone="error" compact /> : null}
            {validationError ? (
                <ImportReviewStatusBanner message={validationError} tone="error" compact />
            ) : null}
            {isSaving ? <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.savingOverrides} /> : null}
            {saveMessage && !isSaving ? (
                <ImportReviewStatusBanner
                    message={saveMessage}
                    tone={importReviewMessageTone(saveMessage)}
                    compact
                />
            ) : null}

            <div className="space-y-3">
                {names.length > 0 ? (
                    <OverrideFormSection
                        title="Names"
                        description="Reviewer-facing labels only. Empty is allowed unless marked required (*)."
                    >
                        <OverrideFieldGrid defs={names} {...sharedGridProps} />
                    </OverrideFormSection>
                ) : null}

                {classification.length > 0 ? (
                    <OverrideFormSection
                        title="Classification & attributes"
                        description="Type/class codes and reference IDs — not used as display names."
                    >
                        <OverrideFieldGrid defs={classification} {...sharedGridProps} />
                    </OverrideFormSection>
                ) : null}

                {address.length > 0 ? (
                    <OverrideFormSection
                        title="Address fields"
                        description="Structured address components stored in review_overrides."
                    >
                        <OverrideFieldGrid defs={address} {...sharedGridProps} />
                    </OverrideFormSection>
                ) : null}
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

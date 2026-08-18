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
    buildingTypeSelectOptionsForRow,
    fieldUsesSelectOptions,
    formOptionsKeyForField,
    includeCurrentAdminAreaOption,
    poiCategoryOptionsFromFormOptions,
    resolveDirectEditReferenceFormValue,
    resolveOptionValueFromSource,
    selectOptionsForField,
    selectOptionsWithCurrentValue,
    toAdminAreaComboboxOptions,
} from "../utils/formOptionsUtils";
import PoiCategoryCombobox from "@/src/components/poi-categories/PoiCategoryCombobox";
import { formatImportReviewBuildingTypeLabel } from "@/src/lib/building-type/display";
import { safeJson as formatStoredJson } from "../utils/detailDrawerUtils";
import {
    buildInitialDirectEditForm,
    buildColumnPatch,
    validateOverrideForm,
    readImportedValue,
    isDirectEditPrefilledFromSource,
    columnValuePresent,
} from "../utils/overrideEditorUtils";
import { deriveImportedClassCode } from "../utils/importReviewClassificationFields";
import { getImportReviewSourceImportedName } from "../utils/importReviewNaming";
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
    prefilledFromSourceKeys,
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
    prefilledFromSourceKeys: Set<string>;
    canEdit: boolean;
    promoted: boolean;
    isSaving: boolean;
    optionsLoading: boolean;
    formOptions: ImportReviewFormOptionsBundle | null;
    onFormChange: (configKey: string, value: string) => void;
    onClearField: (configKey: string) => void;
}) {
    const adminAreaOptions = useMemo(
        () => includeCurrentAdminAreaOption(toAdminAreaComboboxOptions(formOptions), form.admin_area_id ?? null),
        [formOptions, form.admin_area_id]
    );
    const poiCategoryOptions = useMemo(
        () => poiCategoryOptionsFromFormOptions(formOptions, form.category_id),
        [formOptions, form.category_id]
    );

    if (defs.length === 0) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {defs.map((def) => {
                const isNameField = def.patchKey === "name_mm" || def.patchKey === "name_en";
                const sourceImportedName = isNameField ? getImportReviewSourceImportedName(row) : null;
                const importedForPatch = readImportedValue(row, def, config.apiFamily);
                const importedDisplay =
                    def.configKey === "building_type_id"
                        ? formatImportReviewBuildingTypeLabel(row)
                        : def.patchKey === "land_area_class_id" && config.apiFamily === "land_areas"
                          ? (deriveImportedClassCode(row, config.apiFamily) ?? "")
                          : isNameField
                            ? (sourceImportedName ?? "")
                            : importedForPatch;
                const importedLabel =
                    def.patchKey === "land_area_class_id" && config.apiFamily === "land_areas"
                        ? "Imported class:"
                        : isNameField
                          ? "Imported/source name:"
                          : "Imported:";
                const value = form[def.configKey] ?? "";
                const prefilledFromSource = prefilledFromSourceKeys.has(def.configKey);
                const showImportedHint =
                    Boolean(importedDisplay) &&
                    !prefilledFromSource &&
                    value.trim() === "" &&
                    (!isNameField || def.patchKey === "name_en");
                const essential = isFieldEssentialForEntity(config, def.configKey);
                const usesSelect = fieldUsesSelectOptions(config, def);
                const optionKey = formOptionsKeyForField(config, def);
                const selectOptions =
                    def.configKey === "building_type_id"
                        ? buildingTypeSelectOptionsForRow(formOptions, row)
                        : selectOptionsWithCurrentValue(
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
                                    Clear field
                                </button>
                            </span>
                            {def.helperText ? (
                                <span className="text-[10px] font-normal text-gray-500">{def.helperText}</span>
                            ) : null}
                            {prefilledFromSource ? (
                                <span className="text-[10px] font-normal text-violet-800">
                                    Prefilled from source
                                </span>
                            ) : null}
                            {showImportedHint ? (
                                <span className="text-[10px] font-normal text-gray-500">
                                    {importedLabel}{" "}
                                    <span className="font-mono text-gray-700">{importedDisplay}</span>
                                </span>
                            ) : null}
                            {def.type === "admin_area" ? (
                                <AdminAreaCombobox
                                    value={value.trim() === "" ? null : value}
                                    disabled={disabled || optionsLoading}
                                    placeholder={
                                        config.apiFamily === "roads"
                                            ? "Auto-assigned on promotion if empty"
                                            : "Search admin area…"
                                    }
                                    options={adminAreaOptions.length > 0 ? adminAreaOptions : undefined}
                                    optionsLoading={optionsLoading}
                                    onChange={(id) => onFormChange(def.configKey, id ?? "")}
                                />
                            ) : def.refSource === "ref_poi_categories" ? (
                                <PoiCategoryCombobox
                                    value={value}
                                    disabled={disabled || optionsLoading}
                                    optionsLoading={optionsLoading}
                                    options={poiCategoryOptions}
                                    onChange={(id) => onFormChange(def.configKey, id)}
                                    emptyOptionLabel="No category"
                                />
                            ) : usesSelect ? (
                                <select
                                    value={value}
                                    disabled={disabled || optionsLoading}
                                    onChange={(e) => onFormChange(def.configKey, e.target.value)}
                                    className={IMPORT_REVIEW_SELECT_CLASS}
                                >
                                    <option value="">
                                        {config.apiFamily === "roads" && def.configKey === "road_class_id"
                                            ? "Optional; falls back to source class if empty"
                                            : "—"}
                                    </option>
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
    saveTechnicalError = "",
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
    saveTechnicalError?: string | null;
    formOptions: ImportReviewFormOptionsBundle | null;
    formOptionsLoading?: boolean;
    formOptionsError?: string;
    onSave: (
        patch: Record<string, unknown>,
        reviewNote: string | null,
        saveOptions?: {
            verifyPatchKeys?: readonly string[];
            referenceFieldsDevLog?: Record<string, unknown>;
        }
    ) => Promise<ImportReviewBuildingListItem>;
}) {
    const fieldDefs = useMemo(() => overrideFieldDefsForEntity(config), [config]);
    const { names, classification, address } = useMemo(
        () => groupOverrideFieldDefs(fieldDefs),
        [fieldDefs]
    );

    const rowResetKey = `${row.id}:${config.apiFamily}`;
    const [lastRowResetKey, setLastRowResetKey] = useState(rowResetKey);
    const [form, setForm] = useState<Record<string, string>>(() =>
        buildInitialDirectEditForm(row, fieldDefs, config.apiFamily).form,
    );
    const [baseline, setBaseline] = useState<Record<string, string>>(() =>
        buildInitialDirectEditForm(row, fieldDefs, config.apiFamily).form,
    );
    const [prefilledFromSourceKeys, setPrefilledFromSourceKeys] = useState<Set<string>>(
        () => buildInitialDirectEditForm(row, fieldDefs, config.apiFamily).prefilledFromSourceKeys
    );
    const [clearedKeys, setClearedKeys] = useState<Set<string>>(() => new Set());
    const [userEditedConfigKeys, setUserEditedConfigKeys] = useState<Set<string>>(() => new Set());
    const [overrideNote, setOverrideNote] = useState(row.review_note ?? "");
    const [validationError, setValidationError] = useState<string | null>(null);

    const confirmRequiredClear = () => {
        const requiredClears = fieldDefs.filter(
            (def) =>
                clearedKeys.has(def.configKey) &&
                isFieldEssentialForEntity(config, def.configKey)
        );
        if (requiredClears.length === 0) {
            return true;
        }
        const labels = requiredClears.map((def) => def.label).join(", ");
        return window.confirm(
            `You are clearing required field(s): ${labels}. Continue with save?`
        );
    };

    if (lastRowResetKey !== rowResetKey) {
        const nextState = buildInitialDirectEditForm(row, fieldDefs, config.apiFamily);
        setLastRowResetKey(rowResetKey);
        setForm(nextState.form);
        setBaseline(nextState.form);
        setPrefilledFromSourceKeys(nextState.prefilledFromSourceKeys);
        setClearedKeys(new Set());
        setUserEditedConfigKeys(new Set());
        setOverrideNote(row.review_note ?? "");
        setValidationError(null);
    }

    const promoted = (row.promotion_status ?? "").toLowerCase() === "promoted";

    const poiCategoryOptions = useMemo(
        () => poiCategoryOptionsFromFormOptions(formOptions, form.category_id),
        [formOptions, form.category_id]
    );

    useEffect(() => {
        if (!formOptions) {
            return;
        }
        const updates: Record<string, string> = {};
        for (const def of fieldDefs) {
            const configKey = def.configKey;
            const current = (form[configKey] ?? "").trim();
            const imported = readImportedValue(row, def, config.apiFamily).trim();
            const sourceForResolve = current || imported;
            if (!sourceForResolve) {
                continue;
            }
            if (current && /^\d+$/.test(current)) {
                continue;
            }

            if (def.configKey === "land_area_class_id") {
                const options = (formOptions.land_area_classes ?? []).map((opt) => ({
                    value: String(opt.value),
                    label: opt.label,
                    code: opt.code ?? null,
                }));
                const resolved = resolveDirectEditReferenceFormValue(sourceForResolve, options);
                if (resolved) {
                    updates[configKey] = resolved;
                }
                continue;
            }
            if (def.configKey === "barrier_type") {
                const options = (formOptions.barrier_types ?? []).map((opt) => ({
                    value: String(opt.value),
                    label: opt.label,
                    code: opt.code ?? null,
                }));
                const resolved = resolveDirectEditReferenceFormValue(sourceForResolve, options);
                if (resolved) {
                    updates[configKey] = resolved;
                }
                continue;
            }
            if (def.refSource === "ref_poi_categories") {
                const options = poiCategoryOptions.map((opt) => ({
                    value: opt.value,
                    label: opt.label,
                    code: opt.code ?? null,
                }));
                const resolved = resolveDirectEditReferenceFormValue(sourceForResolve, options);
                if (resolved) {
                    updates[configKey] = resolved;
                }
                continue;
            }
            if (def.refSource === "ref_road_classes") {
                const options = (formOptions.road_classes ?? []).map((opt) => ({
                    value: String(opt.value),
                    label: opt.label,
                    code: opt.code ?? null,
                }));
                const resolved = resolveDirectEditReferenceFormValue(sourceForResolve, options);
                if (resolved) {
                    updates[configKey] = resolved;
                }
                continue;
            }
            if (def.refSource === "ref_building_types") {
                const options = (formOptions.building_types ?? []).map((opt) => ({
                    value: String(opt.value),
                    label: opt.label,
                    code: opt.code ?? null,
                }));
                const resolved = resolveDirectEditReferenceFormValue(sourceForResolve, options);
                if (resolved) {
                    updates[configKey] = resolved;
                }
                continue;
            }
            if (def.refSource === "ref_admin_levels") {
                const options = (formOptions.admin_levels ?? []).map((opt) => ({
                    value: String(opt.value),
                    label: opt.label,
                    code: opt.code ?? null,
                }));
                const resolved = resolveDirectEditReferenceFormValue(sourceForResolve, options);
                if (resolved) {
                    updates[configKey] = resolved;
                }
                continue;
            }
        }
        const keys = Object.keys(updates);
        if (keys.length === 0) {
            return;
        }
        setForm((prev) => ({ ...prev, ...updates }));
        setBaseline((prev) => ({ ...prev, ...updates }));
        setPrefilledFromSourceKeys((prev) => {
            const next = new Set(prev);
            for (const key of keys) {
                next.add(key);
            }
            return next;
        });
    }, [formOptions, fieldDefs, row, config.apiFamily, form, poiCategoryOptions]);

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
    const saveState = isSaving
        ? "saving"
        : saveMessage && importReviewMessageTone(saveMessage) === "success"
          ? "saved"
          : saveMessage && importReviewMessageTone(saveMessage) === "error"
            ? "failed"
            : isDirty
              ? "unsaved"
              : "idle";

    const handleReset = () => {
        setForm({ ...baseline });
        setClearedKeys(new Set());
        setValidationError(null);
    };

    const handleClearField = (configKey: string) => {
        setForm((prev) => ({ ...prev, [configKey]: "" }));
        setClearedKeys((prev) => new Set(prev).add(configKey));
        setUserEditedConfigKeys((prev) => new Set(prev).add(configKey));
        setPrefilledFromSourceKeys((prev) => {
            const next = new Set(prev);
            next.delete(configKey);
            return next;
        });
    };

    const handleFormChange = (configKey: string, value: string) => {
        setForm((prev) => ({ ...prev, [configKey]: value }));
        setUserEditedConfigKeys((prev) => {
            const next = new Set(prev);
            next.add(configKey);
            return next;
        });
        setClearedKeys((prev) => {
            const next = new Set(prev);
            next.delete(configKey);
            return next;
        });
        const def = fieldDefs.find((d) => d.configKey === configKey);
        if (def) {
            setPrefilledFromSourceKeys((prev) => {
                const next = new Set(prev);
                if (isDirectEditPrefilledFromSource(row, def, config.apiFamily, value)) {
                    next.add(configKey);
                } else {
                    next.delete(configKey);
                }
                return next;
            });
        }
    };

    const handleSave = async () => {
        if (!apiScope || promoted || !canEdit) {
            return;
        }
        const validation = validateOverrideForm(fieldDefs, form, config.apiFamily);
        if (validation) {
            setValidationError(validation);
            return;
        }
        if (!confirmRequiredClear()) {
            return;
        }
        setValidationError(null);
        const { patch, changedPatchKeys } = buildColumnPatch({
            defs: fieldDefs,
            form,
            row,
            clearedKeys,
            userEditedConfigKeys,
            apiFamily: config.apiFamily,
        });
        const hasColumnValues = fieldDefs.some((def) => columnValuePresent(row, def, config.apiFamily));
        if (Object.keys(patch).length === 0 && !(hasColumnValues && clearedKeys.size > 0)) {
            setValidationError("No changes to save.");
            return;
        }

        const categoryDef = fieldDefs.find((def) => def.patchKey === "category_id");
        const categoryFormValue = categoryDef ? (form[categoryDef.configKey] ?? "").trim() : "";
        const categorySelectedOption =
            categoryFormValue === ""
                ? null
                : (poiCategoryOptions.find(
                      (opt) => opt.value === categoryFormValue || opt.id === categoryFormValue
                  ) ?? null);
        const referenceFieldsDevLog =
            process.env.NODE_ENV === "development"
                ? {
                      category_id: {
                          changedFieldsCategoryId: Object.prototype.hasOwnProperty.call(
                              patch,
                              "category_id"
                          )
                              ? patch.category_id
                              : undefined,
                          changedPatchKeys: [...changedPatchKeys],
                          formValue: categoryFormValue || null,
                          selectedOption: categorySelectedOption,
                      },
                  }
                : undefined;

        try {
            const updated = await onSave(
                patch,
                overrideNote.trim() === "" ? null : overrideNote.trim(),
                {
                    verifyPatchKeys: [...changedPatchKeys],
                    referenceFieldsDevLog,
                }
            );
            const nextState = buildInitialDirectEditForm(updated, fieldDefs, config.apiFamily);
            setForm(nextState.form);
            setBaseline(nextState.form);
            setPrefilledFromSourceKeys(nextState.prefilledFromSourceKeys);
            setClearedKeys(new Set());
            setUserEditedConfigKeys(new Set());
            setOverrideNote(updated.review_note ?? "");
            setValidationError(null);
        } catch {
            // Parent sets overrideSaveMessage / technical error; keep unsaved draft in form.
        }
    };

    if (fieldDefs.length === 0) {
        return null;
    }

    const sharedGridProps = {
        config,
        row,
        form,
        prefilledFromSourceKeys,
        canEdit,
        promoted,
        isSaving,
        optionsLoading: formOptionsLoading,
        formOptions,
        onFormChange: handleFormChange,
        onClearField: handleClearField,
    };

    const showRoadOptionalFieldsNote =
        config.apiFamily === "roads" &&
        (!(form.admin_area_id ?? "").trim() || !(form.road_class_id ?? "").trim());

    return (
        <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/30 p-4">
            <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-900">Direct edit candidate</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-violet-950/85">Updates typed candidate columns on save.</p>
                {promoted ? (
                    <p className="mt-1 text-[11px] font-semibold text-red-800">
                        promotion_status=promoted — edits are blocked.
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
            {saveState === "unsaved" ? (
                <ImportReviewStatusBanner message="Unsaved changes." tone="info" compact />
            ) : null}
            {saveState === "saving" ? (
                <ImportReviewStatusBanner message="Saving..." tone="info" compact />
            ) : null}
            {saveState === "saved" ? (
                <ImportReviewStatusBanner message="Saved changes." tone="success" compact />
            ) : null}
            {saveState === "failed" ? (
                <ImportReviewStatusBanner
                    message={saveMessage?.trim() || "Save failed."}
                    tone="error"
                    compact
                />
            ) : null}
            {saveState === "failed" && saveTechnicalError?.trim() ? (
                <details className="rounded-md border border-amber-100 bg-amber-50/80 p-2">
                    <summary className="cursor-pointer text-[11px] font-semibold text-amber-900">
                        Technical details (dev)
                    </summary>
                    <pre className="mt-1 max-h-28 overflow-auto text-[10px] text-amber-950 whitespace-pre-wrap">
                        {saveTechnicalError}
                    </pre>
                </details>
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
                        {showRoadOptionalFieldsNote ? (
                            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                                Missing admin area or road class will be auto-derived during promotion when
                                possible.
                            </div>
                        ) : null}
                    </OverrideFormSection>
                ) : null}

                {address.length > 0 ? (
                    <OverrideFormSection
                        title="Address fields"
                        description="Structured address components stored on the candidate row."
                    >
                        <OverrideFieldGrid defs={address} {...sharedGridProps} />
                    </OverrideFormSection>
                ) : null}
            </div>

            <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                review_note (optional, saved with changes)
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
                    {isSaving ? "Saving…" : "Save Changes"}
                </button>
            </div>

            <details className="rounded-lg border border-gray-200 bg-white/80">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
                    Source data available
                </summary>
                <div className="space-y-2 border-t border-gray-100 p-3">
                    <p className="text-[10px] font-semibold uppercase text-gray-500">normalized_data</p>
                    <pre className="max-h-32 overflow-auto text-[11px]">
                        {formatStoredJson(row.normalized_data)}
                    </pre>
                    <p className="text-[10px] font-semibold uppercase text-gray-500">source_refs</p>
                    <pre className="max-h-32 overflow-auto text-[11px]">{formatStoredJson(row.source_refs)}</pre>
                </div>
            </details>
        </section>
    );
}

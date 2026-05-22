"use client";

import { useEffect, useRef, useState } from "react";
import { Controller, type Control, type FieldErrors, type UseFormSetValue } from "react-hook-form";

import {
    getRefAddressUsageTypes,
    getRefBoundaryStatuses,
    isAbortError,
    type RefAddressUsageType,
    type RefBoundaryStatus,
} from "@/src/lib/api";
import type { CoreEntityFormMode } from "@/src/lib/core-review/entityConfigs/types";
import type { CoreEntityFormValues } from "@/src/lib/core-review/entityConfigs/types";

import {
    applyBoundaryStatusRefDefaults,
    applyBoundaryStatusRefDefaultsAll,
    defaultBoundaryStatusCodeForAdminLevel,
    OFFICIAL_BOUNDARY_STATUS_CODE,
    SETTLEMENT_EXTENT_BOUNDARY_STATUS_CODE,
    VILLAGE_ADMIN_LEVEL_CODE,
    VILLAGE_BOUNDARY_CAUTION_TITLE,
    VILLAGE_OFFICIAL_BOUNDARY_WARNING,
    villageBoundaryCautionText,
    type BoundaryDependentDirtyFlags,
} from "./adminAreaBoundaryDefaults";

const SETTLEMENT_EXTENT_WARNING =
    "This is the visible built-up settlement area only. It is useful for search and approximate address locality, but it is not an official boundary.";

const inputClass =
    "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-50";

function refLabel(nameEn: string, nameMm: string | null | undefined, code: string): string {
    return `${nameEn} — ${nameMm?.trim() || code}`;
}

export type AdminAreaBoundaryFieldsProps = {
    mode: CoreEntityFormMode;
    adminLevelCode: string;
    control: Control<CoreEntityFormValues>;
    errors: FieldErrors<CoreEntityFormValues>;
    disabled?: boolean;
    /** Reset manual-change tracking when detail reloads. */
    resetKey?: string;
    boundaryStatus: string;
    addressUsage: string;
    setValue: UseFormSetValue<CoreEntityFormValues>;
};

function fieldError(errors: FieldErrors<CoreEntityFormValues>, key: string): string | undefined {
    const err = errors[key];
    return typeof err?.message === "string" ? err.message : undefined;
}

export default function AdminAreaBoundaryFields({
    mode,
    adminLevelCode,
    control,
    errors,
    disabled,
    resetKey,
    boundaryStatus,
    addressUsage,
    setValue,
}: AdminAreaBoundaryFieldsProps) {
    const [boundaryStatuses, setBoundaryStatuses] = useState<RefBoundaryStatus[]>([]);
    const [addressUsageTypes, setAddressUsageTypes] = useState<RefAddressUsageType[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const boundaryFieldsTouched = useRef(false);
    const dependentDirty = useRef<BoundaryDependentDirtyFlags>({
        isOfficialBoundary: false,
        boundaryConfidenceScore: false,
        addressUsage: false,
    });
    const lastAutoAdminLevelCode = useRef<string | null>(null);

    const normalizedAdminLevelCode = adminLevelCode.trim().toLowerCase();
    const isVillageAdminLevel = normalizedAdminLevelCode === VILLAGE_ADMIN_LEVEL_CODE;

    const markBoundaryFieldsTouched = () => {
        boundaryFieldsTouched.current = true;
    };

    useEffect(() => {
        boundaryFieldsTouched.current = false;
        dependentDirty.current = {
            isOfficialBoundary: false,
            boundaryConfidenceScore: false,
            addressUsage: false,
        };
        lastAutoAdminLevelCode.current = null;
    }, [resetKey]);

    useEffect(() => {
        const controller = new AbortController();
        setIsLoading(true);
        setLoadError(null);
        Promise.all([
            getRefBoundaryStatuses({ signal: controller.signal }),
            getRefAddressUsageTypes({ signal: controller.signal }),
        ])
            .then(([statuses, usages]) => {
                setBoundaryStatuses(statuses);
                setAddressUsageTypes(usages);
            })
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                setBoundaryStatuses([]);
                setAddressUsageTypes([]);
                setLoadError(err instanceof Error ? err.message : "Could not load boundary reference data.");
            })
            .finally(() => {
                if (!controller.signal.aborted) {
                    setIsLoading(false);
                }
            });
        return () => controller.abort();
    }, []);

    const applyStatusDefaults = (code: string) => {
        const row = boundaryStatuses.find((item) => item.code === code);
        if (!row) {
            return;
        }
        applyBoundaryStatusRefDefaults(row, setValue, dependentDirty.current);
    };

    /** Create form: apply ref-driven defaults when admin level changes, until user edits boundary fields. */
    useEffect(() => {
        if (mode !== "create") {
            return;
        }
        if (isLoading || boundaryStatuses.length === 0) {
            return;
        }
        if (boundaryFieldsTouched.current) {
            return;
        }
        if (!normalizedAdminLevelCode) {
            return;
        }
        if (lastAutoAdminLevelCode.current === normalizedAdminLevelCode) {
            return;
        }

        const statusCode = defaultBoundaryStatusCodeForAdminLevel(normalizedAdminLevelCode);
        const row = boundaryStatuses.find((item) => item.code === statusCode);
        if (!row) {
            return;
        }

        applyBoundaryStatusRefDefaultsAll(row, setValue);
        lastAutoAdminLevelCode.current = normalizedAdminLevelCode;
    }, [boundaryStatuses, isLoading, mode, normalizedAdminLevelCode, setValue]);

    const selectedStatus = boundaryStatuses.find((item) => item.code === boundaryStatus);
    const selectedUsage = addressUsageTypes.find((item) => item.code === addressUsage);
    const settlementExtentLabel =
        boundaryStatuses.find((item) => item.code === SETTLEMENT_EXTENT_BOUNDARY_STATUS_CODE)?.name_en ??
        SETTLEMENT_EXTENT_BOUNDARY_STATUS_CODE;

    return (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <div>
                <h3 className="text-sm font-semibold text-slate-900">Boundary and address usage</h3>
                <p className="mt-1 text-xs text-slate-600">
                    Describe how trustworthy this polygon is and how it may be used in address workflows.
                </p>
            </div>

            {isVillageAdminLevel ? (
                <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                    <p className="font-medium">{VILLAGE_BOUNDARY_CAUTION_TITLE}</p>
                    <p className="mt-1 text-xs leading-relaxed">
                        {villageBoundaryCautionText(settlementExtentLabel)}
                    </p>
                </div>
            ) : null}

            {isLoading ? <p className="text-sm text-slate-500">Loading boundary options…</p> : null}
            {loadError ? (
                <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {loadError}
                </p>
            ) : null}

            <Controller
                name="boundary_status"
                control={control}
                render={({ field }) => (
                    <label className="block" htmlFor="admin-area-boundary-status">
                        <span className="mb-1 block text-sm font-medium text-slate-700">
                            Boundary status <span className="text-red-600">*</span>
                        </span>
                        <select
                            id="admin-area-boundary-status"
                            value={String(field.value ?? "")}
                            disabled={disabled || isLoading}
                            onChange={(e) => {
                                markBoundaryFieldsTouched();
                                const code = e.target.value;
                                field.onChange(code);
                                applyStatusDefaults(code);
                            }}
                            className={inputClass}
                        >
                            <option value="">Select boundary status…</option>
                            {boundaryStatuses.map((item) => (
                                <option key={item.code} value={item.code}>
                                    {refLabel(item.name_en, item.name_mm, item.code)}
                                </option>
                            ))}
                        </select>
                        {selectedStatus?.helper_en ? (
                            <p className="mt-1 text-xs text-slate-600">{selectedStatus.helper_en}</p>
                        ) : null}
                        {isVillageAdminLevel && boundaryStatus === OFFICIAL_BOUNDARY_STATUS_CODE ? (
                            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                                {VILLAGE_OFFICIAL_BOUNDARY_WARNING}
                            </p>
                        ) : null}
                        {boundaryStatus === SETTLEMENT_EXTENT_BOUNDARY_STATUS_CODE ? (
                            <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                                {SETTLEMENT_EXTENT_WARNING}
                            </p>
                        ) : null}
                        {fieldError(errors, "boundary_status") ? (
                            <p className="mt-1 text-sm text-red-600">{fieldError(errors, "boundary_status")}</p>
                        ) : null}
                    </label>
                )}
            />

            <Controller
                name="address_usage"
                control={control}
                render={({ field }) => (
                    <label className="block" htmlFor="admin-area-address-usage">
                        <span className="mb-1 block text-sm font-medium text-slate-700">
                            Address usage <span className="text-red-600">*</span>
                        </span>
                        <select
                            id="admin-area-address-usage"
                            value={String(field.value ?? "")}
                            disabled={disabled || isLoading}
                            onChange={(e) => {
                                markBoundaryFieldsTouched();
                                dependentDirty.current.addressUsage = true;
                                field.onChange(e.target.value);
                            }}
                            className={inputClass}
                        >
                            <option value="">Select address usage…</option>
                            {addressUsageTypes.map((item) => (
                                <option key={item.code} value={item.code}>
                                    {refLabel(item.name_en, item.name_mm, item.code)}
                                </option>
                            ))}
                        </select>
                        {selectedUsage?.helper_en ? (
                            <p className="mt-1 text-xs text-slate-600">{selectedUsage.helper_en}</p>
                        ) : null}
                        {fieldError(errors, "address_usage") ? (
                            <p className="mt-1 text-sm text-red-600">{fieldError(errors, "address_usage")}</p>
                        ) : null}
                    </label>
                )}
            />

            <Controller
                name="is_official_boundary"
                control={control}
                render={({ field }) => (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                        <input
                            id="admin-area-is-official-boundary"
                            type="checkbox"
                            checked={Boolean(field.value)}
                            disabled={disabled || isLoading}
                            onChange={(e) => {
                                markBoundaryFieldsTouched();
                                dependentDirty.current.isOfficialBoundary = true;
                                field.onChange(e.target.checked);
                            }}
                            className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>Official boundary</span>
                    </label>
                )}
            />

            <Controller
                name="boundary_confidence_score"
                control={control}
                render={({ field }) => (
                    <label className="block" htmlFor="admin-area-boundary-confidence">
                        <span className="mb-1 block text-sm font-medium text-slate-700">
                            Boundary confidence score
                        </span>
                        <input
                            id="admin-area-boundary-confidence"
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={field.value === "" || field.value == null ? "" : String(field.value)}
                            disabled={disabled || isLoading}
                            onChange={(e) => {
                                markBoundaryFieldsTouched();
                                dependentDirty.current.boundaryConfidenceScore = true;
                                const raw = e.target.value;
                                field.onChange(raw === "" ? "" : Number(raw));
                            }}
                            className={inputClass}
                        />
                        {fieldError(errors, "boundary_confidence_score") ? (
                            <p className="mt-1 text-sm text-red-600">
                                {fieldError(errors, "boundary_confidence_score")}
                            </p>
                        ) : null}
                    </label>
                )}
            />

            <Controller
                name="boundary_note"
                control={control}
                render={({ field }) => (
                    <label className="block" htmlFor="admin-area-boundary-note">
                        <span className="mb-1 block text-sm font-medium text-slate-700">Boundary note</span>
                        <textarea
                            id="admin-area-boundary-note"
                            rows={3}
                            value={String(field.value ?? "")}
                            disabled={disabled || isLoading}
                            onChange={field.onChange}
                            placeholder="Optional reviewer note about boundary source or caveats"
                            className={inputClass}
                        />
                    </label>
                )}
            />
        </section>
    );
}

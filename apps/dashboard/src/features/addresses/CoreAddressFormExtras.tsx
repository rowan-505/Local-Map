"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Geometry } from "geojson";
import type { Control, UseFormSetValue } from "react-hook-form";

import {
    flatComponentsToEditorRows,
    editorRowsToPatchBody,
    type AddressComponentEditorRow,
} from "@/src/features/import-review/utils/importReviewAddressComponentRows";
import ImportReviewInlineSpinner from "@/src/features/import-review/components/ImportReviewInlineSpinner";
import {
    getImportReviewReferenceOptions,
    type ImportReviewReferenceOptionDto,
} from "@/src/lib/api";
import { pointGeometryToLatLng } from "@/src/components/core-review/geometry/coreGeometryUtils";
import type { CoreReviewAddressComponent } from "@/src/features/core-review/config/types";

import AddressLocationMapPicker from "./AddressLocationMapPicker";
import ReverseAddressSuggestionPanel from "./ReverseAddressSuggestionPanel";
import { reverseComponentsToCorePatch, reverseComponentsToImportReviewRows } from "./reverseAddressToRows";
import { useReverseAddressSuggestion } from "./useReverseAddressSuggestion";

function coreComponentsToEditorRows(
    components: readonly CoreReviewAddressComponent[] | undefined
): AddressComponentEditorRow[] {
    if (!components?.length) {
        return [];
    }
    return flatComponentsToEditorRows(
        components.map((c) => ({
            id: c.id,
            component_type_code: c.componentTypeCode,
            component_value: c.componentValue,
            language_code: c.languageCode,
            sort_order: c.sortOrder,
            confidence_score: c.confidenceScore,
            match_type: c.matchType,
            source_tag: null,
            is_inferred: false,
            is_reviewed: false,
            source_admin_area_id: c.sourceAdminAreaId,
            boundary_status: c.boundaryStatus,
            address_usage: c.addressUsage,
        }))
    );
}

export default function CoreAddressFormExtras({
    control: _control,
    pointGeom,
    setValue,
    disabled,
    initialComponents,
    onComponentRowsChange,
}: {
    control: Control<Record<string, unknown>>;
    pointGeom: Geometry | null;
    setValue: UseFormSetValue<Record<string, unknown>>;
    disabled: boolean;
    initialComponents?: readonly CoreReviewAddressComponent[];
    onComponentRowsChange?: (rows: AddressComponentEditorRow[]) => void;
}) {
    const [componentRows, setComponentRows] = useState<AddressComponentEditorRow[]>(() =>
        coreComponentsToEditorRows(initialComponents)
    );
    const [componentTypeOptions, setComponentTypeOptions] = useState<ImportReviewReferenceOptionDto[]>([]);
    const [locationSaving, setLocationSaving] = useState(false);

    const reverse = useReverseAddressSuggestion(!disabled);

    useEffect(() => {
        setComponentRows(coreComponentsToEditorRows(initialComponents));
    }, [initialComponents]);

    useEffect(() => {
        onComponentRowsChange?.(componentRows);
        const patch = editorRowsToPatchBody(componentRows, []);
        setValue("address_components", patch, { shouldDirty: true });
    }, [componentRows, onComponentRowsChange, setValue]);

    useEffect(() => {
        let cancelled = false;
        void getImportReviewReferenceOptions()
            .then((bundle) => {
                if (!cancelled) {
                    setComponentTypeOptions(bundle.ref_address_component_types ?? []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setComponentTypeOptions([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const coords = useMemo(() => pointGeometryToLatLng(pointGeom), [pointGeom]);

    useEffect(() => {
        if (!coords || disabled) {
            return;
        }
        const t = window.setTimeout(() => {
            void reverse.fetchAt(coords.lat, coords.lng, "en");
        }, 400);
        return () => window.clearTimeout(t);
    }, [coords?.lat, coords?.lng, disabled, reverse.fetchAt]);

    const handleMapPick = useCallback(
        async ({ lat, lng, point }: { lat: number; lng: number; point: Geometry }) => {
            setValue("point_geom", point, { shouldDirty: true, shouldValidate: true });
            setLocationSaving(true);
            try {
                await reverse.fetchAt(lat, lng, "en");
            } finally {
                setLocationSaving(false);
            }
        },
        [reverse.fetchAt, setValue]
    );

    const applySuggested = useCallback(() => {
        if (!reverse.data?.components.length) {
            return;
        }
        const rows = reverseComponentsToImportReviewRows(reverse.data.components);
        setComponentRows(rows);
        const corePatch = reverseComponentsToCorePatch(reverse.data.components);
        setValue("address_components", corePatch, { shouldDirty: true });

        const matched = reverse.data.matched;
        if (matched.street_id) {
            setValue("street_id", matched.street_id, { shouldDirty: true });
        }
        if (matched.admin_area_id) {
            setValue("admin_area_id", matched.admin_area_id, { shouldDirty: true });
        }
    }, [reverse.data, setValue]);

    const updateRow = (rowKey: string, patch: Partial<AddressComponentEditorRow>) => {
        setComponentRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
    };

    const removeRow = (rowKey: string) => {
        setComponentRows((prev) => prev.filter((r) => r.rowKey !== rowKey));
    };

    const addRow = () => {
        setComponentRows((prev) => [
            ...prev,
            {
                rowKey: `new::${Date.now()}`,
                component_type_code: componentTypeOptions[0]?.code ?? "street",
                en: "",
                my: "",
                und: "",
                match_type: "",
                confidence_score: "",
                source_summary: "manual",
                component_ids: {},
                is_reviewed: false,
            },
        ]);
    };

    return (
        <div className="space-y-4">
            <section className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/30 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-900">
                    Location & reverse lookup
                </h3>
                {locationSaving ? <ImportReviewInlineSpinner label="Updating location…" /> : null}
                <AddressLocationMapPicker
                    value={pointGeom}
                    onPick={({ point, lat, lng }) => void handleMapPick({ point, lat, lng })}
                    disabled={disabled}
                />
                <ReverseAddressSuggestionPanel
                    data={reverse.data}
                    loading={reverse.loading}
                    error={reverse.error}
                    canApply={!disabled && Boolean(reverse.data?.components.length)}
                    onApplySuggested={applySuggested}
                />
            </section>

            <section className="space-y-3 rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Address components
                    </h3>
                    {!disabled ? (
                        <button
                            type="button"
                            onClick={addRow}
                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                        >
                            Add row
                        </button>
                    ) : null}
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-left text-xs">
                        <thead className="border-b text-gray-500">
                            <tr>
                                <th className="py-1 pr-2">Type</th>
                                <th className="py-1 pr-2">EN</th>
                                <th className="py-1 pr-2">MY</th>
                                <th className="py-1 pr-2">UND</th>
                                <th className="py-1">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {componentRows.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="py-4 text-gray-500">
                                        No components — click the map and use suggested components, or add rows.
                                    </td>
                                </tr>
                            ) : (
                                componentRows.map((r) => (
                                    <tr key={r.rowKey} className="border-b border-gray-100">
                                        <td className="py-2 pr-2 align-top">
                                            <select
                                                disabled={disabled}
                                                value={r.component_type_code}
                                                onChange={(e) =>
                                                    updateRow(r.rowKey, {
                                                        component_type_code: e.target.value,
                                                    })
                                                }
                                                className="w-full min-w-[7rem] rounded border border-gray-300 px-1 py-0.5"
                                            >
                                                {componentTypeOptions.map((opt) => (
                                                    <option key={opt.id} value={opt.code ?? ""}>
                                                        {opt.code}
                                                    </option>
                                                ))}
                                            </select>
                                        </td>
                                        <td className="py-2 pr-2 align-top">
                                            <input
                                                disabled={disabled}
                                                value={r.en}
                                                onChange={(e) => updateRow(r.rowKey, { en: e.target.value })}
                                                className="w-full rounded border border-gray-300 px-1 py-0.5"
                                            />
                                        </td>
                                        <td className="py-2 pr-2 align-top">
                                            <input
                                                disabled={disabled}
                                                value={r.my}
                                                onChange={(e) => updateRow(r.rowKey, { my: e.target.value })}
                                                className="w-full rounded border border-gray-300 px-1 py-0.5"
                                            />
                                        </td>
                                        <td className="py-2 pr-2 align-top">
                                            <input
                                                disabled={disabled}
                                                value={r.und}
                                                onChange={(e) => updateRow(r.rowKey, { und: e.target.value })}
                                                className="w-full rounded border border-gray-300 px-1 py-0.5"
                                            />
                                        </td>
                                        <td className="py-2 align-top">
                                            {!disabled ? (
                                                <button
                                                    type="button"
                                                    onClick={() => removeRow(r.rowKey)}
                                                    className="text-red-700 hover:underline"
                                                >
                                                    Remove
                                                </button>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    );
}

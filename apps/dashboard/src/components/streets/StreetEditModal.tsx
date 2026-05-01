"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import {
    getAdminAreas,
    getStreet,
    updateStreet,
    type AdminArea,
    type StreetDetail,
} from "@/src/lib/api";

const nullableStringIdSchema = z.preprocess((value) => {
    if (value === "" || value === undefined) {
        return null;
    }

    return value;
}, z.string().nullable());

const streetEditSchema = z.object({
    myanmarName: z.string().trim(),
    englishName: z.string().trim(),
    admin_area_id: nullableStringIdSchema,
});

type StreetEditFormValues = z.infer<typeof streetEditSchema>;
type StreetEditFormInput = {
    myanmarName: string;
    englishName: string;
    admin_area_id: string;
};

type StreetEditModalProps = {
    open: boolean;
    streetId: string | null;
    onClose: () => void;
    onSaved: (streetId: string) => Promise<void> | void;
};

function formatDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

export default function StreetEditModal({
    open,
    streetId,
    onClose,
    onSaved,
}: StreetEditModalProps) {
    const [detail, setDetail] = useState<StreetDetail | null>(null);
    const [adminAreas, setAdminAreas] = useState<AdminArea[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [saveSuccess, setSaveSuccess] = useState("");

    const {
        register,
        handleSubmit,
        reset,
    } = useForm<StreetEditFormInput, unknown, StreetEditFormValues>({
        resolver: zodResolver(streetEditSchema) as Resolver<
            StreetEditFormInput,
            unknown,
            StreetEditFormValues
        >,
        defaultValues: {
            myanmarName: "",
            englishName: "",
            admin_area_id: "",
        },
    });

    useEffect(() => {
        if (!open || !streetId) {
            return;
        }

        const selectedStreetId = streetId;
        let isMounted = true;

        async function loadStreet() {
            setIsLoading(true);
            setLoadError("");
            setSaveError("");
            setSaveSuccess("");

            try {
                const [street, fetchedAdminAreas] = await Promise.all([
                    getStreet(selectedStreetId),
                    getAdminAreas(),
                ]);

                if (!isMounted) {
                    return;
                }

                setDetail(street);
                setAdminAreas(fetchedAdminAreas);
                reset({
                    myanmarName: street.myanmarName ?? "",
                    englishName: street.englishName ?? "",
                    admin_area_id: street.admin_area_id ?? "",
                });
            } catch (error) {
                if (isMounted) {
                    setLoadError(
                        error instanceof Error ? error.message : "Failed to load street details"
                    );
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }

        void loadStreet();

        return () => {
            isMounted = false;
        };
    }, [open, streetId, reset]);

    const modalTitle = useMemo(() => {
        if (!detail) {
            return "Edit Street";
        }

        return `Edit ${detail.canonical_name}`;
    }, [detail]);

    async function onSubmit(values: StreetEditFormValues) {
        if (!streetId) {
            return;
        }

        const selectedStreetId = streetId;
        setIsSaving(true);
        setSaveError("");
        setSaveSuccess("");

        try {
            const updated = await updateStreet(selectedStreetId, values);
            setDetail(updated);
            reset({
                myanmarName: updated.myanmarName ?? "",
                englishName: updated.englishName ?? "",
                admin_area_id: updated.admin_area_id ?? "",
            });
            await onSaved(updated.public_id);
            setSaveSuccess("Street updated successfully.");
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Failed to save street");
        } finally {
            setIsSaving(false);
        }
    }

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
                <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                    <h2 className="text-xl font-semibold text-gray-900">{modalTitle}</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
                    >
                        Close
                    </button>
                </div>

                <div className="overflow-y-auto p-6">
                    {isLoading ? (
                        <p className="text-sm text-gray-600">Loading street details...</p>
                    ) : null}

                    {loadError ? (
                        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                            {loadError}
                        </div>
                    ) : null}

                    {!isLoading && !loadError && detail ? (
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                        Editable Field
                                    </h3>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            Myanmar Name
                                        </span>
                                        <input
                                            {...register("myanmarName")}
                                            placeholder="ဥပမာ - အောင်မင်္ဂလာ"
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            English Name
                                        </span>
                                        <input
                                            {...register("englishName")}
                                            placeholder="Example - Aung Mingalar"
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            Admin Area
                                        </span>
                                        <select
                                            {...register("admin_area_id")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        >
                                            <option value="">No admin area</option>
                                            {adminAreas.map((adminArea) => (
                                                <option key={adminArea.id} value={adminArea.id}>
                                                    {adminArea.canonical_name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                        Read-only Fields
                                    </h3>

                                    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                        <div>
                                            <div className="text-xs text-gray-500">Public ID</div>
                                            <div className="break-all text-sm text-gray-900">
                                                {detail.public_id}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Admin Area Name</div>
                                            <div className="text-sm text-gray-900">
                                                {detail.admin_area_name ?? "-"}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Source Type ID</div>
                                            <div className="text-sm text-gray-900">
                                                {detail.source_type_id ?? "-"}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Is Active</div>
                                            <div className="text-sm text-gray-900">
                                                {detail.is_active ? "Yes" : "No"}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Created At</div>
                                            <div className="text-sm text-gray-900">
                                                {formatDate(detail.created_at)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">Updated At</div>
                                            <div className="text-sm text-gray-900">
                                                {formatDate(detail.updated_at)}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500">
                                                Geometry / GeoJSON Preview
                                            </div>
                                            <pre className="mt-1 max-h-64 overflow-auto rounded border border-gray-200 bg-white p-3 text-xs text-gray-800">
                                                {detail.geometry
                                                    ? JSON.stringify(detail.geometry, null, 2)
                                                    : "No geometry"}
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {saveError ? (
                                <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                                    {saveError}
                                </div>
                            ) : null}

                            {saveSuccess ? (
                                <div className="rounded border border-green-200 bg-green-50 p-4 text-sm text-green-700">
                                    {saveSuccess}
                                </div>
                            ) : null}

                            <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                                >
                                    {isSaving ? "Saving..." : "Save"}
                                </button>
                            </div>
                        </form>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

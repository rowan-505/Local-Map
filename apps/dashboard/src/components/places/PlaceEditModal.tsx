"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
    getPlace,
    getPlaceFormOptions,
    updatePlace,
    type PlaceDetail,
    type PlaceFormOptions,
    type UpdatePlacePayload,
} from "@/src/lib/api";

const scoreFieldSchema = z.union([z.number().finite(), z.literal("")]);

const placeEditFormSchema = z
    .object({
        myanmarName: z.string(),
        englishName: z.string(),
        categoryId: z.string().min(1, "Category is required"),
        adminAreaId: z.string(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        plusCode: z.string(),
        importanceScore: scoreFieldSchema,
        popularityScore: scoreFieldSchema,
        confidenceScore: scoreFieldSchema,
        isPublic: z.boolean(),
        isVerified: z.boolean(),
        sourceTypeId: z.string().min(1, "Source type is required"),
        publishStatusId: z.string(),
    })
    .refine((values) => values.myanmarName.trim().length > 0 || values.englishName.trim().length > 0, {
        message: "Myanmar name or English name is required",
        path: ["myanmarName"],
    });

type PlaceEditFormValues = z.infer<typeof placeEditFormSchema>;

type PlaceEditFormInput = {
    myanmarName: string;
    englishName: string;
    categoryId: string;
    adminAreaId: string;
    lat: number;
    lng: number;
    plusCode: string;
    importanceScore: number | "";
    popularityScore: number | "";
    confidenceScore: number | "";
    isPublic: boolean;
    isVerified: boolean;
    sourceTypeId: string;
    publishStatusId: string;
};

type PlaceEditModalProps = {
    open: boolean;
    placeId: string | null;
    onClose: () => void;
    onSaved: (placeId: string) => Promise<void> | void;
};

function roundCoord(value: number) {
    return Number(value.toFixed(7));
}

function toFormValues(place: PlaceDetail): PlaceEditFormInput {
    return {
        myanmarName: place.myanmarName ?? "",
        englishName: place.englishName ?? "",
        categoryId: place.category_id,
        adminAreaId: place.admin_area_id ?? "",
        lat: place.lat,
        lng: place.lng,
        plusCode: place.plus_code ?? "",
        importanceScore: place.importance_score ?? "",
        popularityScore: place.popularity_score ?? "",
        confidenceScore: place.confidence_score ?? "",
        isPublic: place.is_public,
        isVerified: place.is_verified,
        sourceTypeId: place.source_type_id,
        publishStatusId: place.publish_status_id ?? "",
    };
}

function buildUpdatePayload(values: PlaceEditFormValues): UpdatePlacePayload {
    const mm = values.myanmarName.trim();
    const en = values.englishName.trim();

    return {
        myanmarName: mm,
        englishName: en,
        categoryId: values.categoryId,
        adminAreaId: values.adminAreaId.trim() ? values.adminAreaId : null,
        lat: roundCoord(values.lat),
        lng: roundCoord(values.lng),
        plusCode: values.plusCode.trim() ? values.plusCode.trim() : null,
        importanceScore: values.importanceScore === "" ? 0 : values.importanceScore,
        popularityScore: values.popularityScore === "" ? 0 : values.popularityScore,
        confidenceScore: values.confidenceScore === "" ? 50 : values.confidenceScore,
        isPublic: values.isPublic,
        isVerified: values.isVerified,
        sourceTypeId: values.sourceTypeId,
        publishStatusId: values.publishStatusId.trim() ? values.publishStatusId : null,
    };
}

export default function PlaceEditModal({ open, placeId, onClose, onSaved }: PlaceEditModalProps) {
    const [detail, setDetail] = useState<PlaceDetail | null>(null);
    const [options, setOptions] = useState<PlaceFormOptions | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [saveSuccess, setSaveSuccess] = useState("");

    const {
        register,
        handleSubmit,
        reset,
        formState: { errors },
    } = useForm<PlaceEditFormInput, unknown, PlaceEditFormValues>({
        resolver: zodResolver(placeEditFormSchema),
        defaultValues: {
            myanmarName: "",
            englishName: "",
            categoryId: "",
            adminAreaId: "",
            lat: 0,
            lng: 0,
            plusCode: "",
            importanceScore: "",
            popularityScore: "",
            confidenceScore: "",
            isPublic: true,
            isVerified: false,
            sourceTypeId: "",
            publishStatusId: "",
        },
    });

    useEffect(() => {
        if (!open || !placeId) {
            return;
        }

        const selectedPlaceId = placeId;
        let isMounted = true;

        async function loadFormData() {
            setIsLoading(true);
            setLoadError("");
            setSaveError("");
            setSaveSuccess("");

            try {
                const [placeDetail, formOptions] = await Promise.all([
                    getPlace(selectedPlaceId),
                    getPlaceFormOptions(),
                ]);

                if (!isMounted) {
                    return;
                }

                setDetail(placeDetail);
                setOptions(formOptions);
                reset(toFormValues(placeDetail));
            } catch (error) {
                if (isMounted) {
                    setLoadError(
                        error instanceof Error ? error.message : "Failed to load place form"
                    );
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }

        void loadFormData();

        return () => {
            isMounted = false;
        };
    }, [open, placeId, reset]);

    const modalTitle = useMemo(() => {
        if (!detail) {
            return "Edit Place";
        }

        return `Edit ${detail.display_name}`;
    }, [detail]);

    async function onSubmit(values: PlaceEditFormValues) {
        if (!placeId) {
            return;
        }

        setIsSaving(true);
        setSaveError("");
        setSaveSuccess("");

        try {
            const updated = await updatePlace(placeId, buildUpdatePayload(values));
            setDetail(updated);
            reset(toFormValues(updated));
            await onSaved(updated.public_id);
            setSaveSuccess(`Place updated successfully: ${updated.display_name}`);
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Failed to save place");
        } finally {
            setIsSaving(false);
        }
    }

    const categoryError =
        typeof errors.categoryId?.message === "string" ? errors.categoryId.message : null;

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
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
                        <p className="text-sm text-gray-600">Loading place details...</p>
                    ) : null}

                    {loadError ? (
                        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                            {loadError}
                        </div>
                    ) : null}

                    {!isLoading && !loadError && detail && options ? (
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
                            <div className="grid gap-6 lg:grid-cols-2">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                        Names
                                    </h3>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            Myanmar Name
                                        </span>
                                        <input
                                            {...register("myanmarName")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        />
                                        {errors.myanmarName?.message ? (
                                            <span className="mt-1 block text-sm text-red-600">
                                                {String(errors.myanmarName.message)}
                                            </span>
                                        ) : null}
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            English Name
                                        </span>
                                        <input
                                            {...register("englishName")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        />
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">Category</span>
                                        <select
                                            {...register("categoryId")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        >
                                            <option value="">Select category</option>
                                            {options.categories.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        {categoryError ? (
                                            <span className="mt-1 block text-sm text-red-600">
                                                {categoryError}
                                            </span>
                                        ) : null}
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            Admin Area
                                        </span>
                                        <select
                                            {...register("adminAreaId")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        >
                                            <option value="">No admin area</option>
                                            {options.admin_areas.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <div className="grid gap-4 sm:grid-cols-2">
                                        <label className="block">
                                            <span className="mb-1 block text-sm text-gray-700">Lat</span>
                                            <input
                                                type="number"
                                                step="any"
                                                {...register("lat", {
                                                    setValueAs: (value) => Number(value),
                                                })}
                                                className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                            />
                                            {errors.lat?.message ? (
                                                <span className="mt-1 block text-sm text-red-600">
                                                    {String(errors.lat.message)}
                                                </span>
                                            ) : null}
                                        </label>

                                        <label className="block">
                                            <span className="mb-1 block text-sm text-gray-700">Lng</span>
                                            <input
                                                type="number"
                                                step="any"
                                                {...register("lng", {
                                                    setValueAs: (value) => Number(value),
                                                })}
                                                className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                            />
                                            {errors.lng?.message ? (
                                                <span className="mt-1 block text-sm text-red-600">
                                                    {String(errors.lng.message)}
                                                </span>
                                            ) : null}
                                        </label>
                                    </div>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">Plus Code</span>
                                        <input
                                            {...register("plusCode")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        />
                                    </label>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                        Scores and status
                                    </h3>

                                    <div className="grid gap-4 sm:grid-cols-3">
                                        <label className="block">
                                            <span className="mb-1 block text-sm text-gray-700">
                                                Importance
                                            </span>
                                            <input
                                                type="number"
                                                step="any"
                                                {...register("importanceScore", {
                                                    setValueAs: (value) =>
                                                        value === "" ? "" : Number(value),
                                                })}
                                                className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                            />
                                        </label>

                                        <label className="block">
                                            <span className="mb-1 block text-sm text-gray-700">
                                                Popularity
                                            </span>
                                            <input
                                                type="number"
                                                step="any"
                                                {...register("popularityScore", {
                                                    setValueAs: (value) =>
                                                        value === "" ? "" : Number(value),
                                                })}
                                                className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                            />
                                        </label>

                                        <label className="block">
                                            <span className="mb-1 block text-sm text-gray-700">
                                                Confidence
                                            </span>
                                            <input
                                                type="number"
                                                step="any"
                                                {...register("confidenceScore", {
                                                    setValueAs: (value) =>
                                                        value === "" ? "" : Number(value),
                                                })}
                                                className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                            />
                                        </label>
                                    </div>

                                    <label className="flex items-center gap-3 rounded border border-gray-200 p-3">
                                        <input type="checkbox" {...register("isPublic")} className="h-4 w-4" />
                                        <span className="text-sm text-gray-700">Is Public</span>
                                    </label>

                                    <label className="flex items-center gap-3 rounded border border-gray-200 p-3">
                                        <input
                                            type="checkbox"
                                            {...register("isVerified")}
                                            className="h-4 w-4"
                                        />
                                        <span className="text-sm text-gray-700">Is Verified</span>
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            Source Type
                                        </span>
                                        <select
                                            {...register("sourceTypeId")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        >
                                            <option value="">Select source type</option>
                                            {options.source_types.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        {errors.sourceTypeId?.message ? (
                                            <span className="mt-1 block text-sm text-red-600">
                                                {String(errors.sourceTypeId.message)}
                                            </span>
                                        ) : null}
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            Publish Status
                                        </span>
                                        <select
                                            {...register("publishStatusId")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        >
                                            <option value="">No publish status</option>
                                            {options.publish_statuses.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
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

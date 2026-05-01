"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import {
    getPlace,
    getPlaceFormOptions,
    updatePlace,
    type PlaceDetail,
    type PlaceFormOptions,
} from "@/src/lib/api";

const nullableTrimmedStringSchema = z.preprocess((value) => {
    if (value === "" || value === undefined) {
        return null;
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
    }

    return value;
}, z.string().nullable());

const nullableStringIdSchema = z.preprocess((value) => {
    if (value === "" || value === undefined) {
        return null;
    }

    return value;
}, z.string().nullable());

const nullableNumberSchema = z.preprocess((value) => {
    if (value === "" || value === undefined || value === null) {
        return null;
    }

    if (typeof value === "string") {
        return Number(value);
    }

    return value;
}, z.number().nullable());

const placeEditSchema = z.object({
    myanmarName: z.string().trim(),
    englishName: z.string().trim(),
    category_id: z.string().min(1, "Category is required"),
    admin_area_id: nullableStringIdSchema,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    plus_code: nullableTrimmedStringSchema,
    importance_score: nullableNumberSchema,
    popularity_score: nullableNumberSchema,
    confidence_score: nullableNumberSchema,
    is_public: z.boolean(),
    is_verified: z.boolean(),
    source_type_id: z.string().min(1, "Source type is required"),
    publish_status_id: nullableStringIdSchema,
});

type PlaceEditFormValues = z.infer<typeof placeEditSchema>;
type PlaceEditFormInput = {
    myanmarName: string;
    englishName: string;
    category_id: string;
    admin_area_id: string;
    lat: number;
    lng: number;
    plus_code: string;
    importance_score: number | "";
    popularity_score: number | "";
    confidence_score: number | "";
    is_public: boolean;
    is_verified: boolean;
    source_type_id: string;
    publish_status_id: string;
};

type PlaceEditModalProps = {
    open: boolean;
    placeId: string | null;
    onClose: () => void;
    onSaved: (placeId: string) => Promise<void> | void;
};

function formatDate(value: string | null): string {
    if (!value) {
        return "-";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

function toFormValues(place: PlaceDetail): PlaceEditFormInput {
    return {
        myanmarName: place.myanmarName ?? "",
        englishName: place.englishName ?? "",
        category_id: place.category_id,
        admin_area_id: place.admin_area_id ?? "",
        lat: place.lat,
        lng: place.lng,
        plus_code: place.plus_code ?? "",
        importance_score: place.importance_score ?? "",
        popularity_score: place.popularity_score ?? "",
        confidence_score: place.confidence_score ?? "",
        is_public: place.is_public,
        is_verified: place.is_verified,
        source_type_id: place.source_type_id,
        publish_status_id: place.publish_status_id ?? "",
    };
}

export default function PlaceEditModal({
    open,
    placeId,
    onClose,
    onSaved,
}: PlaceEditModalProps) {
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
        resolver: zodResolver(placeEditSchema) as Resolver<
            PlaceEditFormInput,
            unknown,
            PlaceEditFormValues
        >,
        defaultValues: {
            myanmarName: "",
            englishName: "",
            category_id: "",
            admin_area_id: "",
            lat: 0,
            lng: 0,
            plus_code: "",
            importance_score: "",
            popularity_score: "",
            confidence_score: "",
            is_public: false,
            is_verified: false,
            source_type_id: "",
            publish_status_id: "",
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

        const selectedPlaceId = placeId;
        setIsSaving(true);
        setSaveError("");
        setSaveSuccess("");

        try {
            const updated = await updatePlace(selectedPlaceId, values);
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
                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                            <div className="grid gap-6 lg:grid-cols-2">
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                        Editable Fields
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
                                        <span className="mb-1 block text-sm text-gray-700">Category</span>
                                        <select
                                            {...register("category_id")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        >
                                            <option value="">Select category</option>
                                            {options.categories.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        {errors.category_id ? (
                                            <span className="mt-1 block text-sm text-red-600">
                                                {errors.category_id.message}
                                            </span>
                                        ) : null}
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
                                            {errors.lat ? (
                                                <span className="mt-1 block text-sm text-red-600">
                                                    {errors.lat.message}
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
                                            {errors.lng ? (
                                                <span className="mt-1 block text-sm text-red-600">
                                                    {errors.lng.message}
                                                </span>
                                            ) : null}
                                        </label>
                                    </div>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">Plus Code</span>
                                        <input
                                            {...register("plus_code")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        />
                                    </label>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                        Scores and Status
                                    </h3>

                                    <div className="grid gap-4 sm:grid-cols-3">
                                        <label className="block">
                                            <span className="mb-1 block text-sm text-gray-700">
                                                Importance
                                            </span>
                                            <input
                                                type="number"
                                                step="any"
                                                {...register("importance_score", {
                                                    setValueAs: (value) =>
                                                        value === "" ? null : Number(value),
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
                                                {...register("popularity_score", {
                                                    setValueAs: (value) =>
                                                        value === "" ? null : Number(value),
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
                                                {...register("confidence_score", {
                                                    setValueAs: (value) =>
                                                        value === "" ? null : Number(value),
                                                })}
                                                className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                            />
                                        </label>
                                    </div>

                                    <label className="flex items-center gap-3 rounded border border-gray-200 p-3">
                                        <input
                                            type="checkbox"
                                            {...register("is_public")}
                                            className="h-4 w-4"
                                        />
                                        <span className="text-sm text-gray-700">Is Public</span>
                                    </label>

                                    <label className="flex items-center gap-3 rounded border border-gray-200 p-3">
                                        <input
                                            type="checkbox"
                                            {...register("is_verified")}
                                            className="h-4 w-4"
                                        />
                                        <span className="text-sm text-gray-700">Is Verified</span>
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            Source Type
                                        </span>
                                        <select
                                            {...register("source_type_id")}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        >
                                            <option value="">Select source type</option>
                                            {options.source_types.map((option) => (
                                                <option key={option.id} value={option.id}>
                                                    {option.label}
                                                </option>
                                            ))}
                                        </select>
                                        {errors.source_type_id ? (
                                            <span className="mt-1 block text-sm text-red-600">
                                                {errors.source_type_id.message}
                                            </span>
                                        ) : null}
                                    </label>

                                    <label className="block">
                                        <span className="mb-1 block text-sm text-gray-700">
                                            Publish Status
                                        </span>
                                        <select
                                            {...register("publish_status_id")}
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

                                    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                                        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                                            Read-only Fields
                                        </h3>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <div>
                                                <div className="text-xs text-gray-500">ID</div>
                                                <div className="text-sm text-gray-900">{detail.id}</div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-gray-500">Public ID</div>
                                                <div className="break-all text-sm text-gray-900">
                                                    {detail.public_id}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-gray-500">
                                                    Current Version ID
                                                </div>
                                                <div className="text-sm text-gray-900">
                                                    {detail.current_version_id ?? "-"}
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-xs text-gray-500">Deleted At</div>
                                                <div className="text-sm text-gray-900">
                                                    {formatDate(detail.deleted_at)}
                                                </div>
                                            </div>
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

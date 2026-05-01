"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import PlaceCreateMapPicker from "@/src/components/map/PlaceCreateMapPicker";
import {
    createPlace,
    getAdminAreas,
    getCategories,
    getPlaceFormOptions,
    type AdminArea,
    type Category,
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

const placeCreateSchema = z.object({
    myanmarName: z.string().trim(),
    englishName: z.string().trim(),
    category_id: z.string().min(1, "Category is required"),
    admin_area_id: nullableStringIdSchema,
    lat: z.number().min(-90).max(90, "Latitude must be between -90 and 90"),
    lng: z.number().min(-180).max(180, "Longitude must be between -180 and 180"),
    plus_code: nullableTrimmedStringSchema,
    importance_score: nullableNumberSchema,
    popularity_score: nullableNumberSchema,
    confidence_score: nullableNumberSchema,
    is_public: z.boolean(),
    is_verified: z.boolean(),
    source_type_id: nullableStringIdSchema,
    publish_status_id: nullableStringIdSchema,
});

type PlaceCreateFormValues = z.infer<typeof placeCreateSchema>;
type PlaceCreateFormInput = {
    myanmarName: string;
    englishName: string;
    category_id: string;
    admin_area_id: string;
    lat: number | "";
    lng: number | "";
    plus_code: string;
    importance_score: number | "";
    popularity_score: number | "";
    confidence_score: number | "";
    is_public: boolean;
    is_verified: boolean;
    source_type_id: string;
    publish_status_id: string;
};

function roundCoord(value: number) {
    return Number(value.toFixed(7));
}

function parseCoordInput(value: string) {
    if (value === "") {
        return "";
    }

    return roundCoord(Number(value));
}

export default function NewPlacePage() {
    const router = useRouter();
    const [categories, setCategories] = useState<Category[]>([]);
    const [adminAreas, setAdminAreas] = useState<AdminArea[]>([]);
    const [formOptions, setFormOptions] = useState<PlaceFormOptions | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        formState: { errors },
    } = useForm<PlaceCreateFormInput, unknown, PlaceCreateFormValues>({
        resolver: zodResolver(placeCreateSchema) as Resolver<
            PlaceCreateFormInput,
            unknown,
            PlaceCreateFormValues
        >,
        defaultValues: {
            myanmarName: "",
            englishName: "",
            category_id: "",
            admin_area_id: "",
            lat: "",
            lng: "",
            plus_code: "",
            importance_score: "",
            popularity_score: "",
            confidence_score: "",
            is_public: true,
            is_verified: false,
            source_type_id: "",
            publish_status_id: "",
        },
    });

    useEffect(() => {
        let isMounted = true;

        async function loadOptions() {
            setIsLoading(true);
            setLoadError("");

            try {
                const [categoriesResult, adminAreasResult, placeFormOptionsResult] =
                    await Promise.allSettled([
                        getCategories(),
                        getAdminAreas(),
                        getPlaceFormOptions(),
                    ]);

                if (!isMounted) {
                    return;
                }

                if (categoriesResult.status === "rejected") {
                    throw categoriesResult.reason;
                }

                if (adminAreasResult.status === "rejected") {
                    throw adminAreasResult.reason;
                }

                setCategories(categoriesResult.value);
                setAdminAreas(adminAreasResult.value);
                setFormOptions(
                    placeFormOptionsResult.status === "fulfilled"
                        ? placeFormOptionsResult.value
                        : {
                              categories: [],
                              admin_areas: [],
                              source_types: [],
                              publish_statuses: [],
                          }
                );
            } catch (error) {
                if (isMounted) {
                    setLoadError(
                        error instanceof Error ? error.message : "Failed to load create form options"
                    );
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }

        void loadOptions();

        return () => {
            isMounted = false;
        };
    }, []);

    const lat = watch("lat");
    const lng = watch("lng");

    const selectedLat = typeof lat === "number" && Number.isFinite(lat) ? lat : null;
    const selectedLng = typeof lng === "number" && Number.isFinite(lng) ? lng : null;

    const handleMapChange = useCallback(
        (coords: { lat: number; lng: number }) => {
            setValue("lat", roundCoord(coords.lat), {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
            });
            setValue("lng", roundCoord(coords.lng), {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
            });
        },
        [setValue]
    );

    async function onSubmit(values: PlaceCreateFormValues) {
        setIsSaving(true);
        setSaveError("");

        try {
            await createPlace({
                ...values,
                lat: roundCoord(values.lat),
                lng: roundCoord(values.lng),
            });
            window.sessionStorage.setItem("placeCreateSuccess", "Place created successfully.");
            router.push("/places");
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Failed to create place");
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <main className="min-h-screen bg-gray-100 p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Create Place</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Enter place details and pick coordinates from the map.
                        </p>
                    </div>
                    <Link
                        href="/places"
                        className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700"
                    >
                        Back to Places
                    </Link>
                </div>

                {isLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
                        Loading create form...
                    </div>
                ) : null}

                {!isLoading && loadError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
                        {loadError}
                    </div>
                ) : null}

                {!isLoading && !loadError ? (
                    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
                        <form
                            onSubmit={handleSubmit(onSubmit)}
                            className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
                        >
                            <div className="grid gap-6 sm:grid-cols-2">
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
                                        {categories.map((category) => (
                                            <option key={category.id} value={category.id}>
                                                {category.name}
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
                                    <span className="mb-1 block text-sm text-gray-700">Admin Area</span>
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

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Lat</span>
                                    <input
                                        type="number"
                                        step="any"
                                        {...register("lat", {
                                            setValueAs: parseCoordInput,
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
                                            setValueAs: parseCoordInput,
                                        })}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    />
                                    {errors.lng ? (
                                        <span className="mt-1 block text-sm text-red-600">
                                            {errors.lng.message}
                                        </span>
                                    ) : null}
                                </label>

                                <label className="block sm:col-span-2">
                                    <span className="mb-1 block text-sm text-gray-700">Plus Code</span>
                                    <input
                                        {...register("plus_code")}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">
                                        Importance Score
                                    </span>
                                    <input
                                        type="number"
                                        step="any"
                                        {...register("importance_score", {
                                            setValueAs: (value) =>
                                                value === "" ? "" : Number(value),
                                        })}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">
                                        Popularity Score
                                    </span>
                                    <input
                                        type="number"
                                        step="any"
                                        {...register("popularity_score", {
                                            setValueAs: (value) =>
                                                value === "" ? "" : Number(value),
                                        })}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="block sm:col-span-2">
                                    <span className="mb-1 block text-sm text-gray-700">
                                        Confidence Score
                                    </span>
                                    <input
                                        type="number"
                                        step="any"
                                        {...register("confidence_score", {
                                            setValueAs: (value) =>
                                                value === "" ? "" : Number(value),
                                        })}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="flex items-center gap-3 rounded border border-gray-200 p-3">
                                    <input type="checkbox" {...register("is_public")} className="h-4 w-4" />
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
                                        <option value="">Use default manual source</option>
                                        {formOptions?.source_types.map((option) => (
                                            <option key={option.id} value={option.id}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
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
                                        {formOptions?.publish_statuses.map((option) => (
                                            <option key={option.id} value={option.id}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            {saveError ? (
                                <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                                    {saveError}
                                </div>
                            ) : null}

                            <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
                                <Link
                                    href="/places"
                                    className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
                                >
                                    Cancel
                                </Link>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                                >
                                    {isSaving ? "Creating..." : "Create Place"}
                                </button>
                            </div>
                        </form>

                        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">
                                Coordinate Picker
                            </h2>
                            <PlaceCreateMapPicker
                                lat={selectedLat}
                                lng={selectedLng}
                                onChange={handleMapChange}
                            />
                            <p className="mt-3 text-sm text-gray-600">
                                Click the map to place the marker. Drag the marker or edit the
                                latitude/longitude fields to fine-tune the location.
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>
        </main>
    );
}

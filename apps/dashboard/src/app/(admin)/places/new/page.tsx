"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import MapPreviewCard from "@/src/components/map/MapPreviewCard";
import PlaceCreateMapPicker from "@/src/components/map/PlaceCreateMapPicker";
import {
    createPlace,
    getPlaceFormOptions,
    getPlaces,
    PLACES_LIST_LIMIT,
    type CreatePlacePayload,
    type Place,
    type PlaceFormOptions,
} from "@/src/lib/api";

const scoreFieldSchema = z.union([z.number().finite(), z.literal("")]);

const placeCreateFormSchema = z
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
        sourceTypeId: z.string(),
        publishStatusId: z.string(),
    })
    .refine((values) => values.myanmarName.trim().length > 0 || values.englishName.trim().length > 0, {
        message: "Myanmar name or English name is required",
        path: ["myanmarName"],
    });

type PlaceCreateFormValues = z.infer<typeof placeCreateFormSchema>;

type PlaceCreateFormInput = {
    myanmarName: string;
    englishName: string;
    categoryId: string;
    adminAreaId: string;
    lat: number | "";
    lng: number | "";
    plusCode: string;
    importanceScore: number | "";
    popularityScore: number | "";
    confidenceScore: number | "";
    isPublic: boolean;
    isVerified: boolean;
    sourceTypeId: string;
    publishStatusId: string;
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

function buildCreatePayload(values: PlaceCreateFormValues): CreatePlacePayload {
    const mm = values.myanmarName.trim();
    const en = values.englishName.trim();

    return {
        ...(mm ? { myanmarName: mm } : {}),
        ...(en ? { englishName: en } : {}),
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
        sourceTypeId: values.sourceTypeId.trim() ? values.sourceTypeId : null,
        publishStatusId: values.publishStatusId.trim() ? values.publishStatusId : null,
    };
}

export default function NewPlacePage() {
    const router = useRouter();
    const [formOptions, setFormOptions] = useState<PlaceFormOptions | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [previewContextPlaces, setPreviewContextPlaces] = useState<Place[]>([]);
    const appliedOptionDefaultsRef = useRef(false);

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        formState: { errors },
    } = useForm<PlaceCreateFormInput, unknown, PlaceCreateFormValues>({
        resolver: zodResolver(placeCreateFormSchema) as Resolver<
            PlaceCreateFormInput,
            unknown,
            PlaceCreateFormValues
        >,
        defaultValues: {
            myanmarName: "",
            englishName: "",
            categoryId: "",
            adminAreaId: "",
            lat: "",
            lng: "",
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
        let isMounted = true;

        async function loadOptions() {
            setIsLoading(true);
            setLoadError("");

            try {
                const options = await getPlaceFormOptions();

                if (!isMounted) {
                    return;
                }

                setFormOptions(options);
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

    useEffect(() => {
        if (!formOptions || appliedOptionDefaultsRef.current) {
            return;
        }

        const manual = formOptions.source_types.find((source) => source.code === "manual");
        const published = formOptions.publish_statuses.find((status) => status.code === "published");

        if (manual?.id) {
            setValue("sourceTypeId", manual.id);
        }

        if (published?.id) {
            setValue("publishStatusId", published.id);
        }

        appliedOptionDefaultsRef.current = true;
    }, [formOptions, setValue]);

    useEffect(() => {
        let isMounted = true;

        void getPlaces({ limit: PLACES_LIST_LIMIT })
            .then((data) => {
                if (isMounted) {
                    setPreviewContextPlaces(data);
                }
            })
            .catch(() => {
                if (isMounted) {
                    setPreviewContextPlaces([]);
                }
            });

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
            const created = await createPlace(buildCreatePayload(values));
            window.sessionStorage.setItem("placeCreateSuccess", "Place created successfully.");
            window.sessionStorage.setItem("placeCreatePublicId", created.public_id);
            router.push("/places");
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Failed to create place");
        } finally {
            setIsSaving(false);
        }
    }

    const categoryError =
        typeof errors.categoryId?.message === "string" ? errors.categoryId.message : null;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl">
                <div className="mb-6 flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Create Place</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Enter Myanmar and English names (at least one required). Other fields match the API.
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
                                    <span className="mb-1 block text-sm text-gray-700">Myanmar Name</span>
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
                                    <span className="mb-1 block text-sm text-gray-700">English Name</span>
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
                                        {formOptions?.categories.map((category) => (
                                            <option key={category.id} value={category.id}>
                                                {category.label}
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
                                    <span className="mb-1 block text-sm text-gray-700">Admin Area</span>
                                    <select
                                        {...register("adminAreaId")}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    >
                                        <option value="">No admin area</option>
                                        {formOptions?.admin_areas.map((area) => (
                                            <option key={area.id} value={area.id}>
                                                {area.label}
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
                                            setValueAs: parseCoordInput,
                                        })}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    />
                                    {errors.lng?.message ? (
                                        <span className="mt-1 block text-sm text-red-600">
                                            {String(errors.lng.message)}
                                        </span>
                                    ) : null}
                                </label>

                                <label className="block sm:col-span-2">
                                    <span className="mb-1 block text-sm text-gray-700">Plus Code</span>
                                    <input
                                        {...register("plusCode")}
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
                                        {...register("importanceScore", {
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
                                        {...register("popularityScore", {
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
                                        {...register("confidenceScore", {
                                            setValueAs: (value) =>
                                                value === "" ? "" : Number(value),
                                        })}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    />
                                </label>

                                <label className="flex items-center gap-3 rounded border border-gray-200 p-3">
                                    <input type="checkbox" {...register("isPublic")} className="h-4 w-4" />
                                    <span className="text-sm text-gray-700">Is Public</span>
                                </label>

                                <label className="flex items-center gap-3 rounded border border-gray-200 p-3">
                                    <input type="checkbox" {...register("isVerified")} className="h-4 w-4" />
                                    <span className="text-sm text-gray-700">Is Verified</span>
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Source Type</span>
                                    <select
                                        {...register("sourceTypeId")}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    >
                                        <option value="">Use API default</option>
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
                                        {...register("publishStatusId")}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    >
                                        <option value="">Use API default</option>
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
                            <MapPreviewCard
                                title="Coordinate Picker"
                                description="Click the map to place the marker. Drag the marker or edit the latitude/longitude fields to fine-tune the location."
                            >
                                <PlaceCreateMapPicker
                                    lat={selectedLat}
                                    lng={selectedLng}
                                    onChange={handleMapChange}
                                    contextPlaces={previewContextPlaces}
                                />
                            </MapPreviewCard>
                            <p className="mt-4 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-950">
                                <strong>Linked buildings:</strong> After you create the place, open{" "}
                                <strong>Edit</strong> from the Places list to attach nearby footprints. Buildings
                                are optional for every POI.
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>
        </main>
    );
}

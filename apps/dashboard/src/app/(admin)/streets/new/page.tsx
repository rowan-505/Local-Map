"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import { createStreet, getAdminAreas, type AdminArea } from "@/src/lib/api";

const nullableStringIdSchema = z.preprocess((value) => {
    if (value === "" || value === undefined) {
        return null;
    }

    return value;
}, z.string().nullable());

const streetCreateSchema = z.object({
    canonical_name: z.string().trim().min(1, "Canonical name is required"),
    myanmarName: z.string().trim(),
    englishName: z.string().trim(),
    admin_area_id: nullableStringIdSchema,
});

type StreetCreateFormValues = z.infer<typeof streetCreateSchema>;
type StreetCreateFormInput = {
    canonical_name: string;
    myanmarName: string;
    englishName: string;
    admin_area_id: string;
};

export default function NewStreetPage() {
    const router = useRouter();
    const [adminAreas, setAdminAreas] = useState<AdminArea[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [isSaving, setIsSaving] = useState(false);

    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<StreetCreateFormInput, unknown, StreetCreateFormValues>({
        resolver: zodResolver(streetCreateSchema) as Resolver<
            StreetCreateFormInput,
            unknown,
            StreetCreateFormValues
        >,
        defaultValues: {
            canonical_name: "",
            myanmarName: "",
            englishName: "",
            admin_area_id: "",
        },
    });

    useEffect(() => {
        let isMounted = true;

        async function loadOptions() {
            setIsLoading(true);
            setLoadError("");

            try {
                const data = await getAdminAreas();

                if (isMounted) {
                    setAdminAreas(data);
                }
            } catch (error) {
                if (isMounted) {
                    setLoadError(error instanceof Error ? error.message : "Failed to load admin areas");
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

    async function onSubmit(values: StreetCreateFormValues) {
        setIsSaving(true);
        setSaveError("");

        try {
            await createStreet(values);
            router.push("/streets");
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Failed to create street");
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-3xl">
                <div className="mb-6 flex items-center justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Create Street</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Add street names and assign an admin area.
                        </p>
                    </div>
                    <Link
                        href="/streets"
                        className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700"
                    >
                        Back to Streets
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
                    <form
                        onSubmit={handleSubmit(onSubmit)}
                        className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
                    >
                        <div className="space-y-4">
                            <label className="block">
                                <span className="mb-1 block text-sm text-gray-700">
                                    Canonical Name
                                </span>
                                <input
                                    {...register("canonical_name")}
                                    className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                />
                                {errors.canonical_name ? (
                                    <span className="mt-1 block text-sm text-red-600">
                                        {errors.canonical_name.message}
                                    </span>
                                ) : null}
                            </label>

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
                        </div>

                        {saveError ? (
                            <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                                {saveError}
                            </div>
                        ) : null}

                        <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
                            <Link
                                href="/streets"
                                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
                            >
                                Cancel
                            </Link>
                            <button
                                type="submit"
                                disabled={isSaving}
                                className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                            >
                                {isSaving ? "Creating..." : "Create Street"}
                            </button>
                        </div>
                    </form>
                ) : null}
            </div>
        </main>
    );
}

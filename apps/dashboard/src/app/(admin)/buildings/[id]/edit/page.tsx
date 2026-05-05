"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import BuildingEditorForm from "@/src/components/buildings/BuildingEditorForm";
import BuildingLinkedPlacesPanel from "@/src/components/buildings/BuildingLinkedPlacesPanel";
import { getBuilding, updateBuilding, type Building, type CreateBuildingPayload } from "@/src/lib/api";

export default function EditBuildingPage() {
    const params = useParams();
    const rawId = params.id;
    const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

    const [building, setBuilding] = useState<Building | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [saveSuccess, setSaveSuccess] = useState("");

    useEffect(() => {
        if (!id) {
            setLoadError("Missing building id");
            setIsLoading(false);
            return;
        }

        let mounted = true;

        async function load() {
            setIsLoading(true);
            setLoadError("");

            try {
                const data = await getBuilding(id);

                if (mounted) {
                    setBuilding(data);
                }
            } catch (err) {
                if (mounted) {
                    setLoadError(err instanceof Error ? err.message : "Failed to load building");
                    setBuilding(null);
                }
            } finally {
                if (mounted) {
                    setIsLoading(false);
                }
            }
        }

        void load();

        return () => {
            mounted = false;
        };
    }, [id]);

    if (!id) {
        return (
            <main className="p-6">
                <p className="text-sm text-red-600">Invalid route.</p>
            </main>
        );
    }

    if (isLoading) {
        return (
            <main className="p-6">
                <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
                    Loading building…
                </div>
            </main>
        );
    }

    if (loadError || !building) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-3xl space-y-4">
                    <Link href="/buildings" className="text-sm font-medium text-blue-700 hover:text-blue-900">
                        ← Back to buildings
                    </Link>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        {loadError || "Building not found."}
                    </div>
                </div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <div className="mx-auto mb-4 max-w-3xl">
                <Link
                    href="/buildings"
                    className="text-sm font-medium text-blue-700 hover:text-blue-900"
                >
                    ← Back to buildings
                </Link>
            </div>

            {saveSuccess ? (
                <div className="mx-auto mb-4 max-w-5xl rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                    {saveSuccess}
                </div>
            ) : null}

            <div className="mx-auto max-w-5xl space-y-8">
                <BuildingEditorForm
                    title="Edit building"
                    description={`public_id: ${building.public_id}`}
                    initialBuilding={building}
                    cancelHref="/buildings"
                    submitLabel="Save changes"
                    onCommit={() => setSaveSuccess("")}
                    onSubmit={async (payload: CreateBuildingPayload) => {
                        await updateBuilding(id, payload);
                        setSaveSuccess("Building saved successfully.");
                    }}
                />

                <BuildingLinkedPlacesPanel buildingPublicId={building.public_id} />
            </div>
        </main>
    );
}

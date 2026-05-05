"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import BuildingEditorForm from "@/src/components/buildings/BuildingEditorForm";
import { createBuilding, type CreateBuildingPayload } from "@/src/lib/api";

export default function NewBuildingPage() {
    const router = useRouter();

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

            <BuildingEditorForm
                title="Create building"
                description="Draw on the map or paste GeoJSON Polygon or MultiPolygon (EPSG:4326). The API validates geometry and metadata."
                cancelHref="/buildings"
                submitLabel="Create building"
                onSubmit={async (payload: CreateBuildingPayload) => {
                    const created = await createBuilding(payload);
                    router.push(`/buildings/${created.public_id}/edit`);
                }}
            />
        </main>
    );
}

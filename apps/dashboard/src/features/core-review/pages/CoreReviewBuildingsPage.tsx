"use client";

import Link from "next/link";
import { useState } from "react";

import { useBuildingTileVersion } from "@/src/components/map/BuildingTileVersionContext";
import { scheduleBuildingTileRefresh } from "@/src/components/map/placeMapConfig";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";
import { deleteBuilding } from "@/src/lib/api";

import { CORE_REVIEW_BUILDINGS_CONFIG } from "../config/entity-configs";
import type { CoreReviewBuildingRow } from "../config/types";
import { safeTechnicalClientMessage } from "../utils/formatters";
import CoreReviewEntityPage from "../components/CoreReviewEntityPage";

export default function CoreReviewBuildingsPage() {
    const { bumpBuildingTileVersion } = useBuildingTileVersion();
    const [deleteError, setDeleteError] = useState("");
    const [isDeleting, setIsDeleting] = useState(false);

    const config = {
        ...CORE_REVIEW_BUILDINGS_CONFIG,
        extensions: {
            headerActions: (
                <Link
                    href={coreReviewPath("buildings/new")}
                    className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                    Add Building
                </Link>
            ),
            renderDrawerActions: ({
                row,
                close,
                reloadList,
            }: {
                row: CoreReviewBuildingRow;
                close: () => void;
                reloadList: () => void;
            }) => (
                <button
                    type="button"
                    disabled={isDeleting}
                    onClick={async () => {
                        if (!window.confirm("Delete this building?")) {
                            return;
                        }
                        setIsDeleting(true);
                        setDeleteError("");
                        try {
                            await deleteBuilding(row.publicId);
                            const tileVersion = bumpBuildingTileVersion();
                            scheduleBuildingTileRefresh(null, tileVersion);
                            close();
                            reloadList();
                        } catch (err) {
                            setDeleteError(
                                safeTechnicalClientMessage(
                                    err instanceof Error ? err.message : "Failed to delete building",
                                    "Unable to delete the building."
                                )
                            );
                        } finally {
                            setIsDeleting(false);
                        }
                    }}
                    className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                >
                    {isDeleting ? "Deleting…" : "Delete"}
                </button>
            ),
            wrapPage: (content: React.ReactNode) => (
                <>
                    {deleteError ? (
                        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                            {deleteError}
                        </div>
                    ) : null}
                    {content}
                </>
            ),
        },
    };

    return <CoreReviewEntityPage config={config} />;
}

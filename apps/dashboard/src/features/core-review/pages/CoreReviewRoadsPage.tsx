"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import CoreReviewStatusBadge from "@/src/components/core-review/CoreReviewStatusBadge";
import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import { DASHBOARD_STREET_MVT_SESSION_BUST_KEY } from "@/src/components/map/placeMapConfig";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";
import { deleteStreet } from "@/src/lib/api";
import { dashDevLog } from "@/src/lib/dashDevLog";

import CoreReviewEntityPage from "../components/CoreReviewEntityPage";
import { CORE_REVIEW_STREETS_CONFIG } from "../config/entity-configs";
import type { CoreReviewStreetRow } from "../config/types";

export default function CoreReviewRoadsPage() {
    const { bumpStreetTileVersion, bumpRoadLabelTileVersion } = useDashboardTileVersions();
    const [deleteBusy, setDeleteBusy] = useState(false);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY);
            if (!raw) {
                return;
            }
            sessionStorage.removeItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY);
            bumpStreetTileVersion();
            bumpRoadLabelTileVersion();
        } catch {
            /* ignore */
        }
    }, [bumpRoadLabelTileVersion, bumpStreetTileVersion]);

    const config = {
        ...CORE_REVIEW_STREETS_CONFIG,
        extensions: {
            headerActions: (
                <Link
                    href={coreReviewPath("roads/new")}
                    className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
                >
                    Add Road
                </Link>
            ),
            renderExtraFilters: ({
                draft,
                setDraft,
            }: {
                draft: import("../hooks/useCoreReviewListState").CoreReviewListDraft;
                setDraft: React.Dispatch<
                    React.SetStateAction<import("../hooks/useCoreReviewListState").CoreReviewListDraft>
                >;
            }) => (
                <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
                    <input
                        type="checkbox"
                        checked={draft.includeDeleted}
                        onChange={(e) =>
                            setDraft((d) => ({ ...d, includeDeleted: e.target.checked }))
                        }
                        className="rounded border-slate-300"
                    />
                    Show soft-deleted roads
                </label>
            ),
            renderDrawerActions: ({
                row,
                close,
                reloadList,
            }: {
                row: CoreReviewStreetRow;
                close: () => void;
                reloadList: () => void;
            }) => {
                if (row.deletedAt) {
                    return <CoreReviewStatusBadge variant="deleted" label="Soft-deleted" />;
                }
                return (
                    <button
                        type="button"
                        disabled={deleteBusy}
                        onClick={async () => {
                            const label = row.canonicalName || row.publicId;
                            if (
                                !window.confirm(
                                    `Soft-delete street “${label}”? It will be hidden from default lists.`
                                )
                            ) {
                                return;
                            }
                            const reason =
                                window.prompt("Optional note for the audit log (edit reason):")?.trim() ??
                                "";
                            setDeleteBusy(true);
                            try {
                                const deleted = await deleteStreet(
                                    row.publicId,
                                    reason.length > 0 ? { edit_reason: reason } : undefined
                                );
                                bumpStreetTileVersion();
                                bumpRoadLabelTileVersion();
                                dashDevLog("street:list:api-response-geometry-after-delete", deleted.geometry);
                                close();
                                reloadList();
                            } catch (error) {
                                alert(
                                    error instanceof Error
                                        ? error.message
                                        : "Failed to soft-delete street"
                                );
                            } finally {
                                setDeleteBusy(false);
                            }
                        }}
                        className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                        {deleteBusy ? "Deleting…" : "Soft delete"}
                    </button>
                );
            },
        },
    };

    return <CoreReviewEntityPage config={config} />;
}

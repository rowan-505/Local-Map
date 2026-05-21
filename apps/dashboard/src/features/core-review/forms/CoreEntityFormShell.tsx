"use client";

import Link from "next/link";
import type { FormEvent, ReactNode } from "react";

import type { CoreEntityFormMode } from "@/src/lib/core-review/entityConfigs/types";

export type CoreEntityFormShellProps = {
    mode: CoreEntityFormMode;
    title: string;
    description?: string;
    backHref: string;
    backLabel?: string;
    onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
    headerNotice?: ReactNode;
    mapSection: ReactNode;
    validationSection?: ReactNode;
    fieldsSection: ReactNode;
    metadataSection?: ReactNode;
    extrasSection?: ReactNode;
    /** Spans full width below the map/attributes grid (e.g. linked buildings on place edit). */
    fullWidthSection?: ReactNode;
    actions: ReactNode;
};

export default function CoreEntityFormShell({
    title,
    description,
    backHref,
    backLabel = "Back to list",
    onSubmit,
    headerNotice,
    mapSection,
    validationSection,
    fieldsSection,
    metadataSection,
    extrasSection,
    fullWidthSection,
    actions,
}: CoreEntityFormShellProps) {
    const hasMap = Boolean(mapSection);

    return (
        <main className="min-h-screen bg-slate-50/50 p-6">
            <div className="mx-auto max-w-6xl">
                <div className="mb-6">
                    <Link
                        href={backHref}
                        className="text-sm font-medium text-sky-800 hover:text-sky-950"
                    >
                        ← {backLabel}
                    </Link>
                    <h1 className="mt-3 text-2xl font-bold text-slate-900">{title}</h1>
                    {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
                    {headerNotice ? <div className="mt-4">{headerNotice}</div> : null}
                </div>

                <form className="space-y-6" onSubmit={onSubmit}>
                    {hasMap ? (
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
                            <div className="min-w-0 space-y-4">
                                <h2 className="text-lg font-semibold text-slate-900">Map</h2>
                                {mapSection}
                                {validationSection}
                            </div>

                            <div className="min-w-0 space-y-4">
                                <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                    <h2 className="mb-4 text-lg font-semibold text-slate-900">Attributes</h2>
                                    <div className="space-y-4">{fieldsSection}</div>
                                </div>
                                {metadataSection}
                                {extrasSection}
                            </div>
                        </div>
                    ) : (
                        <div className="mx-auto max-w-2xl space-y-4">
                            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                <h2 className="mb-4 text-lg font-semibold text-slate-900">Attributes</h2>
                                <div className="space-y-4">{fieldsSection}</div>
                            </div>
                            {validationSection}
                            {metadataSection}
                            {extrasSection}
                        </div>
                    )}

                    {fullWidthSection ? <div className="min-w-0">{fullWidthSection}</div> : null}

                    {actions}
                </form>
            </div>
        </main>
    );
}

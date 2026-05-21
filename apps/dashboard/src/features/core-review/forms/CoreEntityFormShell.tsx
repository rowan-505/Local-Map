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
    /** Renders directly below the map in the left column (e.g. linked buildings on place edit). */
    leftColumnBelowMapSection?: ReactNode;
    /** Spans full width below the map/attributes grid. */
    fullWidthSection?: ReactNode;
    headerActions?: ReactNode;
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
    leftColumnBelowMapSection,
    fullWidthSection,
    headerActions,
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
                    <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
                            {description ? (
                                <p className="mt-1 text-sm text-slate-600">{description}</p>
                            ) : null}
                        </div>
                        {headerActions ? (
                            <div className="flex shrink-0 flex-wrap items-center gap-2">{headerActions}</div>
                        ) : null}
                    </div>
                    {headerNotice ? <div className="mt-4">{headerNotice}</div> : null}
                </div>

                <form className="space-y-5 pb-24 lg:space-y-6" onSubmit={onSubmit}>
                    {hasMap ? (
                        <div className="grid gap-5 lg:grid-cols-12 lg:items-start lg:gap-6">
                            <div className="min-w-0 space-y-5 lg:col-span-7 lg:space-y-6">
                                {mapSection}
                                {leftColumnBelowMapSection}
                                {validationSection}
                            </div>

                            <div className="min-w-0 space-y-5 lg:col-span-5 lg:space-y-6">
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

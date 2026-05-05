"use client";

import type { ReactNode } from "react";

import {
    MAP_PREVIEW_CARD_CLASS,
    MAP_PREVIEW_CARD_HEADER_CLASS,
} from "./mapPreviewUi";

export type MapPreviewCardProps = {
    children: ReactNode;
    className?: string;
    title?: string;
    description?: string;
    loading?: boolean;
    loadingLabel?: string;
    error?: string | null;
};

export default function MapPreviewCard({
    children,
    className,
    title,
    description,
    loading = false,
    loadingLabel = "Loading map…",
    error,
}: MapPreviewCardProps) {
    const rootClass = [MAP_PREVIEW_CARD_CLASS, className].filter(Boolean).join(" ");

    return (
        <section className={rootClass}>
            {title || description ? (
                <header className={MAP_PREVIEW_CARD_HEADER_CLASS}>
                    {title ? (
                        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                    ) : null}
                    {description ? (
                        <p className="mt-0.5 text-xs text-gray-600">{description}</p>
                    ) : null}
                </header>
            ) : null}

            {error ? (
                <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                </div>
            ) : null}

            <div className="relative">
                {loading ? (
                    <div
                        className="flex min-h-[240px] items-center justify-center bg-gray-100 text-sm text-gray-600"
                        aria-live="polite"
                    >
                        {loadingLabel}
                    </div>
                ) : (
                    children
                )}
            </div>
        </section>
    );
}

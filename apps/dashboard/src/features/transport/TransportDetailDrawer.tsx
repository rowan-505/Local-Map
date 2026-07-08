"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Reusable right-side slide-over drawer for Transport detail views
 * (route / stop / infrastructure line).
 *
 * It is a presentational shell only — it owns no data fetching or business
 * logic. The list page keeps `open`/selection state and renders this drawer on
 * top of itself, so the underlying list never unmounts and its filter / page /
 * scroll state is preserved.
 *
 * Behaviour mirrors the existing dashboard overlays
 * (`ReviewDetailDrawer`, `RemoveRouteStopDialog`):
 *   - fixed full-viewport backdrop, panel slides in from the right
 *   - overlay click closes (toggleable)
 *   - Escape closes (toggleable)
 *   - sticky header with title / subtitle / actions / Close
 *
 * Width: ~85vw capped at 1280px on desktop, full-screen on small screens.
 */
export type TransportDetailDrawerProps = {
    readonly open: boolean;
    readonly title: ReactNode;
    readonly subtitle?: ReactNode;
    /** Optional metadata row rendered under the subtitle (badges, mode, etc.). */
    readonly meta?: ReactNode;
    /** Optional header action controls (e.g. Edit / Save buttons), left of Close. */
    readonly actions?: ReactNode;
    readonly onClose: () => void;
    /** When true, body shows a loading placeholder instead of `children`. */
    readonly loading?: boolean;
    /** When set, an error banner is shown above the body content. */
    readonly error?: string | null;
    readonly children?: ReactNode;
    /** Accessible label when `title` is not a plain string. */
    readonly ariaLabel?: string;
    /** Disable Escape-to-close (e.g. while a save is in flight). Default: enabled. */
    readonly closeOnEscape?: boolean;
    /** Disable overlay-click-to-close. Default: enabled. */
    readonly closeOnOverlayClick?: boolean;
    /** Override the panel width utility classes if a view needs more/less room. */
    readonly widthClassName?: string;
    /** Override the fixed overlay z-index / backdrop classes (default: z-40). */
    readonly overlayClassName?: string;
    /** When true, skip the sticky title/header bar (body provides its own chrome). */
    readonly hideHeaderChrome?: boolean;
};

const DEFAULT_WIDTH_CLASS = "w-full sm:w-[85vw] sm:max-w-[1280px]";

export default function TransportDetailDrawer({
    open,
    title,
    subtitle,
    meta,
    actions,
    onClose,
    loading = false,
    error = null,
    children,
    ariaLabel = "Transport record details",
    closeOnEscape = true,
    closeOnOverlayClick = true,
    widthClassName = DEFAULT_WIDTH_CLASS,
    overlayClassName = "z-40",
    hideHeaderChrome = false,
}: TransportDetailDrawerProps) {
    const titleId = useId();
    const closeRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        closeRef.current?.focus();
        if (!closeOnEscape) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, closeOnEscape, onClose]);

    if (!open) {
        return null;
    }

    return (
        <div
            className={`fixed inset-0 flex justify-end bg-slate-900/40 ${overlayClassName}`}
            role="presentation"
            onClick={() => {
                if (closeOnOverlayClick) {
                    onClose();
                }
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={typeof title === "string" ? titleId : undefined}
                aria-label={typeof title === "string" ? undefined : ariaLabel}
                className={`flex h-full flex-col overflow-y-auto bg-gray-50 shadow-xl ${widthClassName}`}
                onClick={(e) => e.stopPropagation()}
            >
                {!hideHeaderChrome ? (
                <>
                {/* Sticky header */}
                <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-200 bg-white px-5 py-4">
                    <div className="min-w-0 pr-2">
                        <h2
                            id={typeof title === "string" ? titleId : undefined}
                            className="truncate text-lg font-semibold text-gray-900"
                        >
                            {title}
                        </h2>
                        {subtitle ? (
                            <p className="mt-0.5 truncate text-sm text-gray-500">{subtitle}</p>
                        ) : null}
                        {meta ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-gray-600">
                                {meta}
                            </div>
                        ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {actions}
                        <button
                            ref={closeRef}
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                            Close
                        </button>
                    </div>
                </div>
                </>
                ) : null}

                {/* Body */}
                <div className="flex-1">
                    {error ? (
                        <div className="m-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                            {error}
                        </div>
                    ) : null}

                    {loading ? (
                        <div className="space-y-3 p-5" aria-busy="true" aria-live="polite">
                            <div className="h-7 w-64 animate-pulse rounded bg-gray-200" />
                            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                                {[0, 1, 2].map((col) => (
                                    <div
                                        key={col}
                                        className="space-y-2 rounded-lg border border-gray-200 bg-white p-4"
                                    >
                                        {[0, 1, 2, 3, 4].map((row) => (
                                            <div
                                                key={row}
                                                className="h-4 animate-pulse rounded bg-gray-100"
                                            />
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        children
                    )}
                </div>
            </div>
        </div>
    );
}

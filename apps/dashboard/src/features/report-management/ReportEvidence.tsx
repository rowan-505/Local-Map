"use client";

import { useEffect, useRef, useState } from "react";

import { isAbortError } from "@/src/lib/api";

import { getPrivateMediaAccess, publishStopPhoto } from "./api";
import type { ReportMediaEvidence } from "./types";

const PLACEHOLDER_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-400";
const ACTION_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:text-gray-400 disabled:hover:bg-white";

type PreviewState = {
    url: string | null;
    error: string | null;
};

type NormRect = { x: number; y: number; width: number; height: number };

function isAudio(mimeType: string): boolean {
    return mimeType.startsWith("audio/");
}

function clientToNorm(img: HTMLImageElement, clientX: number, clientY: number): { x: number; y: number } {
    const box = img.getBoundingClientRect();
    const x = box.width <= 0 ? 0 : Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const y = box.height <= 0 ? 0 : Math.min(1, Math.max(0, (clientY - box.top) / box.height));
    return { x, y };
}

function toRect(a: { x: number; y: number }, b: { x: number; y: number }): NormRect | null {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    if (width < 0.02 || height < 0.02) {
        return null;
    }
    return { x, y, width, height };
}

export default function ReportEvidence({
    items,
    stopPublicId,
}: {
    items: ReportMediaEvidence[];
    stopPublicId: string | null;
}) {
    const [previews, setPreviews] = useState<Record<string, PreviewState>>({});
    const [openId, setOpenId] = useState<string | null>(null);
    const [publishItem, setPublishItem] = useState<ReportMediaEvidence | null>(null);

    useEffect(() => {
        if (items.length === 0) {
            setPreviews({});
            return;
        }
        const controller = new AbortController();
        void Promise.all(
            items.map(async (item) => {
                try {
                    const access = await getPrivateMediaAccess(item.publicId, { signal: controller.signal });
                    return [item.publicId, { url: access.url, error: null }] as const;
                } catch (error) {
                    if (isAbortError(error)) {
                        return null;
                    }
                    return [
                        item.publicId,
                        {
                            url: null,
                            error: error instanceof Error ? error.message : "Could not load evidence",
                        },
                    ] as const;
                }
            })
        ).then((rows) => {
            const next: Record<string, PreviewState> = {};
            for (const row of rows) {
                if (row) {
                    next[row[0]] = row[1];
                }
            }
            setPreviews(next);
        });
        return () => controller.abort();
    }, [items]);

    useEffect(() => {
        if (!openId) {
            return;
        }
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpenId(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [openId]);

    const openItem = items.find((item) => item.publicId === openId) ?? null;
    const openPreview = openId ? previews[openId] : undefined;

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Evidence</h2>
            {items.length === 0 ? (
                <p className="text-sm text-gray-500">No private photos or voice attached.</p>
            ) : (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {items.map((item) => {
                        const preview = previews[item.publicId];
                        const audio = isAudio(item.mimeType);
                        const canPublish = Boolean(stopPublicId) && !audio && !item.published;
                        return (
                            <li key={item.publicId} className="space-y-2">
                                {audio ? (
                                    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
                                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Voice
                                        </p>
                                        {preview?.url ? (
                                            <audio
                                                controls
                                                preload="none"
                                                src={preview.url}
                                                className="w-full"
                                            >
                                                Voice playback is not supported in this browser.
                                            </audio>
                                        ) : (
                                            <p className="text-xs text-gray-500">
                                                {preview?.error ?? "Loading voice…"}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        className="block w-full overflow-hidden rounded-md border border-gray-200 bg-gray-50 text-left"
                                        onClick={() => setOpenId(item.publicId)}
                                    >
                                        {preview?.url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={preview.url}
                                                alt=""
                                                className="h-28 w-full object-cover"
                                                referrerPolicy="no-referrer"
                                            />
                                        ) : (
                                            <div className="flex h-28 items-center justify-center px-2 text-center text-xs text-gray-500">
                                                {preview?.error ?? "Loading photo…"}
                                            </div>
                                        )}
                                    </button>
                                )}
                                {item.note ? <p className="text-xs text-gray-600">{item.note}</p> : null}
                                {item.published ? (
                                    <p className="text-xs font-medium text-green-700">Published to this stop</p>
                                ) : null}
                                <button
                                    type="button"
                                    className={ACTION_BTN}
                                    disabled={!canPublish || !preview?.url}
                                    title={
                                        audio
                                            ? "Voice cannot be published"
                                            : !stopPublicId
                                              ? "This report is not linked to a stop"
                                              : item.published
                                                ? "Already published"
                                                : "Create a new public photo. The private original stays private."
                                    }
                                    onClick={() => setPublishItem(item)}
                                >
                                    Publish
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled className={PLACEHOLDER_BTN} title="Not available yet">
                    Evidence only
                </button>
                <button type="button" disabled className={PLACEHOLDER_BTN} title="Not available yet">
                    Reject media
                </button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
                Publish creates new public JPEGs. Report resolve does not publish. Private originals stay
                private.
            </p>

            {openItem && openPreview?.url && !isAudio(openItem.mimeType) ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Photo evidence"
                    onClick={() => setOpenId(null)}
                >
                    <div className="max-h-full max-w-4xl" onClick={(event) => event.stopPropagation()}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={openPreview.url}
                            alt={openItem.note ?? "Report photo"}
                            className="max-h-[85vh] w-auto max-w-full rounded-md"
                            referrerPolicy="no-referrer"
                        />
                        {openItem.note ? <p className="mt-2 text-sm text-white">{openItem.note}</p> : null}
                        <button
                            type="button"
                            className="mt-3 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-900"
                            onClick={() => setOpenId(null)}
                        >
                            Close
                        </button>
                    </div>
                </div>
            ) : null}

            {publishItem && previews[publishItem.publicId]?.url ? (
                <PublishDialog
                    item={publishItem}
                    imageUrl={previews[publishItem.publicId]!.url!}
                    onClose={() => setPublishItem(null)}
                />
            ) : null}
        </section>
    );
}

function PublishDialog({
    item,
    imageUrl,
    onClose,
}: {
    item: ReportMediaEvidence;
    imageUrl: string;
    onClose: () => void;
}) {
    const imgRef = useRef<HTMLImageElement | null>(null);
    const dragStart = useRef<{ x: number; y: number } | null>(null);
    const [tool, setTool] = useState<"crop" | "blur">("blur");
    const [rotateDegrees, setRotateDegrees] = useState<0 | 90 | 180 | 270>(0);
    const [crop, setCrop] = useState<NormRect | null>(null);
    const [blurRects, setBlurRects] = useState<NormRect[]>([]);
    const [draft, setDraft] = useState<NormRect | null>(null);
    const [isPrimary, setIsPrimary] = useState(false);
    const [note, setNote] = useState(item.note ?? "");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
        const img = imgRef.current;
        if (!img) {
            return;
        }
        dragStart.current = clientToNorm(img, event.clientX, event.clientY);
        setDraft(null);
    }

    function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
        const img = imgRef.current;
        const start = dragStart.current;
        if (!img || !start) {
            return;
        }
        setDraft(toRect(start, clientToNorm(img, event.clientX, event.clientY)));
    }

    function onPointerUp() {
        const next = draft;
        dragStart.current = null;
        setDraft(null);
        if (!next) {
            return;
        }
        if (tool === "crop") {
            setCrop(next);
            return;
        }
        setBlurRects((current) => (current.length >= 8 ? current : [...current, next]));
    }

    async function onPublish() {
        setBusy(true);
        setError(null);
        try {
            await publishStopPhoto(item.publicId, {
                rotateDegrees,
                crop,
                blurRects,
                note: note.trim() ? note.trim() : null,
                isPrimary,
            });
            onClose();
            window.location.reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Publish failed");
            setBusy(false);
        }
    }

    const overlayRects = [
        ...(crop ? [{ ...crop, kind: "crop" as const }] : []),
        ...blurRects.map((rect) => ({ ...rect, kind: "blur" as const })),
        ...(draft ? [{ ...draft, kind: "draft" as const }] : []),
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Publish stop photo"
        >
            <div className="max-h-full w-full max-w-3xl overflow-auto rounded-lg bg-white p-4">
                <h3 className="text-base font-semibold text-gray-900">Publish stop photo</h3>
                <p className="mt-1 text-xs text-gray-500">
                    The private original is not changed. The server crops, rotates, and pixel-blurs a new
                    public JPEG.
                </p>
                <div
                    className="relative mt-3 inline-block max-w-full cursor-crosshair select-none"
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerLeave={onPointerUp}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        ref={imgRef}
                        src={imageUrl}
                        alt=""
                        className="max-h-[50vh] w-auto max-w-full"
                        referrerPolicy="no-referrer"
                        draggable={false}
                    />
                    {overlayRects.map((rect, index) => (
                        <span
                            key={`${rect.kind}-${index}`}
                            className={
                                rect.kind === "blur"
                                    ? "pointer-events-none absolute border-2 border-yellow-400 bg-yellow-300/30"
                                    : rect.kind === "crop"
                                      ? "pointer-events-none absolute border-2 border-sky-500 bg-sky-400/20"
                                      : "pointer-events-none absolute border-2 border-dashed border-white bg-white/10"
                            }
                            style={{
                                left: `${rect.x * 100}%`,
                                top: `${rect.y * 100}%`,
                                width: `${rect.width * 100}%`,
                                height: `${rect.height * 100}%`,
                            }}
                        />
                    ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={ACTION_BTN} onClick={() => setTool("blur")}>
                        {tool === "blur" ? "Blur (on)" : "Blur"}
                    </button>
                    <button type="button" className={ACTION_BTN} onClick={() => setTool("crop")}>
                        {tool === "crop" ? "Crop (on)" : "Crop"}
                    </button>
                    <button
                        type="button"
                        className={ACTION_BTN}
                        onClick={() =>
                            setRotateDegrees((current) =>
                                current === 0 ? 90 : current === 90 ? 180 : current === 180 ? 270 : 0
                            )
                        }
                    >
                        Rotate {rotateDegrees}°
                    </button>
                    <button
                        type="button"
                        className={ACTION_BTN}
                        onClick={() => {
                            setCrop(null);
                            setBlurRects([]);
                        }}
                    >
                        Clear boxes
                    </button>
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                    <input
                        type="checkbox"
                        checked={isPrimary}
                        onChange={(event) => setIsPrimary(event.target.checked)}
                    />
                    Set as primary stop photo
                </label>
                <input
                    className="mt-2 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                    value={note}
                    maxLength={500}
                    placeholder="Optional public note"
                    onChange={(event) => setNote(event.target.value)}
                />
                {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
                <div className="mt-4 flex gap-2">
                    <button type="button" className={ACTION_BTN} disabled={busy} onClick={() => void onPublish()}>
                        {busy ? "Publishing…" : "Publish"}
                    </button>
                    <button type="button" className={ACTION_BTN} disabled={busy} onClick={onClose}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

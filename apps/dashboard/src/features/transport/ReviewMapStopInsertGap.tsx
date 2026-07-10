"use client";

const GAP_BTN_CLASS =
    "flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-gray-200 text-[13px] font-semibold leading-none text-gray-400 transition hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Compact "+" control rendered between ordered stop rows in the review map.
 * Mode-agnostic — the parent supplies the insert handler / context.
 */
export default function ReviewMapStopInsertGap({
    title,
    disabled = false,
    onClick,
}: {
    readonly title: string;
    readonly disabled?: boolean;
    readonly onClick: () => void;
}) {
    return (
        <div className="flex justify-center py-0.5">
            <button
                type="button"
                disabled={disabled}
                title={title}
                aria-label={title}
                onClick={(event) => {
                    event.stopPropagation();
                    onClick();
                }}
                className={GAP_BTN_CLASS}
            >
                +
            </button>
        </div>
    );
}

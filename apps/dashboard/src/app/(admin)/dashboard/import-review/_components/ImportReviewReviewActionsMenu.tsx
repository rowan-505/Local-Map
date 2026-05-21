"use client";

import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type RefObject,
} from "react";
import { createPortal } from "react-dom";

import type { ImportReviewDecision } from "@/src/lib/api";

const MENU_WIDTH_PX = 200;
const MENU_GAP_PX = 4;
const VIEWPORT_PAD_PX = 8;
const MENU_MAX_HEIGHT_PX = 320;
const MENU_Z_INDEX = 9999;

const DECISION_ITEMS: {
    label: string;
    decision: ImportReviewDecision;
    menuClass: string;
}[] = [
    { label: "Approve", decision: "approved", menuClass: "text-emerald-800 hover:bg-emerald-50" },
    { label: "Reject", decision: "rejected", menuClass: "text-red-800 hover:bg-red-50" },
    {
        label: "Needs more review",
        decision: "needs_more_review",
        menuClass: "text-amber-900 hover:bg-amber-50",
    },
    { label: "Ignore", decision: "ignored", menuClass: "text-gray-700 hover:bg-gray-100" },
    { label: "Mark merged", decision: "merged", menuClass: "text-violet-800 hover:bg-violet-50" },
];

type MenuPosition = {
    top: number;
    left: number;
    maxHeight: number;
};

type Props = {
    busy?: boolean;
    disabled?: boolean;
    onDecision: (decision: ImportReviewDecision) => void;
    onEditOverrides?: () => void;
    onViewDetails?: () => void;
};

function maxMenuHeight(): number {
    if (typeof window === "undefined") {
        return MENU_MAX_HEIGHT_PX;
    }
    return Math.min(MENU_MAX_HEIGHT_PX, Math.max(120, window.innerHeight - 80));
}

function ReviewActionsMenuPanel({
    menuId,
    menuRef,
    menuPos,
    busy,
    disabled,
    onDecision,
    onEditOverrides,
    onViewDetails,
    onClose,
}: {
    menuId: string;
    menuRef: RefObject<HTMLDivElement | null>;
    menuPos: MenuPosition;
    busy: boolean;
    disabled: boolean;
    onDecision: (decision: ImportReviewDecision) => void;
    onEditOverrides?: () => void;
    onViewDetails?: () => void;
    onClose: () => void;
}) {
    return (
        <div
            ref={menuRef}
            id={menuId}
            role="menu"
            style={{
                position: "fixed",
                top: menuPos.top,
                left: menuPos.left,
                width: MENU_WIDTH_PX,
                maxHeight: menuPos.maxHeight,
                zIndex: MENU_Z_INDEX,
            }}
            className="overflow-y-auto overscroll-contain rounded-lg border border-gray-200 bg-white py-1 shadow-xl"
        >
            {DECISION_ITEMS.map((item) => (
                <button
                    key={item.decision}
                    type="button"
                    role="menuitem"
                    disabled={busy || disabled}
                    className={`block w-full px-3 py-2 text-left text-sm font-medium disabled:opacity-50 ${item.menuClass}`}
                    onClick={() => {
                        onClose();
                        onDecision(item.decision);
                    }}
                >
                    {item.label}
                </button>
            ))}
            <div className="my-1 border-t border-gray-100" />
            {onEditOverrides ? (
                <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
                    onClick={() => {
                        onClose();
                        onEditOverrides();
                    }}
                >
                    Edit overrides
                </button>
            ) : null}
            {onViewDetails ? (
                <button
                    type="button"
                    role="menuitem"
                    className="block w-full px-3 py-2 text-left text-sm font-medium text-gray-800 hover:bg-gray-50"
                    onClick={() => {
                        onClose();
                        onViewDetails();
                    }}
                >
                    View details
                </button>
            ) : null}
        </div>
    );
}

export default function ImportReviewReviewActionsMenu({
    busy = false,
    disabled = false,
    onDecision,
    onEditOverrides,
    onViewDetails,
}: Props) {
    const menuId = useId();
    const [open, setOpen] = useState(false);
    const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const updateMenuPosition = useCallback(() => {
        const btn = buttonRef.current;
        if (!btn) {
            return;
        }

        const rect = btn.getBoundingClientRect();
        const maxHeight = maxMenuHeight();
        const menuEl = menuRef.current;
        const naturalHeight = menuEl ? menuEl.scrollHeight : 280;
        const menuHeight = Math.min(naturalHeight, maxHeight);

        const left = Math.max(
            VIEWPORT_PAD_PX,
            Math.min(rect.right - MENU_WIDTH_PX, window.innerWidth - MENU_WIDTH_PX - VIEWPORT_PAD_PX)
        );

        const belowTop = rect.bottom + MENU_GAP_PX;
        const aboveTop = rect.top - MENU_GAP_PX - menuHeight;
        const spaceBelow = window.innerHeight - belowTop - VIEWPORT_PAD_PX;
        const spaceAbove = rect.top - MENU_GAP_PX - VIEWPORT_PAD_PX;

        const preferBelow = spaceBelow >= menuHeight || spaceBelow >= spaceAbove;
        let top = preferBelow ? belowTop : aboveTop;
        top = Math.max(VIEWPORT_PAD_PX, Math.min(top, window.innerHeight - menuHeight - VIEWPORT_PAD_PX));

        setMenuPos({ top, left, maxHeight });
    }, []);

    useLayoutEffect(() => {
        if (!open) {
            return;
        }
        updateMenuPosition();
        const frame = requestAnimationFrame(() => updateMenuPosition());
        return () => cancelAnimationFrame(frame);
    }, [open, updateMenuPosition, onEditOverrides, onViewDetails]);

    useEffect(() => {
        if (!open) {
            return;
        }

        const onDocPointer = (e: MouseEvent) => {
            const t = e.target as Node;
            if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) {
                return;
            }
            setOpen(false);
        };

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                buttonRef.current?.focus();
            }
        };

        const onReflow = () => updateMenuPosition();

        document.addEventListener("mousedown", onDocPointer);
        document.addEventListener("keydown", onKeyDown);
        window.addEventListener("resize", onReflow);
        window.addEventListener("scroll", onReflow, true);

        return () => {
            document.removeEventListener("mousedown", onDocPointer);
            document.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("resize", onReflow);
            window.removeEventListener("scroll", onReflow, true);
        };
    }, [open, updateMenuPosition]);

    const menu =
        open && menuPos && typeof document !== "undefined"
            ? createPortal(
                  <ReviewActionsMenuPanel
                      menuId={menuId}
                      menuRef={menuRef}
                      menuPos={menuPos}
                      busy={busy}
                      disabled={disabled}
                      onDecision={onDecision}
                      onEditOverrides={onEditOverrides}
                      onViewDetails={onViewDetails}
                      onClose={() => setOpen(false)}
                  />,
                  document.body
              )
            : null;

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                disabled={busy || disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => setOpen((o) => !o)}
                className="inline-flex min-w-[5.5rem] items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
                Review
                <span className="text-gray-500" aria-hidden>
                    ▾
                </span>
            </button>
            {menu}
        </>
    );
}

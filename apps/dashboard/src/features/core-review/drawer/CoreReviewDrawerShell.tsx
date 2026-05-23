"use client";

import type { ReactNode } from "react";

import ReviewDetailDrawer from "@/src/components/review/ReviewDetailDrawer";

import type { CoreReviewDrawerMode } from "./types";

export type CoreReviewDrawerShellProps = {
    open: boolean;
    mode: CoreReviewDrawerMode;
    title: string;
    subtitle?: string | null;
    onClose: () => void;
    headerActions?: ReactNode;
    editActions?: ReactNode;
    maxWidthClass?: string;
    children: ReactNode;
};

export default function CoreReviewDrawerShell({
    open,
    title,
    subtitle,
    onClose,
    headerActions,
    editActions,
    maxWidthClass = "sm:max-w-xl",
    children,
}: CoreReviewDrawerShellProps) {
    if (!open) {
        return null;
    }

    return (
        <ReviewDetailDrawer
            title={title}
            subtitle={subtitle}
            onClose={onClose}
            palette="core"
            maxWidthClass={maxWidthClass}
            actions={
                <>
                    {editActions}
                    {headerActions}
                </>
            }
        >
            {children}
        </ReviewDetailDrawer>
    );
}

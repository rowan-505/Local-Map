"use client";

import type { ReactNode } from "react";

import DataReviewMapHeaderControls, {
    type DataReviewMapHeaderControlsProps,
} from "./DataReviewMapHeaderControls";
import { MAP_PREVIEW_CARD_CLASS } from "./mapPreviewUi";

export type DataReviewMapCardProps = {
    header: DataReviewMapHeaderControlsProps;
    toolbar?: ReactNode;
    footer?: ReactNode;
    children: ReactNode;
    className?: string;
    bodyClassName?: string;
};

export default function DataReviewMapCard({
    header,
    toolbar,
    footer,
    children,
    className,
    bodyClassName = "p-2",
}: DataReviewMapCardProps) {
    const rootClass = [MAP_PREVIEW_CARD_CLASS, className].filter(Boolean).join(" ");

    return (
        <div className={rootClass}>
            <DataReviewMapHeaderControls {...header} />
            {toolbar ? toolbar : null}
            <div className={bodyClassName}>{children}</div>
            {footer ? footer : null}
        </div>
    );
}

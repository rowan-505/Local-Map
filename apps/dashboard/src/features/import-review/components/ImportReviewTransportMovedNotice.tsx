import Link from "next/link";

import {
    IMPORT_REVIEW_TRANSPORT_MOVED_DETAIL,
    IMPORT_REVIEW_TRANSPORT_MOVED_MESSAGE,
} from "@/src/features/import-review/utils/deprecatedCoreBusPromotion";
import { importTransportPath } from "@/src/lib/dashboardPaths";

export default function ImportReviewTransportMovedNotice({ compact = false }: { compact?: boolean }) {
    if (compact) {
        return (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
                <p className="font-medium">{IMPORT_REVIEW_TRANSPORT_MOVED_MESSAGE}</p>
                <p className="mt-1 text-sky-900">
                    {IMPORT_REVIEW_TRANSPORT_MOVED_DETAIL}{" "}
                    <Link href={importTransportPath()} className="font-medium text-sky-800 underline">
                        Open Import transport
                    </Link>
                    .
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
            <p className="font-medium">{IMPORT_REVIEW_TRANSPORT_MOVED_MESSAGE}</p>
            <p className="mt-1 text-gray-700">{IMPORT_REVIEW_TRANSPORT_MOVED_DETAIL}</p>
            <Link
                href={importTransportPath()}
                className="mt-3 inline-flex rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
            >
                Open Import transport
            </Link>
        </div>
    );
}

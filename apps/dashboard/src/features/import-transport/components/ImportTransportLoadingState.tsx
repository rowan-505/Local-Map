"use client";

export function ImportTransportLoadingBannerWithSpinner({ message }: { message: string }) {
    return (
        <div
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm"
            role="status"
        >
            <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700"
                aria-hidden
            />
            {message}
        </div>
    );
}

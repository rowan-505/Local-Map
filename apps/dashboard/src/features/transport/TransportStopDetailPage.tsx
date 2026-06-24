"use client";

import TransportStopDetailContent from "./TransportStopDetailContent";

export default function TransportStopDetailPage({ publicId }: { readonly publicId: string }) {
    return (
        <main className="p-6">
            <div className="mx-auto max-w-[1600px] space-y-4">
                <TransportStopDetailContent publicId={publicId} />
            </div>
        </main>
    );
}

"use client";

import TransportRouteDetailContent from "./TransportRouteDetailContent";

export default function TransportRouteDetailPage({ publicId }: { readonly publicId: string }) {
    return (
        <main className="p-6">
            <div className="mx-auto max-w-[1600px] space-y-4">
                <TransportRouteDetailContent publicId={publicId} />
            </div>
        </main>
    );
}

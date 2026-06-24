import TransportRouteDetailPage from "@/src/features/transport/TransportRouteDetailPage";

export default async function TransportRouteDetailRoutePage({
    params,
}: {
    params: Promise<{ publicId: string }>;
}) {
    const { publicId } = await params;
    return <TransportRouteDetailPage publicId={publicId} />;
}

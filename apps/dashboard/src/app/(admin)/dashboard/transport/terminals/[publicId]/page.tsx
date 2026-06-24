import TransportTerminalRedirect from "@/src/features/transport/TransportTerminalRedirect";

export default async function TransportTerminalDetailRoutePage({
    params,
}: {
    params: Promise<{ publicId: string }>;
}) {
    const { publicId } = await params;
    return <TransportTerminalRedirect publicId={publicId} />;
}

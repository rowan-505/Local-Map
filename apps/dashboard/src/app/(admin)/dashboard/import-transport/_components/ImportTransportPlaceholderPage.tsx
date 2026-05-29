type ImportTransportPlaceholderPageProps = {
    title: string;
    subtitle?: string;
};

export default function ImportTransportPlaceholderPage({
    title,
    subtitle = "Placeholder page — API integration coming soon.",
}: ImportTransportPlaceholderPageProps) {
    return (
        <main className="min-h-screen bg-gray-50 p-4 sm:p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="border-b border-gray-200 pb-6">
                    <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                    <p className="mt-1 max-w-3xl text-sm text-gray-600">{subtitle}</p>
                </header>

                <div
                    className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
                    role="status"
                >
                    This section is separate from Import Review. Transport workflows will use{" "}
                    <span className="font-medium">import_transport</span> /{" "}
                    <span className="font-medium">core_transport</span> via the API when implemented.
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-600 shadow-sm">
                    Content not implemented yet.
                </div>
            </div>
        </main>
    );
}

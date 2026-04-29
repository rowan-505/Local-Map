type StreetEditPlaceholderPageProps = {
    params: Promise<{
        id: string;
    }>;
};

export default async function StreetEditPlaceholderPage({
    params,
}: StreetEditPlaceholderPageProps) {
    const { id } = await params;

    return (
        <main className="min-h-screen bg-gray-100 p-6">
            <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h1 className="mb-3 text-2xl font-bold text-gray-900">Street Edit</h1>
                <p className="text-sm text-gray-700">
                    Edit UI is not implemented yet for street <code>{id}</code>.
                </p>
            </div>
        </main>
    );
}

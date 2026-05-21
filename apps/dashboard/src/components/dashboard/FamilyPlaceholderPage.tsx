import { Card, CardContent } from "@/src/components/ui/card";

export default function FamilyPlaceholderPage({
    title,
    description,
    todos,
}: {
    title: string;
    description: string;
    todos: readonly string[];
}) {
    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                    <p className="mt-2 text-sm text-gray-600">{description}</p>
                </div>
                <Card>
                    <CardContent className="space-y-3 p-6">
                        <h2 className="text-lg font-semibold tracking-tight text-gray-900">TODO</h2>
                        <ul className="list-inside list-disc space-y-2 text-sm text-gray-700">
                            {todos.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}

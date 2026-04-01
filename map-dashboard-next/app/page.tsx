import MapView from "@/components/MapView";


export default function Home() {
    return (
        <main className="min-h-screen p-6 bg-gray-100">
            <h1 className="text-2xl font-bold mb-4">Kyauktan Map MVP</h1>
            <MapView />
        </main>
    );
}
import { NextResponse } from "next/server";
import { fetchKyauktanBuildings } from "@/src/lib/buildings";

export async function GET() {
    try {
        const buildings = await fetchKyauktanBuildings();
        return NextResponse.json(buildings);
    } catch (error) {
        console.error("BUILDINGS API ERROR:", error);
        return NextResponse.json(
            {
                error: "Failed to fetch building data",
                details: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 }
        );
    }
}
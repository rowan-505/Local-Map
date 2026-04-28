import { NextResponse } from "next/server";

export async function GET() {
    const pois = [
        { id: 1, name: "Kyauktan Market", lng: 96.32586, lat: 16.63276 },
        { id: 2, name: "Township Clinic", lng: 96.32698, lat: 16.63685 },
        { id: 3, name: "Tea Shop", lng: 96.32874, lat: 16.63806 },
    ];

    return NextResponse.json(pois);
}
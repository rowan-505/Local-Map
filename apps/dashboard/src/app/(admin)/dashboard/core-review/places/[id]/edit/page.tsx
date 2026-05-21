"use client";

import { useParams } from "next/navigation";

import CoreEntityFormPage from "@/src/features/core-review/forms/CoreEntityFormPage";

export default function EditPlacePage() {
    const params = useParams();
    const rawId = params.id;
    const id = typeof rawId === "string" ? rawId : Array.isArray(rawId) ? rawId[0] : "";

    return <CoreEntityFormPage entityKey="places" mode="edit" id={id} />;
}

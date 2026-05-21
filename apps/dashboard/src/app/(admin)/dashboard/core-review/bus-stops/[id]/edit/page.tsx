"use client";

import { useParams } from "next/navigation";

import CoreEntityFormRoutePage, {
    resolveCoreEntityRouteId,
} from "@/src/features/core-review/forms/CoreEntityFormRoutePage";

export default function EditPage() {
    const params = useParams();
    const id = resolveCoreEntityRouteId(params.id);

    return <CoreEntityFormRoutePage entityKey="bus-stops" mode="edit" id={id} />;
}

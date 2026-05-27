"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { createImportReviewQueryClient } from "@/src/lib/importReviewQueryClient";

export default function DashboardQueryProvider({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => createImportReviewQueryClient());

    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
